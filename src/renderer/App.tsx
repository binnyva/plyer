import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, FileItem, PendingOpenInfo, PlaylistOptions, SortMode } from "@shared/types";

const SORT_LABELS: Record<SortMode, string> = {
  playlist: "Playlist Order",
  filename: "Filename",
  created: "Created Time",
  random: "Random"
};

const RATING_OPTIONS = [0, 1, 2, 3, 4, 5];
const DEFAULT_OPTIONS: PlaylistOptions = {
  sort: "playlist",
  ratingMin: 0,
  tags: []
};
const PAGE_SIZE = 50;

function mergeUniqueById(existing: FileItem[], incoming: FileItem[]) {
  const seen = new Set<number>();
  const merged: FileItem[] = [];
  for (const item of [...existing, ...incoming]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastPlayedRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const itemsRef = useRef<FileItem[]>([]);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(false);
  const totalCountRef = useRef(0);
  const settingsHydratedRef = useRef(false);
  const restoreMediaPathRef = useRef<string | null>(null);
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<PendingOpenInfo | null>(null);
  const [playlistVisible, setPlaylistVisible] = useState(true);
  const [items, setItems] = useState<FileItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [randomSeed, setRandomSeed] = useState(() => Date.now());
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [externalFile, setExternalFile] = useState<{ name: string; url: string; path: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [loopPlaylist, setLoopPlaylist] = useState(false);
  const [options, setOptions] = useState<PlaylistOptions>(DEFAULT_OPTIONS);
  const [status, setStatus] = useState<string | null>(null);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [ratingMenuOpen, setRatingMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(true);
  const [topTags, setTopTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagFilterQuery, setTagFilterQuery] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const ratingMenuRef = useRef<HTMLDivElement>(null);
  const tagButtonRef = useRef<HTMLButtonElement>(null);
  const ratingButtonRef = useRef<HTMLButtonElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const applyAppState = (state: AppState) => {
    setLibraryRoot(state.libraryRoot);
    setPendingOpen(state.pendingOpen);
    setPlaylistVisible(state.playlistVisible);
    setVolume(state.volume);
    setMuted(state.muted);
    setLoopPlaylist(state.loopPlaylist);
    setDetailsVisible(state.detailsVisible);
    setOptions({
      sort: state.options.sort,
      ratingMin: state.options.ratingMin,
      tags: [...state.options.tags]
    });
    restoreMediaPathRef.current = state.currentMediaPath;
    settingsHydratedRef.current = true;
  };

  const currentItem = useMemo(() => items.find((item) => item.id === currentId) ?? null, [items, currentId]);
  const isRated = (currentItem?.rating ?? 0) > 0;
  const filteredPlayerTags = useMemo(() => {
    const query = tagDraft.trim().toLowerCase();
    if (!query) return topTags;
    return topTags.filter((tag) => tag.toLowerCase().includes(query));
  }, [topTags, tagDraft]);
  const filteredTags = useMemo(() => {
    const query = tagFilterQuery.trim().toLowerCase();
    if (!query) return topTags;
    return topTags.filter((tag) => tag.toLowerCase().includes(query));
  }, [topTags, tagFilterQuery]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      document.documentElement.classList.toggle("dark", mediaQuery.matches);
    };
    updateTheme();
    mediaQuery.addEventListener("change", updateTheme);
    return () => mediaQuery.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    totalCountRef.current = totalCount;
  }, [totalCount]);

  useEffect(() => {
    window.api.getAppState().then((state) => {
      applyAppState(state);
      if (state.libraryRoot) {
        scanAndRefresh(state.currentMediaPath);
      }
    });

    const unsubscribePending = window.api.onPendingOpen((info) => setPendingOpen(info));
    const unsubscribeMedia = window.api.onMediaControl((action) => {
      if (action === "toggle") {
        togglePlay();
      } else if (action === "next") {
        playNext();
      } else if (action === "previous") {
        playPrev();
      }
    });
    const unsubscribeThumbs = window.api.onThumbnailReady((payload) => {
      setItems((prev) => {
        const index = prev.findIndex((item) => item.absolutePath === payload.filePath);
        if (index === -1) return prev;
        const next = [...prev];
        const existing = next[index];
        next[index] = {
          ...existing,
          thumbnailPath: payload.thumbPath,
          thumbnailUrl: payload.thumbnailUrl
        };
        return next;
      });
    });

    return () => {
      unsubscribePending();
      unsubscribeMedia();
      unsubscribeThumbs();
    };
  }, []);

  useEffect(() => {
    if (!libraryRoot || scanningRef.current) return;
    const restorePath = restoreMediaPathRef.current;
    restoreMediaPathRef.current = null;

    (async () => {
      await loadPlaylistPage(0, true);
      if (restorePath) {
        await playByAbsolutePath(restorePath);
      }
    })();
  }, [libraryRoot, options.sort, options.ratingMin, options.tags.join("|"), randomSeed]);

  useEffect(() => {
    if (!currentId && items.length) {
      setCurrentId(items[0].id);
    }
  }, [items, currentId]);

  useEffect(() => {
    if (externalFile && videoRef.current) {
      videoRef.current.src = externalFile.url;
      videoRef.current.play().catch(() => null);
    }
  }, [externalFile]);

  useEffect(() => {
    if (!currentItem || !videoRef.current) return;
    if (externalFile) return;

    videoRef.current.load();
    videoRef.current.play().catch(() => null);
  }, [currentItem?.id]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    lastPlayedRef.current = null;
  }, [currentItem?.id, externalFile?.path]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (!currentItem || externalFile) return;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentItem.name,
        artist: libraryRoot ?? "",
        artwork: currentItem.thumbnailUrl
          ? [{ src: currentItem.thumbnailUrl, sizes: "320x180", type: "image/jpeg" }]
          : []
      });
      navigator.mediaSession.setActionHandler("play", () => videoRef.current?.play().catch(() => null));
      navigator.mediaSession.setActionHandler("pause", () => videoRef.current?.pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
      navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    }
  }, [currentItem?.id, libraryRoot, externalFile]);

  useEffect(() => {
    if (!tagMenuOpen && !filterMenuOpen) return;
    window.api.getTopTags().then((tags) => setTopTags(tags));
  }, [tagMenuOpen, filterMenuOpen]);

  useEffect(() => {
    if (!tagMenuOpen) return;
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }, [tagMenuOpen]);

  useEffect(() => {
    if (!tagMenuOpen) {
      setTagDraft("");
    }
  }, [tagMenuOpen]);

  useEffect(() => {
    if (!filterMenuOpen) {
      setTagFilterQuery("");
    }
  }, [filterMenuOpen]);

  useEffect(() => {
    if (!tagMenuOpen && !ratingMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const clickedTagMenu = tagMenuRef.current?.contains(target) ?? false;
      const clickedRatingMenu = ratingMenuRef.current?.contains(target) ?? false;
      const clickedTagButton = tagButtonRef.current?.contains(target) ?? false;
      const clickedRatingButton = ratingButtonRef.current?.contains(target) ?? false;

      if (tagMenuOpen && !clickedTagMenu && !clickedTagButton) {
        setTagMenuOpen(false);
      }
      if (ratingMenuOpen && !clickedRatingMenu && !clickedRatingButton) {
        setRatingMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [tagMenuOpen, ratingMenuOpen]);

  useEffect(() => {
    if (!tagMenuOpen && !ratingMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (tagMenuOpen) {
        setTagMenuOpen(false);
      }
      if (ratingMenuOpen) {
        setRatingMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tagMenuOpen, ratingMenuOpen]);

  useEffect(() => {
    if (!libraryRoot || !settingsHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      window.api.updateSettings({
        volume,
        muted,
        loopPlaylist,
        detailsVisible,
        options
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    libraryRoot,
    volume,
    muted,
    loopPlaylist,
    detailsVisible,
    options.sort,
    options.ratingMin,
    options.tags.join("|")
  ]);

  useEffect(() => {
    if (!libraryRoot || !settingsHydratedRef.current) return;
    const mediaPath = externalFile ? null : currentItem?.path ?? null;
    window.api.updateSettings({ currentMediaPath: mediaPath });
  }, [libraryRoot, externalFile?.path, currentItem?.id]);

  const buildPlaylistRequest = (offset: number) => ({
    ...options,
    limit: PAGE_SIZE,
    offset,
    seed: options.sort === "random" ? randomSeed : undefined
  });

  const loadPlaylistPage = async (offset: number, reset: boolean) => {
    loadingRef.current = true;
    setIsLoadingPage(true);
    try {
      const result = await window.api.getPlaylist(buildPlaylistRequest(offset));
      const nextItems = reset ? mergeUniqueById([], result.items) : mergeUniqueById(itemsRef.current, result.items);
      itemsRef.current = nextItems;
      setItems(nextItems);
      setTotalCount(result.total);
      const nextCount = nextItems.length;
      const nextHasMore = nextCount < result.total;
      setHasMore(nextHasMore);
      hasMoreRef.current = nextHasMore;
      totalCountRef.current = result.total;
      setStatus(null);
      if (reset) {
        setCurrentId((prev) =>
          prev && result.items.some((item) => item.id === prev) ? prev : result.items[0]?.id ?? null
        );
      }
      return result;
    } finally {
      loadingRef.current = false;
      setIsLoadingPage(false);
    }
  };

  const loadMore = async () => {
    if (loadingRef.current || !hasMore) return;
    const offset = itemsRef.current.length;
    await loadPlaylistPage(offset, false);
  };

  const scanAndRefresh = async (restorePath?: string | null) => {
    scanningRef.current = true;
    setStatus("Scanning library...");
    try {
      await window.api.scanLibrary();
      await loadPlaylistPage(0, true);
      if (restorePath) {
        await playByAbsolutePath(restorePath);
      }
    } finally {
      scanningRef.current = false;
      setStatus(null);
    }
  };

  const handleChooseRoot = async () => {
    const root = await window.api.chooseLibraryRoot();
    if (!root) return;
    const state = await window.api.setLibraryRoot(root);
    applyAppState(state);
    await scanAndRefresh(state.currentMediaPath);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.path) return;
    const info = await window.api.inspectPath(file.path);
    if (!info) return;
    setPendingOpen(info);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  const resolvePending = async (action: "switch" | "play" | "cancel") => {
    if (!pendingOpen) return;
    const info = pendingOpen;
    setPendingOpen(null);
    await window.api.clearPendingOpen();

    if (action === "cancel") return;

    if (info.kind === "folder") {
      if (action === "switch") {
        const state = await window.api.setLibraryRoot(info.path);
        applyAppState(state);
        await scanAndRefresh(state.currentMediaPath);
      }
      return;
    }

    if (info.kind === "file" && info.inCurrentRoot) {
      await playByAbsolutePath(info.path);
      return;
    }

    if (action === "play") {
      const url = info.fileUrl ?? new URL(`file://${info.path}`).toString();
      setExternalFile({ name: fileName(info.path), url, path: info.path });
      setCurrentId(null);
      return;
    }

    if (action === "switch") {
      const root = info.foundDbRoot ?? info.suggestedRoot;
      const state = await window.api.setLibraryRoot(root);
      applyAppState(state);
      await scanAndRefresh(state.currentMediaPath);
      await playByAbsolutePath(info.path);
    }
  };

  const playByAbsolutePath = async (targetPath: string) => {
    const existing = itemsRef.current.find((item) => item.absolutePath === targetPath);
    if (existing) {
      setExternalFile(null);
      setCurrentId(existing.id);
      return;
    }

    setStatus("Loading playlist...");
    let offset = itemsRef.current.length;
    let total = totalCount;
    if (offset === 0) {
      const result = await loadPlaylistPage(0, true);
      total = result.total;
      const match = result.items.find((item) => item.absolutePath === targetPath);
      if (match) {
        setExternalFile(null);
        setCurrentId(match.id);
        setStatus(null);
        return;
      }
      offset = result.items.length;
    }

    while (offset < total) {
      const result = await loadPlaylistPage(offset, false);
      const match = result.items.find((item) => item.absolutePath === targetPath);
      if (match) {
        setExternalFile(null);
        setCurrentId(match.id);
        setStatus(null);
        return;
      }
      if (result.items.length === 0) break;
      offset += result.items.length;
      total = result.total;
    }

    setStatus(null);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => null);
    } else {
      video.pause();
    }
  };

  const playNext = async () => {
    if (!itemsRef.current.length || externalFile) return;
    if (loadingRef.current) return;
    const currentItems = itemsRef.current;
    const index = currentItems.findIndex((item) => item.id === currentId);
    if (index === -1) return;
    if (index < currentItems.length - 1) {
      setCurrentId(currentItems[index + 1].id);
      return;
    }

    const canLoadMore = () => hasMoreRef.current || itemsRef.current.length < totalCountRef.current;
    if (canLoadMore()) {
      const offset = itemsRef.current.length;
      const result = await loadPlaylistPage(offset, false);
      if (result.items.length > 0) {
        setCurrentId(result.items[0].id);
        return;
      }
    }
    if (loopPlaylist && !canLoadMore()) {
      const first = itemsRef.current[0];
      if (first) setCurrentId(first.id);
    }
  };

  const playPrev = () => {
    if (!items.length || externalFile) return;
    const video = videoRef.current;
    if (video && video.currentTime > 3) {
      video.currentTime = 0;
      return;
    }
    const index = items.findIndex((item) => item.id === currentId);
    if (index === -1) return;
    if (index > 0) {
      setCurrentId(items[index - 1].id);
    } else if (loopPlaylist && !hasMore) {
      setCurrentId(items[items.length - 1].id);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const durationSec = videoRef.current.duration || 0;
    setDuration(durationSec);
    if (currentItem) {
      window.api.setDuration(currentItem.id, Math.round(durationSec * 1000));
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    if (currentItem && lastPlayedRef.current !== currentItem.id) {
      window.api.setLastPlayed(currentItem.id);
      lastPlayedRef.current = currentItem.id;
    }
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const next = Number(event.target.value);
    videoRef.current.currentTime = next;
    setCurrentTime(next);
  };

  const handleVolume = (event: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(event.target.value));
    if (muted) setMuted(false);
  };

  const handleRating = async (value: number) => {
    if (!currentItem) return;
    await window.api.setRating(currentItem.id, value);
    setRatingMenuOpen(false);
    if (libraryRoot) loadPlaylistPage(0, true);
  };

  const handleTagToggle = async (tag: string) => {
    if (!currentItem) return;
    await window.api.toggleTag(currentItem.id, tag);
    if (libraryRoot) loadPlaylistPage(0, true);
  };

  const handleAddTag = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tag = tagDraft.trim();
    if (!tag || !currentItem) return;
    await window.api.toggleTag(currentItem.id, tag);
    setTagMenuOpen(false);
    setTagDraft("");
    if (libraryRoot) loadPlaylistPage(0, true);
    window.api.getTopTags().then((tags) => setTopTags(tags));
  };

  const handleFilterTag = (tag: string) => {
    setOptions((prev) => {
      const exists = prev.tags.includes(tag);
      return {
        ...prev,
        tags: exists ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag]
      };
    });
  };

  const handlePlaylistScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (loadingRef.current || !hasMore) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining < 160) {
      loadMore();
    }
  };

  const handleOrderMove = (from: number, to: number) => {
    if (from === to || options.sort !== "playlist" || hasMore) return;
    const updated = [...items];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setItems(updated);
    window.api.saveOrder(updated.map((item) => item.id));
  };

  const togglePlaylist = async () => {
    const next = !playlistVisible;
    setPlaylistVisible(next);
    const state = await window.api.setPlaylistVisible(next);
    setPlaylistVisible(state.playlistVisible);
  };

  const activeName = externalFile?.name ?? currentItem?.name ?? "";
  const currentPlaylistIndex = currentItem ? items.findIndex((item) => item.id === currentItem.id) : -1;
  const showPlaylistStatus = !externalFile && currentPlaylistIndex >= 0 && totalCount > 0;
  const isTagged = !!currentItem && !externalFile && currentItem.tags.length > 0;

  return (
    <div
      className="h-screen overflow-hidden p-0"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="mx-auto h-full max-w-[1600px] pt-1">

        <div
          className={`grid h-full min-h-0 grid-rows-1 gap-3 ${
            playlistVisible ? "grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"
          }`}
        >
          <section className="flex h-full min-h-0 flex-col space-y-2">
            <div className="video-frame relative flex min-h-0 flex-1 overflow-hidden bg-slate-900 shadow-soft">
              <div className="relative flex h-full w-full items-center justify-center">
                <video
                  ref={videoRef}
                  className="h-full w-full object-contain"
                  src={externalFile ? externalFile.url : currentItem?.fileUrl ?? ""}
                  onClick={togglePlay}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onEnded={playNext}
                  muted={muted}
                  controls={false}
                />
                {!activeName && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                    <div className="rounded-full border border-white/40 bg-white/10 px-5 py-2 text-xs uppercase tracking-[0.3em]">
                      Drop a folder or video
                    </div>
                    <p className="text-sm">Your playback starts here.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/70 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-nowrap items-center gap-4">
                <div className="flex items-center gap-3">
                  <button
                    className="rounded-2xl bg-ink-900 px-4 py-3 text-white shadow-soft transition hover:-translate-y-0.5"
                    onClick={playPrev}
                    title="Previous"
                    aria-label="Previous"
                  >
                    <PrevIcon />
                  </button>
                  <button
                    className="rounded-2xl bg-ocean px-4 py-3 text-white shadow-soft transition hover:-translate-y-0.5"
                    onClick={togglePlay}
                    title={isPlaying ? "Pause" : "Play"}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button
                    className="rounded-2xl bg-ink-900 px-4 py-3 text-white shadow-soft transition hover:-translate-y-0.5"
                    onClick={playNext}
                    title="Next"
                    aria-label="Next"
                  >
                    <NextIcon />
                  </button>
                </div>

                <div className="flex min-w-[260px] flex-1 items-center gap-3">
                  <span className="text-xs font-semibold text-ink-600 dark:text-slate-300">
                    {formatDuration(currentTime)}
                  </span>
                  <input
                    className="controls-range w-full"
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                  />
                  <span className="text-xs font-semibold text-ink-600 dark:text-slate-300">
                    {formatDuration(duration)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative max-[480px]:hidden">
                    <button
                      ref={tagButtonRef}
                      className={`rounded-xl border p-2 shadow-sm transition hover:-translate-y-0.5 ${
                        isTagged
                          ? "border-ocean bg-ocean/10 text-ocean"
                          : "border-mist bg-white text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                      }`}
                      onClick={() => {
                        setTagMenuOpen((prev) => !prev);
                        setRatingMenuOpen(false);
                      }}
                      disabled={!currentItem || !!externalFile}
                      title="Tags"
                      aria-label="Tags"
                    >
                      <TagIcon />
                    </button>
                    {tagMenuOpen && currentItem && (
                      <div
                        ref={tagMenuRef}
                        className="absolute right-0 bottom-full z-20 mb-2 w-60 rounded-2xl border border-mist bg-white p-3 shadow-soft dark:border-white/10 dark:bg-slate-900"
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-600 dark:text-slate-300">
                          Tags
                        </p>
                        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                          {topTags.length === 0 && (
                            <span className="block rounded-xl bg-slatewash px-3 py-2 text-xs text-ink-500 dark:bg-white/5 dark:text-slate-400">
                              No tags yet
                            </span>
                          )}
                          {topTags.length > 0 && filteredPlayerTags.length === 0 && (
                            <span className="block rounded-xl bg-slatewash px-3 py-2 text-xs text-ink-500 dark:bg-white/5 dark:text-slate-400">
                              No matching tags
                            </span>
                          )}
                          {filteredPlayerTags.map((tag) => {
                            const active = currentItem.tags.includes(tag);
                            return (
                              <button
                                key={tag}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                                  active
                                    ? "bg-ocean/10 text-ocean"
                                    : "bg-slatewash text-ink-700 dark:bg-white/5 dark:text-white"
                                }`}
                                onClick={() => handleTagToggle(tag)}
                              >
                                <span>{tag}</span>
                                <span>{active ? "✓" : ""}</span>
                              </button>
                            );
                          })}
                        </div>
                        <form className="mt-3 flex gap-2" onSubmit={handleAddTag}>
                          <input
                            className="w-full rounded-xl border border-mist bg-white px-2 py-1 text-xs text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                            name="tag"
                            placeholder="Add tag"
                            ref={tagInputRef}
                            value={tagDraft}
                            onChange={(event) => setTagDraft(event.target.value)}
                          />
                          <button className="rounded-xl bg-ink-900 px-3 py-1 text-xs font-semibold text-white">
                            Add
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  <div className="relative max-[520px]:hidden">
                    <button
                      ref={ratingButtonRef}
                      className={`rounded-xl border p-2 shadow-sm transition hover:-translate-y-0.5 ${
                        isRated
                          ? "border-ocean bg-ocean/10 text-ocean"
                          : "border-mist bg-white text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                      }`}
                      onClick={() => {
                        setRatingMenuOpen((prev) => !prev);
                        setTagMenuOpen(false);
                      }}
                      disabled={!currentItem || !!externalFile}
                      title="Rating"
                      aria-label="Rating"
                    >
                      <StarIcon filled={isRated} />
                    </button>
                    {ratingMenuOpen && currentItem && (
                      <div
                        ref={ratingMenuRef}
                        className="absolute right-0 bottom-full z-20 mb-2 w-40 rounded-2xl border border-mist bg-white p-3 shadow-soft dark:border-white/10 dark:bg-slate-900"
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-600 dark:text-slate-300">
                          Rating
                        </p>
                        <div className="mt-2 space-y-2">
                          {RATING_OPTIONS.map((rating) => (
                            <button
                              key={rating}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                                currentItem.rating === rating
                                  ? "bg-coral/10 text-coral"
                                  : "bg-slatewash text-ink-700 dark:bg-white/5 dark:text-white"
                              }`}
                              onClick={() => handleRating(rating)}
                            >
                              <span>{rating === 0 ? "No rating" : `${rating} stars`}</span>
                              <span>{currentItem.rating === rating ? "✓" : ""}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 max-[680px]:hidden">
                  <button
                    className="rounded-xl border border-mist bg-white p-2 text-ink-700 shadow-sm transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/10 dark:text-white"
                    onClick={() => setMuted((prev) => !prev)}
                    title={muted ? "Unmute" : "Mute"}
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <MuteIcon /> : <VolumeIcon />}
                  </button>
                  <input
                    className="controls-range w-28"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={handleVolume}
                  />
                </div>

                <div className="flex items-center gap-2 max-[720px]:hidden">
                  <button
                    className="rounded-xl border border-mist bg-white p-2 text-ink-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-white"
                    onClick={() => setDetailsVisible((prev) => !prev)}
                    title={detailsVisible ? "Hide Details" : "Show Details"}
                    aria-label={detailsVisible ? "Hide Details" : "Show Details"}
                    aria-pressed={detailsVisible}
                  >
                    {detailsVisible ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  </button>
                </div>

                <div className="flex items-center max-[760px]:hidden">
                  <button
                    className={`rounded-xl border p-2 shadow-sm transition hover:-translate-y-0.5 ${
                      playlistVisible
                        ? "border-ocean bg-ocean/10 text-ocean"
                        : "border-mist bg-white text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                    }`}
                    onClick={togglePlaylist}
                    title="Toggle Playlist"
                    aria-label="Toggle Playlist"
                  >
                    <PlaylistIcon />
                  </button>
                </div>
              </div>

              {detailsVisible && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="flex items-baseline gap-2 text-lg font-display text-ink-900 dark:text-white">
                      <span>{externalFile?.name ?? currentItem?.name ?? ""}</span>
                      {showPlaylistStatus && (
                        <span className="text-sm font-medium text-ink-500 dark:text-slate-400">
                          ({currentPlaylistIndex + 1}/{totalCount})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      className="rounded-xl border border-mist bg-white p-2 text-ink-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-white"
                      onClick={handleChooseRoot}
                      title="Open Folder"
                      aria-label="Open Folder"
                    >
                      <FolderIcon />
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink-600 dark:text-slate-300">Rating</span>
                      <RatingStars
                        rating={currentItem?.rating ?? 0}
                        onSelect={(value) => handleRating(value)}
                        disabled={!currentItem || !!externalFile}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {playlistVisible && (
            <aside className="flex h-full min-h-0 flex-col rounded-xl border border-white/70 bg-white/80 p-3 shadow-soft backdrop-blur dark:border-white/10 dark:bg-white/5">
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-600 dark:text-slate-300">
                  Sort
                </label>
                <select
                  className="rounded-xl border border-mist bg-white px-3 py-2 text-xs font-semibold text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                  value={options.sort}
                  onChange={(event) => {
                    const nextSort = event.target.value as SortMode;
                    setOptions((prev) => ({ ...prev, sort: nextSort }));
                    if (nextSort === "random") {
                      setRandomSeed(Date.now());
                    }
                  }}
                >
                  {Object.entries(SORT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                <button
                  className="rounded-xl border border-mist bg-white px-3 py-2 text-xs font-semibold text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                  onClick={() => setFilterMenuOpen((prev) => !prev)}
                >
                  Filters
                </button>
                <button
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    loopPlaylist
                      ? "bg-ocean text-white"
                      : "border border-mist bg-white text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                  }`}
                  onClick={() => setLoopPlaylist((prev) => !prev)}
                >
                  Loop
                </button>
              </div>

              {filterMenuOpen && (
                <div className="mt-4 rounded-2xl border border-mist bg-white/80 p-3 text-sm dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-600 dark:text-slate-300">
                      Rating
                    </span>
                    <select
                      className="rounded-lg border border-mist bg-white px-2 py-1 text-xs font-semibold text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                      value={options.ratingMin}
                      onChange={(event) =>
                        setOptions((prev) => ({ ...prev, ratingMin: Number(event.target.value) }))
                      }
                    >
                      {RATING_OPTIONS.map((rating) => (
                        <option key={rating} value={rating}>
                          {rating === 0 ? "No filter" : `${rating}+`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-600 dark:text-slate-300">
                      Tags (AND)
                    </p>
                    <input
                      className="mt-2 w-full rounded-lg border border-mist bg-white px-2 py-1 text-xs text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                      value={tagFilterQuery}
                      onChange={(event) => setTagFilterQuery(event.target.value)}
                      placeholder="Type to filter tags"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {topTags.length === 0 && (
                        <span className="text-xs text-ink-500 dark:text-slate-400">No tags yet</span>
                      )}
                      {topTags.length > 0 && filteredTags.length === 0 && (
                        <span className="text-xs text-ink-500 dark:text-slate-400">No matching tags</span>
                      )}
                      {filteredTags.map((tag) => {
                        const active = options.tags.includes(tag);
                        return (
                          <button
                            key={tag}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                              active
                                ? "bg-ocean text-white"
                                : "border border-mist bg-white text-ink-700 dark:border-white/10 dark:bg-white/10 dark:text-white"
                            }`}
                            onClick={() => handleFilterTag(tag)}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" onScroll={handlePlaylistScroll}>
                {items.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-mist p-4 text-sm text-ink-600 dark:border-white/10 dark:text-slate-300">
                    No videos found yet. Drop a folder or rescan to populate this playlist.
                  </div>
                )}
                {items.map((item, index) => {
                  const active = item.id === currentId;
                  return (
                    <div
                      key={item.id}
                      className={`group flex gap-3 rounded-2xl border p-3 transition ${
                        active
                          ? "border-ocean bg-ocean/10"
                          : "border-transparent bg-white/70 hover:border-mist hover:bg-white dark:bg-white/5"
                      }`}
                      draggable={options.sort === "playlist" && !hasMore}
                      onDragStart={() => setDragIndex(index)}
                      onDragEnd={() => setDragIndex(null)}
                      onDragOver={(event) => {
                        if (options.sort !== "playlist" || hasMore) return;
                        event.preventDefault();
                      }}
                      onDrop={() => {
                        if (hasMore) return;
                        if (dragIndex === null) return;
                        handleOrderMove(dragIndex, index);
                        setDragIndex(null);
                      }}
                      onClick={() => {
                        setExternalFile(null);
                        setCurrentId(item.id);
                      }}
                    >
                      <div className="relative h-16 w-24 overflow-hidden rounded-xl bg-slate-900">
                        {item.thumbnailUrl ? (
                          <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-white/70">
                            no thumb
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="line-clamp-2 text-sm font-semibold text-ink-900 dark:text-white">
                              {item.name}
                            </p>
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-ink-900/10 px-2 py-0.5 text-[10px] font-semibold text-ink-700 dark:bg-white/10 dark:text-white"
                            >
                              {tag}
                            </span>
                          ))}
                          <RatingStars rating={item.rating} />
                          <span className="text-xs text-ink-500 dark:text-slate-400">
                            {formatDuration(item.durationMs / 1000)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {hasMore && (
                  <div className="rounded-2xl border border-dashed border-mist p-3 text-center text-xs text-ink-500 dark:border-white/10 dark:text-slate-300">
                    {isLoadingPage ? "Loading more..." : "Scroll to load more"}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {status && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 px-4 py-2 text-xs font-semibold text-white">
          {status}
        </div>
      )}

      {isDraggingFile && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-ink-900/40 text-white">
          <div className="rounded-3xl border border-white/40 bg-white/10 px-8 py-6 text-center">
            <p className="text-lg font-semibold">Drop to load a new library</p>
            <p className="text-sm text-white/70">Folders switch the root. Files play and can update root.</p>
          </div>
        </div>
      )}

      {pendingOpen && (
        <PendingOpenModal
          info={pendingOpen}
          onCancel={() => resolvePending("cancel")}
          onSwitch={() => resolvePending("switch")}
          onPlay={() => resolvePending("play")}
        />
      )}
    </div>
  );
}

function RatingStars({
  rating,
  onSelect,
  disabled
}: {
  rating: number;
  onSelect?: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 text-[10px]">
      {Array.from({ length: 5 }).map((_, index) => {
        const active = index < rating;
        if (onSelect) {
          return (
            <button
              key={index}
              type="button"
              className={`transition ${active ? "text-coral" : "text-ink-400 dark:text-slate-500"} ${
                disabled ? "cursor-not-allowed opacity-50" : "hover:scale-110"
              }`}
              onClick={() => !disabled && onSelect(index + 1)}
              aria-label={`Set rating ${index + 1}`}
              disabled={disabled}
            >
              ★
            </button>
          );
        }
        return (
          <span key={index} className={active ? "text-coral" : "text-ink-400 dark:text-slate-500"}>
            ★
          </span>
        );
      })}
    </div>
  );
}

function PendingOpenModal({
  info,
  onCancel,
  onSwitch,
  onPlay
}: {
  info: PendingOpenInfo;
  onCancel: () => void;
  onSwitch: () => void;
  onPlay: () => void;
}) {
  const isFile = info.kind === "file";
  const title = isFile ? "Open video" : "Switch library";
  const description = isFile
    ? info.inCurrentRoot
      ? "This file is already inside the current library. Play it now?"
      : "This file is outside the current library. You can switch the root or just play it once."
    : "Switch library root to this folder?";
  const showSwitch = !isFile || !info.inCurrentRoot;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50">
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white p-6 shadow-soft dark:border-white/10 dark:bg-slate-900">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-600 dark:text-slate-300">
          {title}
        </p>
        <h3 className="mt-2 text-xl font-display text-ink-900 dark:text-white">{fileName(info.path)}</h3>
        <p className="mt-2 text-sm text-ink-600 dark:text-slate-300">{description}</p>
        {info.foundDbRoot && (
          <p className="mt-2 text-xs text-ink-500 dark:text-slate-400">
            Found existing library at {info.foundDbRoot}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {showSwitch && (
            <button
              className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={onSwitch}
            >
              {isFile ? "Switch & Play" : "Switch Root"}
            </button>
          )}
          {isFile && !info.inCurrentRoot && (
            <button
              className="rounded-xl border border-mist bg-white px-4 py-2 text-sm font-semibold text-ink-700"
              onClick={onPlay}
            >
              Play Once
            </button>
          )}
          {isFile && info.inCurrentRoot && (
            <button
              className="rounded-xl border border-mist bg-white px-4 py-2 text-sm font-semibold text-ink-700"
              onClick={onPlay}
            >
              Play
            </button>
          )}
          <button
            className="rounded-xl border border-mist bg-white px-4 py-2 text-sm font-semibold text-ink-700"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function fileName(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.4.6l1.2 1.2a2 2 0 0 0 1.4.6H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PlaylistIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h12M4 12h12M4 17h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M19 9.5v5l2.5-2.5L19 9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12.5V6a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-5.1 5.1a2 2 0 0 1-2.8 0l-7.5-7.5a2 2 0 0 1-.6-1.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  );
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4.5l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 18.6l-5.4 2.7 1-6.1-4.4-4.3 6.1-.9L12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M16 9.5c1.2 1.2 1.2 3.8 0 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18.5 7c2.2 2.2 2.2 7.8 0 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9v6h4l5 4V5L8 9H4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M16 9l4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 6 3.5 12 11 18V6Z" />
      <path d="M20 6 12.5 12 20 18V6Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6 11.5 12 4 18V6Z" />
      <path d="M13 6 20.5 12 13 18V6Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4.5 19 12 6 19.5V4.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
