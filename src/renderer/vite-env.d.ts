/// <reference types="vite/client" />

import type { PendingOpenInfo, PlaylistRequest, PlaylistResponse } from "@shared/types";
import type { AppState, UiSettingsPatch } from "@shared/types";

declare global {
  interface Window {
    api: {
      getAppState: () => Promise<AppState>;
      chooseLibraryRoot: () => Promise<string | null>;
      inspectPath: (path: string) => Promise<PendingOpenInfo | null>;
      setLibraryRoot: (root: string) => Promise<AppState>;
      scanLibrary: () => Promise<{ added: number; removed: number; updated: number }>;
      getPlaylist: (options: PlaylistRequest) => Promise<PlaylistResponse>;
      setRating: (fileId: number, rating: number) => Promise<void>;
      toggleTag: (fileId: number, tagName: string) => Promise<void>;
      addTag: (tagName: string) => Promise<void>;
      getTopTags: () => Promise<string[]>;
      getMostUsedTags: (limit?: number) => Promise<string[]>;
      saveOrder: (fileIds: number[]) => Promise<void>;
      setDuration: (fileId: number, durationMs: number) => Promise<void>;
      setLastPlayed: (fileId: number) => Promise<void>;
      onPendingOpen: (cb: (info: PendingOpenInfo) => void) => () => void;
      onMediaControl: (cb: (action: "toggle" | "next" | "previous") => void) => () => void;
      onThumbnailReady: (
        cb: (payload: { filePath: string; thumbPath: string; thumbnailUrl: string }) => void
      ) => () => void;
      clearPendingOpen: () => Promise<void>;
      setPlaylistVisible: (visible: boolean) => Promise<AppState>;
      updateSettings: (patch: UiSettingsPatch) => Promise<AppState>;
      revealInFolder: (absolutePath: string) => Promise<void>;
    };
  }
}

export {};
