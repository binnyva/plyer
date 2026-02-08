/// <reference types="vite/client" />

import type { FileItem, PendingOpenInfo, PlaylistOptions } from "@shared/types";

declare global {
  interface Window {
    api: {
      getAppState: () => Promise<{
        libraryRoot: string | null;
        pendingOpen: PendingOpenInfo | null;
        playlistVisible: boolean;
      }>;
      chooseLibraryRoot: () => Promise<string | null>;
      inspectPath: (path: string) => Promise<PendingOpenInfo | null>;
      setLibraryRoot: (root: string) => Promise<void>;
      scanLibrary: () => Promise<{ added: number; removed: number; updated: number }>;
      getPlaylist: (options: PlaylistOptions) => Promise<FileItem[]>;
      setRating: (fileId: number, rating: number) => Promise<void>;
      toggleTag: (fileId: number, tagName: string) => Promise<void>;
      addTag: (tagName: string) => Promise<void>;
      getTopTags: () => Promise<string[]>;
      saveOrder: (fileIds: number[]) => Promise<void>;
      setDuration: (fileId: number, durationMs: number) => Promise<void>;
      setLastPlayed: (fileId: number) => Promise<void>;
      onPendingOpen: (cb: (info: PendingOpenInfo) => void) => () => void;
      onMediaControl: (cb: (action: "toggle" | "next" | "previous") => void) => () => void;
      onThumbnailReady: (cb: () => void) => () => void;
      clearPendingOpen: () => Promise<void>;
      setPlaylistVisible: (visible: boolean) => Promise<void>;
      revealInFolder: (absolutePath: string) => Promise<void>;
    };
  }
}

export {};
