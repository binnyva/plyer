export type SortMode = "playlist" | "filename" | "created" | "random";

export interface PlaylistOptions {
  sort: SortMode;
  ratingMin: number;
  tags: string[];
}

export interface FileItem {
  id: number;
  path: string;
  name: string;
  ext: string;
  durationMs: number;
  rating: number;
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
