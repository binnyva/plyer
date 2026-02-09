import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, shell } from "electron";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { LibraryManager, inspectPath, isVideoFile } from "./library";
import { loadConfig, saveConfig } from "./config";
import { thumbnailEvents } from "./thumbnail";
import type { PendingOpenInfo, PlaylistRequest } from "../shared/types";

const WINDOW_BASE_WIDTH = 1120;
const WINDOW_BASE_HEIGHT = 760;
const PLAYLIST_WIDTH = 360;
const PLYER_SCHEME = "plyer";

let mainWindow: BrowserWindow | null = null;
let pendingOpen: PendingOpenInfo | null = null;
const library = new LibraryManager();
const config = loadConfig();
let playlistVisible = config.playlistVisible ?? true;

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

function createWindow() {
  const width = playlistVisible ? WINDOW_BASE_WIDTH + PLAYLIST_WIDTH : WINDOW_BASE_WIDTH;
  mainWindow = new BrowserWindow({
    width,
    height: WINDOW_BASE_HEIGHT,
    minWidth: 360,
    minHeight: 240,
    titleBarStyle: "default",
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "../../preload/preload/index.js")
    }
  });

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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (config.lastRoot && fs.existsSync(path.join(config.lastRoot, ".playr.sqlite"))) {
    library.setRoot(config.lastRoot);
  }

  const target = resolveInitialTarget();
  if (target) {
    setPendingOpen(target);
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

function resolveInitialTarget() {
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (!arg || arg.startsWith("-")) continue;
    const resolved = path.resolve(arg);
    if (!fs.existsSync(resolved)) continue;
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile() && isVideoFile(resolved)) return resolved;
    } catch {
      // ignore
    }
  }
  return null;
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
  protocol.handle(PLYER_SCHEME, (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (url.hostname) {
      filePath = path.join("/", url.hostname, filePath);
    }
    if (process.platform === "win32" && filePath.startsWith("/")) {
      filePath = filePath.slice(1);
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
  registerMediaShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:get-state", () => {
  return {
    libraryRoot: library.getRoot(),
    pendingOpen,
    playlistVisible
  };
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
  library.setRoot(root);
  pendingOpen = null;
  config.lastRoot = root;
  saveConfig(config);
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
  updateWindowForPlaylist();
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
