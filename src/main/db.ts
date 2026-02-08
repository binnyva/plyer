import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export const DB_FILENAME = ".playr.sqlite";

export type DB = Database.Database;

export function openDatabase(root: string): DB {
  const dbPath = path.join(root, DB_FILENAME);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      size INTEGER DEFAULT 0,
      mtime INTEGER DEFAULT 0,
      created_ms INTEGER DEFAULT 0,
      rating INTEGER DEFAULT 0,
      meta TEXT,
      added_on INTEGER DEFAULT (strftime('%s','now') * 1000),
      last_played INTEGER,
      play_count INTEGER DEFAULT 0,
      is_missing INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'static',
      filter_json TEXT,
      created_on INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_on INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS file_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      playlist_id INTEGER NOT NULL,
      order_index INTEGER DEFAULT 0,
      added_on INTEGER DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(file_id, playlist_id),
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      added_on INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      added_on INTEGER DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(file_id, tag_id),
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_files_rating ON files(rating);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_file_playlists_order ON file_playlists(playlist_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_file_tags_file ON file_tags(file_id);
  `);

  const existing = db.prepare("SELECT id FROM playlists WHERE name = ?").get("Library");
  if (!existing) {
    db.prepare("INSERT INTO playlists (name, type) VALUES (?, 'static')").run("Library");
  }

  return db;
}

export function getLibraryPlaylistId(db: DB): number {
  const row = db.prepare("SELECT id FROM playlists WHERE name = ?").get("Library") as { id: number };
  return row.id;
}
