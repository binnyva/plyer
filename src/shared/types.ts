export type SortMode = "playlist" | "filename" | "created" | "random";

export const NOTE_MAX_LENGTH = 1204;

export type KeyboardShortcutAction =
  | "togglePlay"
  | "next"
  | "previous"
  | "rate0"
  | "rate1"
  | "rate2"
  | "rate3"
  | "rate4"
  | "rate5"
  | "togglePlaylist"
  | "toggleMuted"
  | "openTagMenu";

export type KeyboardShortcuts = Record<KeyboardShortcutAction, string>;

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  togglePlay: "Space",
  next: "CmdOrCtrl+Right",
  previous: "CmdOrCtrl+Left",
  rate0: "0",
  rate1: "1",
  rate2: "2",
  rate3: "3",
  rate4: "4",
  rate5: "5",
  togglePlaylist: "CmdOrCtrl+L",
  toggleMuted: "CmdOrCtrl+M",
  openTagMenu: "CmdOrCtrl+T"
};

export type AppMenuCommand =
  | { type: "choose-library-root" }
  | { type: "rescan-library" }
  | { type: "toggle-play" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "delete-current-video" }
  | { type: "open-tag-menu" }
  | { type: "edit-note" }
  | { type: "set-rating"; rating: number }
  | { type: "toggle-tag"; tag: string }
  | { type: "set-muted"; muted: boolean }
  | { type: "set-details-visible"; visible: boolean }
  | { type: "set-playlist-visible"; visible: boolean }
  | { type: "set-sort"; sort: SortMode }
  | { type: "set-rating-filter"; ratingMin: number }
  | { type: "toggle-tag-filter"; tag: string }
  | { type: "set-untagged-filter"; enabled: boolean }
  | { type: "set-loop-playlist"; enabled: boolean };

export interface PlaylistOptions {
  sort: SortMode;
  ratingMin: number;
  tags: string[];
  untaggedOnly: boolean;
}

export interface PlaylistRequest extends PlaylistOptions {
  limit?: number;
  offset?: number;
  seed?: number;
}

export interface PlaylistResponse {
  items: FileItem[];
  total: number;
}

export interface FileItem {
  id: number;
  path: string;
  name: string;
  ext: string;
  durationMs: number;
  rating: number;
  note: string;
  size: number;
  mtime: number;
  createdMs: number;
  orderIndex: number;
  tags: string[];
  absolutePath: string;
  fileUrl: string;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
}

export interface PendingOpenInfo {
  kind: "folder" | "file";
  path: string;
  inCurrentRoot: boolean;
  suggestedRoot: string;
  foundDbRoot: string | null;
  fileUrl?: string | null;
}

export interface AppState {
  libraryRoot: string | null;
  pendingOpen: PendingOpenInfo | null;
  playlistVisible: boolean;
  volume: number;
  muted: boolean;
  loopPlaylist: boolean;
  detailsVisible: boolean;
  keyboardShortcuts: KeyboardShortcuts;
  options: PlaylistOptions;
  currentMediaPath: string | null;
}

export interface UiSettingsPatch {
  volume?: number;
  muted?: boolean;
  loopPlaylist?: boolean;
  detailsVisible?: boolean;
  keyboardShortcuts?: Partial<KeyboardShortcuts>;
  options?: PlaylistOptions;
  currentMediaPath?: string | null;
}
