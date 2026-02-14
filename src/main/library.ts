import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { DB, DB_FILENAME, getLibraryPlaylistId, openDatabase } from "./db";
import { enqueueThumbnail, getThumbnailPath } from "./thumbnail";
import type { FileItem, PendingOpenInfo, PlaylistRequest, PlaylistResponse } from "../shared/types";

const VIDEO_EXTENSIONS = new Set([".mov", ".avi", ".mp4", ".webm", ".mkv"]);

export function isVideoFile(filePath: string) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function toPlyerUrl(absolutePath: string) {
  return pathToFileURL(absolutePath).toString().replace("file://", "plyer://");
}

export function inspectPath(targetPath: string, currentRoot: string | null): PendingOpenInfo {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    return {
      kind: "folder",
      path: targetPath,
      inCurrentRoot: currentRoot ? isInsideRoot(targetPath, currentRoot) : false,
      suggestedRoot: targetPath,
      foundDbRoot: fs.existsSync(path.join(targetPath, DB_FILENAME)) ? targetPath : null,
      fileUrl: null
    };
  }

  const dir = path.dirname(targetPath);
  return {
    kind: "file",
    path: targetPath,
    inCurrentRoot: currentRoot ? isInsideRoot(targetPath, currentRoot) : false,
    suggestedRoot: dir,
    foundDbRoot: findDbRootUpwards(dir, 3),
    fileUrl: toPlyerUrl(targetPath)
  };
}

export function isInsideRoot(targetPath: string, root: string) {
  const rel = path.relative(root, targetPath);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function findDbRootUpwards(startDir: string, levels: number) {
  let current = startDir;
  for (let i = 0; i <= levels; i += 1) {
    const dbPath = path.join(current, DB_FILENAME);
    if (fs.existsSync(dbPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export class LibraryManager {
  private root: string | null = null;
  private db: DB | null = null;
  private libraryPlaylistId = 0;

  getRoot() {
    return this.root;
  }

  setRoot(root: string) {
    this.root = root;
    this.db = openDatabase(root);
    this.libraryPlaylistId = getLibraryPlaylistId(this.db);
  }

  scanLibrary() {
    if (!this.root || !this.db) {
      return { added: 0, removed: 0, updated: 0 };
    }

    const files = collectFiles(this.root);
    const db = this.db;
    const playlistId = this.libraryPlaylistId;

    const existing = db
      .prepare(
        `
        SELECT f.id, f.path, fp.order_index
        FROM files f
        LEFT JOIN file_playlists fp
          ON fp.file_id = f.id AND fp.playlist_id = ?
      `
      )
      .all(playlistId) as { id: number; path: string; order_index: number | null }[];

    const map = new Map<string, { id: number; orderIndex: number | null }>();
    existing.forEach((row) => {
      map.set(row.path, { id: row.id, orderIndex: row.order_index });
    });

    const maxRow = db
      .prepare("SELECT MAX(order_index) as maxOrder FROM file_playlists WHERE playlist_id = ?")
      .get(playlistId) as { maxOrder: number | null };
    let nextOrder = (maxRow?.maxOrder ?? 0) + 1;

    let added = 0;
    let updated = 0;

    const insertFile = db.prepare(
      `
      INSERT INTO files (path, name, ext, duration_ms, size, mtime, created_ms, rating, meta, added_on, is_missing)
      VALUES (@path, @name, @ext, 0, @size, @mtime, @created_ms, 0, NULL, @added_on, 0)
    `
    );
    const updateFile = db.prepare(
      `
      UPDATE files
      SET name = @name,
          ext = @ext,
          size = @size,
          mtime = @mtime,
          created_ms = @created_ms,
          is_missing = 0
      WHERE id = @id
    `
    );
    const markMissing = db.prepare("UPDATE files SET is_missing = 1 WHERE id = ?");
    const insertFilePlaylist = db.prepare(
      `
      INSERT OR IGNORE INTO file_playlists (file_id, playlist_id, order_index)
      VALUES (?, ?, ?)
    `
    );

    const seenIds = new Set<number>();

    const tx = db.transaction(() => {
      for (const file of files) {
        const existingRow = map.get(file.relativePath);
        if (!existingRow) {
          const info = {
            path: file.relativePath,
            name: file.name,
            ext: file.ext,
            size: file.size,
            mtime: file.mtime,
            created_ms: file.createdMs,
            added_on: Date.now()
          };
          const result = insertFile.run(info) as { lastInsertRowid: number };
          const fileId = Number(result.lastInsertRowid);
          insertFilePlaylist.run(fileId, playlistId, nextOrder++);
          added += 1;
          seenIds.add(fileId);
        } else {
          updateFile.run({
            id: existingRow.id,
            name: file.name,
            ext: file.ext,
            size: file.size,
            mtime: file.mtime,
            created_ms: file.createdMs
          });
          if (existingRow.orderIndex === null) {
            insertFilePlaylist.run(existingRow.id, playlistId, nextOrder++);
          }
          updated += 1;
          seenIds.add(existingRow.id);
        }
      }

      for (const row of existing) {
        if (!seenIds.has(row.id)) {
          markMissing.run(row.id);
        }
      }
    });

    tx();

    return { added, removed: existing.length - seenIds.size, updated };
  }

  getPlaylist(options: PlaylistRequest): PlaylistResponse {
    if (!this.root || !this.db) {
      return { items: [], total: 0 };
    }

    const db = this.db;
    const playlistId = this.libraryPlaylistId;

    const { ratingFilter, ratingParams, havingClause, tagParams, orderBy, orderParams } =
      buildPlaylistQueryParts(options);

    const baseSql = `
      FROM files f
      LEFT JOIN file_playlists fp
        ON fp.file_id = f.id AND fp.playlist_id = ?
      LEFT JOIN file_tags ft
        ON ft.file_id = f.id
      LEFT JOIN tags t
        ON t.id = ft.tag_id
      WHERE f.is_missing = 0
      ${ratingFilter}
      GROUP BY f.id
      ${havingClause}
    `;

    const totalRow = db
      .prepare(`SELECT COUNT(*) as total FROM (SELECT f.id ${baseSql})`)
      .get(playlistId, ...ratingParams, ...tagParams) as { total: number } | undefined;

    const total = Number(totalRow?.total ?? 0);
    const limit = options.limit && options.limit > 0 ? Math.trunc(options.limit) : null;
    const offset = options.offset && options.offset > 0 ? Math.trunc(options.offset) : 0;

    const rows = db
      .prepare(
        `
      SELECT
        f.id,
        f.path,
        f.name,
        f.ext,
        f.duration_ms,
        f.rating,
        f.size,
        f.mtime,
        f.created_ms,
        COALESCE(fp.order_index, 0) as order_index,
        GROUP_CONCAT(t.name, '||') as tags
      ${baseSql}
      ORDER BY ${orderBy}
      ${limit ? "LIMIT ? OFFSET ?" : ""}
      `
      )
      .all(playlistId, ...ratingParams, ...tagParams, ...orderParams, ...(limit ? [limit, offset] : [])) as Array<{
      id: number;
      path: string;
      name: string;
      ext: string;
      duration_ms: number;
      rating: number;
      size: number;
      mtime: number;
      created_ms: number;
      order_index: number;
      tags: string | null;
    }>;

    const items = rows.map((row) => {
      const tags = row.tags ? row.tags.split("||").filter(Boolean) : [];
      const absolutePath = path.join(this.root!, row.path);
      const thumbnailPath = getThumbnailPath(this.root!, row.path);
      const thumbnailUrl = fs.existsSync(thumbnailPath) ? pathToFileURL(thumbnailPath).toString() : null;

      if (!thumbnailUrl) {
        enqueueThumbnail(absolutePath, thumbnailPath);
      }

      return {
        id: row.id,
        path: row.path,
        name: row.name,
        ext: row.ext,
        durationMs: row.duration_ms ?? 0,
        rating: row.rating ?? 0,
        size: row.size ?? 0,
        mtime: row.mtime ?? 0,
        createdMs: row.created_ms ?? 0,
        orderIndex: row.order_index ?? 0,
        tags,
        absolutePath,
        fileUrl: toPlyerUrl(absolutePath),
        thumbnailPath: fs.existsSync(thumbnailPath) ? thumbnailPath : null,
        thumbnailUrl: thumbnailUrl ? toPlyerUrl(thumbnailPath) : null
      } satisfies FileItem;
    });

    return { items, total };
  }

  setRating(fileId: number, rating: number) {
    if (!this.db) return;
    this.db.prepare("UPDATE files SET rating = ? WHERE id = ?").run(rating, fileId);
  }

  setDuration(fileId: number, durationMs: number) {
    if (!this.db) return;
    this.db.prepare("UPDATE files SET duration_ms = ? WHERE id = ?").run(durationMs, fileId);
  }

  setLastPlayed(fileId: number) {
    if (!this.db) return;
    this.db
      .prepare("UPDATE files SET last_played = ?, play_count = play_count + 1 WHERE id = ?")
      .run(Date.now(), fileId);
  }

  toggleTag(fileId: number, tagName: string) {
    if (!this.db) return;
    const tagRow = this.db.prepare("SELECT id FROM tags WHERE name = ?").get(tagName) as { id: number };
    let tagId = tagRow?.id;
    if (!tagId) {
      const result = this.db.prepare("INSERT INTO tags (name) VALUES (?)").run(tagName) as {
        lastInsertRowid: number;
      };
      tagId = Number(result.lastInsertRowid);
    }

    const existing = this.db
      .prepare("SELECT id FROM file_tags WHERE file_id = ? AND tag_id = ?")
      .get(fileId, tagId) as { id: number } | undefined;

    if (existing) {
      this.db.prepare("DELETE FROM file_tags WHERE id = ?").run(existing.id);
    } else {
      this.db.prepare("INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)").run(fileId, tagId);
    }
  }

  addTag(tagName: string) {
    if (!this.db) return;
    this.db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(tagName);
  }

  getTopTags() {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `
        SELECT t.name
        FROM tags t
        GROUP BY t.id
        ORDER BY t.name COLLATE NOCASE ASC, t.name ASC
      `
      )
      .all() as { name: string }[];

    return rows.map((row) => row.name);
  }

  saveOrder(fileIds: number[]) {
    if (!this.db) return;
    const playlistId = this.libraryPlaylistId;
    const update = this.db.prepare(
      "UPDATE file_playlists SET order_index = ? WHERE file_id = ? AND playlist_id = ?"
    );
    const tx = this.db.transaction((ids: number[]) => {
      ids.forEach((id, index) => {
        update.run(index, id, playlistId);
      });
    });
    tx(fileIds);
  }

  getSetting(name: string) {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT value FROM settings WHERE name = ?").get(name) as
      | { value: string | null }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(name: string, value: string | null) {
    if (!this.db) return;
    this.db
      .prepare(
        `
        INSERT INTO settings (name, value)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET value = excluded.value
      `
      )
      .run(name, value);
  }
}

function buildPlaylistQueryParts(options: PlaylistRequest) {
  const ratingParams: Array<number> = [];
  let ratingFilter = "";
  if (options.ratingMin > 0) {
    ratingFilter = "AND f.rating >= ?";
    ratingParams.push(options.ratingMin);
  }

  const tags = options.tags ?? [];
  let havingClause = "";
  const tagParams: Array<string | number> = [];
  if (tags.length > 0) {
    const placeholders = tags.map(() => "?").join(", ");
    havingClause = `HAVING COUNT(DISTINCT CASE WHEN t.name IN (${placeholders}) THEN t.name END) = ?`;
    tagParams.push(...tags, tags.length);
  }

  const { orderBy, orderParams } = buildOrderBy(options);

  return { ratingFilter, ratingParams, havingClause, tagParams, orderBy, orderParams };
}

function buildOrderBy(options: PlaylistRequest): { orderBy: string; orderParams: number[] } {
  switch (options.sort) {
    case "filename":
      return { orderBy: "f.name COLLATE NOCASE ASC, f.id ASC", orderParams: [] };
    case "created":
      return { orderBy: "f.created_ms DESC, f.id DESC", orderParams: [] };
    case "random": {
      const seed = Math.abs(Math.trunc(options.seed ?? 1)) || 1;
      return { orderBy: "((f.id * ?) % 2147483647) ASC", orderParams: [seed] };
    }
    case "playlist":
    default:
      return { orderBy: "COALESCE(fp.order_index, 0) ASC, f.id ASC", orderParams: [] };
  }
}

interface ScannedFile {
  relativePath: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  createdMs: number;
}

function collectFiles(root: string): ScannedFile[] {
  const results: ScannedFile[] = [];
  const stack: string[] = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".cache") {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!isVideoFile(fullPath)) {
        continue;
      }
      const stat = fs.statSync(fullPath);
      const relativePath = path.relative(root, fullPath);
      results.push({
        relativePath,
        name: path.basename(fullPath),
        ext: path.extname(fullPath).toLowerCase(),
        size: stat.size,
        mtime: stat.mtimeMs,
        createdMs: stat.birthtimeMs
      });
    }
  }

  return results;
}
