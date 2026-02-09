import { contextBridge, ipcRenderer } from "electron";
import type { PendingOpenInfo, PlaylistRequest } from "../shared/types";

contextBridge.exposeInMainWorld("api", {
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  chooseLibraryRoot: () => ipcRenderer.invoke("library:choose-root"),
  inspectPath: (path: string): Promise<PendingOpenInfo | null> =>
    ipcRenderer.invoke("library:inspect-path", path),
  setLibraryRoot: (root: string) => ipcRenderer.invoke("library:set-root", root),
  scanLibrary: () => ipcRenderer.invoke("library:scan"),
  getPlaylist: (options: PlaylistRequest) => ipcRenderer.invoke("playlist:get", options),
  setRating: (fileId: number, rating: number) => ipcRenderer.invoke("file:set-rating", { fileId, rating }),
  toggleTag: (fileId: number, tagName: string) =>
    ipcRenderer.invoke("file:toggle-tag", { fileId, tagName }),
  addTag: (tagName: string) => ipcRenderer.invoke("tag:add", tagName),
  getTopTags: () => ipcRenderer.invoke("tag:top"),
  saveOrder: (fileIds: number[]) => ipcRenderer.invoke("playlist:save-order", fileIds),
  setDuration: (fileId: number, durationMs: number) =>
    ipcRenderer.invoke("file:set-duration", { fileId, durationMs }),
  setLastPlayed: (fileId: number) => ipcRenderer.invoke("file:set-last-played", fileId),
  onPendingOpen: (cb: (info: PendingOpenInfo) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: PendingOpenInfo) => cb(info);
    ipcRenderer.on("app:pending-open", handler);
    return () => ipcRenderer.removeListener("app:pending-open", handler);
  },
  onMediaControl: (cb: (action: "toggle" | "next" | "previous") => void) => {
    const handler = (_: Electron.IpcRendererEvent, action: "toggle" | "next" | "previous") =>
      cb(action);
    ipcRenderer.on("media-control", handler);
    return () => ipcRenderer.removeListener("media-control", handler);
  },
  onThumbnailReady: (cb: (payload: { filePath: string; thumbPath: string; thumbnailUrl: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { filePath: string; thumbPath: string; thumbnailUrl: string }) =>
      cb(payload);
    ipcRenderer.on("library:thumbnail-ready", handler);
    return () => ipcRenderer.removeListener("library:thumbnail-ready", handler);
  },
  clearPendingOpen: () => ipcRenderer.invoke("app:clear-pending"),
  setPlaylistVisible: (visible: boolean) => ipcRenderer.invoke("window:playlist-visible", visible),
  revealInFolder: (absolutePath: string) => ipcRenderer.invoke("file:reveal", absolutePath)
});
