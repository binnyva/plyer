# Project Overview

Plyer is a desktop video player built with Electron, React, Vite, and TypeScript that treats a
folder as a media library. It scans local video files, stores metadata/tags/ratings/playlists in a
per-folder SQLite database (`.playr.sqlite`), generates thumbnails locally with FFmpeg, and
supports opening folders/files directly (including OS file-open events and drag-and-drop).

## Build & Development Commands

Don't run `npm run build` - assume its running already.

## Important files

- [`Readme.md`](Readme.md)
- [`0Meta/Next Steps.md`](0Meta/Next%20Steps.md)
- [`0Meta/DB.txt`](0Meta/DB.txt)
- [`src/main/index.ts`](src/main/index.ts)
- [`src/main/library.ts`](src/main/library.ts)
- [`src/main/db.ts`](src/main/db.ts)
- [`src/preload/index.ts`](src/preload/index.ts)
- [`src/renderer/App.tsx`](src/renderer/App.tsx)
