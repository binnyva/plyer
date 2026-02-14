import { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, shell, Menu } from "electron";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { Readable } from "stream";
import { LibraryManager, inspectPath, isVideoFile } from "./library";
import { loadConfig, saveConfig } from "./config";
import { thumbnailEvents } from "./thumbnail";
import type { AppState, PendingOpenInfo, PlaylistOptions, PlaylistRequest, SortMode, UiSettingsPatch } from "../shared/types";

const WINDOW_BASE_WIDTH = 1120;
const WINDOW_BASE_HEIGHT = 760;
const PLAYLIST_WIDTH = 360;
const APP_ICON_RELATIVE_PATH = path.join("assets", "icons", "app-icon.png");
const PLYER_SCHEME = "plyer";
const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

const SETTINGS_KEYS = {
  playlistVisible: "ui.playlist_visible",
  volume: "ui.volume",
  muted: "ui.muted",
  loopPlaylist: "ui.loop_playlist",
  detailsVisible: "ui.details_visible",
  sort: "ui.sort",
  ratingMin: "ui.rating_min",
  tags: "ui.tags",
  currentMediaPath: "ui.current_media_path",
  windowBounds: "window.bounds"
} as const;

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RootSettings {
  playlistVisible: boolean;
  volume: number;
  muted: boolean;
  loopPlaylist: boolean;
  detailsVisible: boolean;
  options: PlaylistOptions;
  currentMediaPath: string | null;
  windowBounds: WindowBounds | null;
}

let mainWindow: BrowserWindow | null = null;
let pendingOpen: PendingOpenInfo | null = null;
const library = new LibraryManager();
const config = loadConfig();
let playlistVisible = config.playlistVisible ?? true;
let startupWindowBounds: WindowBounds | null = null;
let windowBoundsSaveTimer: NodeJS.Timeout | null = null;
const appIconPath = resolveAppIconPath();

protocol.registerSchemesAsPrivileged([
  {
    scheme: PLYER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function getMimeType(filePath: string) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveAppIconPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, APP_ICON_RELATIVE_PATH)]
    : [path.resolve(__dirname, "../../../", APP_ICON_RELATIVE_PATH), path.resolve(process.cwd(), APP_ICON_RELATIVE_PATH)];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function getHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
  headerName: string
) {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(headerName);
    return value ?? undefined;
  }
  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(value)) return value.join(", ");
    return value;
  }
  return undefined;
}

function toWebStream(stream: fs.ReadStream) {
  return Readable.toWeb(stream) as any;
}

function parseBoolean(value: string | null, fallback: boolean) {
  if (value == null) return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return fallback;
}

function parseNumber(value: string | null, fallback: number, min?: number, max?: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const lowerBounded = min == null ? parsed : Math.max(parsed, min);
  return max == null ? lowerBounded : Math.min(lowerBounded, max);
}

function parseSortMode(value: string | null): SortMode {
  if (value === "playlist" || value === "filename" || value === "created" || value === "random") {
    return value;
  }
  return "playlist";
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
  } catch {
    return [];
  }
}

function parseWindowBounds(value: string | null): WindowBounds | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<WindowBounds>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return null;
    }
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    if (parsed.width < 360 || parsed.height < 240) return null;
    return {
      x: Math.round(parsed.x),
      y: Math.round(parsed.y),
      width: Math.round(parsed.width),
      height: Math.round(parsed.height)
    };
  } catch {
    return null;
  }
}

function normalizeRelativeMediaPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = path.normalize(value).replace(/^[\\/]+/, "");
  if (!normalized || normalized === ".") return null;
  if (path.isAbsolute(normalized) || normalized.startsWith("..")) return null;
  return normalized;
}

function readRootSettings(): RootSettings {
  const root = library.getRoot();
  const playlistVisibleFallback = root ? true : playlistVisible;
  const settingPlaylistVisible = library.getSetting(SETTINGS_KEYS.playlistVisible);
  const settingVolume = library.getSetting(SETTINGS_KEYS.volume);
  const settingMuted = library.getSetting(SETTINGS_KEYS.muted);
  const settingLoopPlaylist = library.getSetting(SETTINGS_KEYS.loopPlaylist);
  const settingDetailsVisible = library.getSetting(SETTINGS_KEYS.detailsVisible);
  const settingSort = library.getSetting(SETTINGS_KEYS.sort);
  const settingRatingMin = library.getSetting(SETTINGS_KEYS.ratingMin);
  const settingTags = library.getSetting(SETTINGS_KEYS.tags);
  const settingCurrentMediaPath = library.getSetting(SETTINGS_KEYS.currentMediaPath);
  const settingWindowBounds = library.getSetting(SETTINGS_KEYS.windowBounds);

  return {
    playlistVisible: parseBoolean(settingPlaylistVisible, playlistVisibleFallback),
    volume: parseNumber(settingVolume, 0.85, 0, 1),
    muted: parseBoolean(settingMuted, false),
    loopPlaylist: parseBoolean(settingLoopPlaylist, false),
    detailsVisible: parseBoolean(settingDetailsVisible, true),
    options: {
      sort: parseSortMode(settingSort),
      ratingMin: parseNumber(settingRatingMin, 0, 0, 5),
      tags: parseTags(settingTags)
    },
    currentMediaPath: normalizeRelativeMediaPath(settingCurrentMediaPath),
    windowBounds: parseWindowBounds(settingWindowBounds)
  };
}

function toAbsoluteMediaPath(relativePath: string | null) {
  const root = library.getRoot();
  if (!root || !relativePath) return null;
  return path.join(root, relativePath);
}

function persistWindowBounds(bounds: WindowBounds) {
  library.setSetting(SETTINGS_KEYS.windowBounds, JSON.stringify(bounds));
}

function flushWindowBoundsSave() {
  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
  }
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  persistWindowBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  });
}

function scheduleWindowBoundsSave() {
  if (!mainWindow) return;
  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer);
  }
  windowBoundsSaveTimer = setTimeout(() => {
    flushWindowBoundsSave();
  }, 200);
}

function buildAppState(): AppState {
  const settings = readRootSettings();
  playlistVisible = settings.playlistVisible;

  return {
    libraryRoot: library.getRoot(),
    pendingOpen,
    playlistVisible,
    volume: settings.volume,
    muted: settings.muted,
    loopPlaylist: settings.loopPlaylist,
    detailsVisible: settings.detailsVisible,
    options: settings.options,
    currentMediaPath: toAbsoluteMediaPath(settings.currentMediaPath)
  };
}

function syncRootSettingsToRuntime() {
  const settings = readRootSettings();
  playlistVisible = settings.playlistVisible;

  if (!mainWindow) {
    startupWindowBounds = settings.windowBounds;
    return;
  }

  if (settings.windowBounds) {
    mainWindow.setBounds(settings.windowBounds);
  } else {
    updateWindowForPlaylist();
  }
}

function applyUiSettingsPatch(patch: UiSettingsPatch) {
  if (typeof patch.volume === "number" && Number.isFinite(patch.volume)) {
    library.setSetting(SETTINGS_KEYS.volume, String(Math.max(0, Math.min(1, patch.volume))));
  }

  if (typeof patch.muted === "boolean") {
    library.setSetting(SETTINGS_KEYS.muted, patch.muted ? "1" : "0");
  }

  if (typeof patch.loopPlaylist === "boolean") {
    library.setSetting(SETTINGS_KEYS.loopPlaylist, patch.loopPlaylist ? "1" : "0");
  }

  if (typeof patch.detailsVisible === "boolean") {
    library.setSetting(SETTINGS_KEYS.detailsVisible, patch.detailsVisible ? "1" : "0");
  }

  if (patch.options) {
    const sort = parseSortMode(patch.options.sort);
    const ratingMin = Math.max(0, Math.min(5, Math.trunc(Number(patch.options.ratingMin) || 0)));
    const tags = Array.isArray(patch.options.tags)
      ? patch.options.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [];

    library.setSetting(SETTINGS_KEYS.sort, sort);
    library.setSetting(SETTINGS_KEYS.ratingMin, String(ratingMin));
    library.setSetting(SETTINGS_KEYS.tags, JSON.stringify(tags));
  }

  if (patch.currentMediaPath !== undefined) {
    library.setSetting(SETTINGS_KEYS.currentMediaPath, normalizeRelativeMediaPath(patch.currentMediaPath));
  }
}

function createWindow() {
  const width = startupWindowBounds?.width ?? (playlistVisible ? WINDOW_BASE_WIDTH + PLAYLIST_WIDTH : WINDOW_BASE_WIDTH);
  const height = startupWindowBounds?.height ?? WINDOW_BASE_HEIGHT;
  mainWindow = new BrowserWindow({
    x: startupWindowBounds?.x,
    y: startupWindowBounds?.y,
    width,
    height,
    minWidth: 360,
    minHeight: 240,
    titleBarStyle: "default",
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "../../preload/preload/index.js")
    }
  });
  startupWindowBounds = null;

  if (process.platform !== "darwin") {
    mainWindow.setMenu(null);
    Menu.setApplicationMenu(null);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    sendPendingOpen();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("resize", () => {
    scheduleWindowBoundsSave();
  });

  mainWindow.on("move", () => {
    scheduleWindowBoundsSave();
  });

  mainWindow.on("close", () => {
    flushWindowBoundsSave();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const target = resolveInitialTarget();
  if (target) {
    applyInitialTarget(target);
  }

  sendPendingOpen();
}

function updateWindowForPlaylist() {
  if (!mainWindow) return;
  const [, height] = mainWindow.getSize();
  const width = playlistVisible ? WINDOW_BASE_WIDTH + PLAYLIST_WIDTH : WINDOW_BASE_WIDTH;
  if (mainWindow.getSize()[0] !== width) {
    mainWindow.setSize(width, height, true);
  }
}

type CliTarget = { path: string; kind: "file" | "folder" };

function resolveInitialTarget(): CliTarget | null {
  const startIndex = process.defaultApp ? 2 : 1;
  const args = process.argv.slice(startIndex);
  for (const arg of args) {
    if (!arg || arg.startsWith("-")) continue;
    const resolved = path.resolve(arg);
    if (!fs.existsSync(resolved)) continue;
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) return { path: resolved, kind: "folder" };
      if (stat.isFile()) return { path: resolved, kind: "file" };
    } catch {
      // ignore
    }
  }
  return null;
}

function setRootAndPersist(root: string) {
  library.setRoot(root);
  config.lastRoot = root;
  saveConfig(config);
  syncRootSettingsToRuntime();
}

function applyInitialTarget(target: CliTarget) {
  if (target.kind === "folder") {
    setRootAndPersist(target.path);
    return;
  }

  let root: string | null = null;
  try {
    const info = inspectPath(target.path, library.getRoot());
    if (info.kind === "file") {
      root = info.foundDbRoot ?? info.suggestedRoot;
    }
  } catch {
    root = path.dirname(target.path);
  }

  if (root) {
    setRootAndPersist(root);
  }

  if (isVideoFile(target.path)) {
    setPendingOpen(target.path);
  }
}

function setPendingOpen(targetPath: string) {
  try {
    pendingOpen = inspectPath(targetPath, library.getRoot());
  } catch {
    pendingOpen = null;
  }
  sendPendingOpen();
}

function sendPendingOpen() {
  if (mainWindow && pendingOpen) {
    mainWindow.webContents.send("app:pending-open", pendingOpen);
  }
}

function registerMediaShortcuts() {
  const send = (action: "toggle" | "next" | "previous") => {
    mainWindow?.webContents.send("media-control", action);
  };

  globalShortcut.register("MediaPlayPause", () => send("toggle"));
  globalShortcut.register("MediaNextTrack", () => send("next"));
  globalShortcut.register("MediaPreviousTrack", () => send("previous"));
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (filePath) {
    setPendingOpen(filePath);
  }
});

app.whenReady().then(() => {
  if (process.platform === "darwin" && appIconPath) {
    app.dock.setIcon(appIconPath);
  }

  protocol.handle(PLYER_SCHEME, async (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (url.hostname) {
      filePath = path.join("/", url.hostname, filePath);
    }
    if (process.platform === "win32" && filePath.startsWith("/")) {
      filePath = filePath.slice(1);
    }

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return new Response("Not found", { status: 404 });
      }

      const size = stat.size;
      const mimeType = getMimeType(filePath);
      const range = getHeaderValue(request.headers, "range");
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        if (match) {
          let start = match[1] ? Number.parseInt(match[1], 10) : undefined;
          let end = match[2] ? Number.parseInt(match[2], 10) : undefined;

          if (Number.isNaN(start)) start = undefined;
          if (Number.isNaN(end)) end = undefined;

          if (start === undefined && end !== undefined) {
            start = Math.max(size - end, 0);
            end = size - 1;
          } else {
            if (start === undefined) start = 0;
            if (end === undefined || end >= size) end = size - 1;
          }

          if (start >= size || end < start) {
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${size}` }
            });
          }

          const stream = fs.createReadStream(filePath, { start, end });
          const chunkSize = end - start + 1;
          return new Response(toWebStream(stream), {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunkSize),
              "Content-Type": mimeType
            }
          });
        }
      }

      const stream = fs.createReadStream(filePath);
      return new Response(toWebStream(stream), {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(size),
          "Content-Type": mimeType
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  if (config.lastRoot && fs.existsSync(path.join(config.lastRoot, ".playr.sqlite"))) {
    library.setRoot(config.lastRoot);
    syncRootSettingsToRuntime();
  }

  createWindow();
  registerMediaShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  flushWindowBoundsSave();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:get-state", () => {
  return buildAppState();
});

ipcMain.handle("app:clear-pending", () => {
  pendingOpen = null;
});

ipcMain.handle("library:choose-root", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Choose a library folder"
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle("library:inspect-path", (_event, targetPath?: string) => {
  if (!targetPath || typeof targetPath !== "string") {
    return null;
  }
  try {
    return inspectPath(targetPath, library.getRoot());
  } catch {
    return null;
  }
});

ipcMain.handle("library:set-root", (_event, root: string) => {
  setRootAndPersist(root);
  pendingOpen = null;
  return buildAppState();
});

ipcMain.handle("library:scan", () => {
  return library.scanLibrary();
});

ipcMain.handle("playlist:get", (_event, options: PlaylistRequest) => {
  return library.getPlaylist(options);
});

ipcMain.handle("file:set-rating", (_event, payload: { fileId: number; rating: number }) => {
  library.setRating(payload.fileId, payload.rating);
});

ipcMain.handle("file:set-duration", (_event, payload: { fileId: number; durationMs: number }) => {
  library.setDuration(payload.fileId, payload.durationMs);
});

ipcMain.handle("file:set-last-played", (_event, fileId: number) => {
  library.setLastPlayed(fileId);
});

ipcMain.handle("file:toggle-tag", (_event, payload: { fileId: number; tagName: string }) => {
  library.toggleTag(payload.fileId, payload.tagName);
});

ipcMain.handle("tag:add", (_event, tagName: string) => {
  library.addTag(tagName);
});

ipcMain.handle("tag:top", () => {
  return library.getTopTags();
});

ipcMain.handle("playlist:save-order", (_event, fileIds: number[]) => {
  library.saveOrder(fileIds);
});

ipcMain.handle("window:playlist-visible", (_event, visible: boolean) => {
  playlistVisible = visible;
  config.playlistVisible = visible;
  saveConfig(config);
  library.setSetting(SETTINGS_KEYS.playlistVisible, visible ? "1" : "0");
  updateWindowForPlaylist();
  scheduleWindowBoundsSave();
  return buildAppState();
});

ipcMain.handle("settings:update", (_event, patch: UiSettingsPatch) => {
  applyUiSettingsPatch(patch);
  return buildAppState();
});

ipcMain.handle("file:reveal", (_event, absolutePath: string) => {
  shell.showItemInFolder(absolutePath);
});

thumbnailEvents.on("ready", (job: { filePath: string; thumbPath: string }) => {
  if (!mainWindow || !library.getRoot()) return;
  const thumbnailUrl = pathToFileURL(job.thumbPath).toString().replace("file://", `${PLYER_SCHEME}://`);
  mainWindow.webContents.send("library:thumbnail-ready", {
    filePath: job.filePath,
    thumbPath: job.thumbPath,
    thumbnailUrl
  });
});
