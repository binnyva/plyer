import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import ffmpegPath from "ffmpeg-static";

export const thumbnailEvents = new EventEmitter();

interface ThumbJob {
  filePath: string;
  thumbPath: string;
}

const queue: ThumbJob[] = [];
let working = false;

export function getThumbnailPath(root: string, relativePath: string) {
  const hash = crypto.createHash("sha1").update(relativePath).digest("hex");
  const dir = path.join(root, ".cache", "thumbnails");
  return path.join(dir, `${hash}.jpg`);
}

export function enqueueThumbnail(filePath: string, thumbPath: string) {
  if (!ffmpegPath) {
    return;
  }
  if (fs.existsSync(thumbPath)) {
    return;
  }
  queue.push({ filePath, thumbPath });
  processQueue();
}

function processQueue() {
  if (working || queue.length === 0) {
    return;
  }
  const job = queue.shift();
  if (!job) {
    return;
  }
  working = true;
  fs.mkdirSync(path.dirname(job.thumbPath), { recursive: true });
  if (!ffmpegPath) {
    working = false;
    processQueue();
    return;
  }

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "00:00:02",
    "-i",
    job.filePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=320:-1",
    job.thumbPath
  ];

  const proc = spawn(ffmpegPath, args);
  proc.on("error", () => {
    working = false;
    processQueue();
  });
  proc.on("exit", (code: number | null) => {
    working = false;
    if (code === 0 && fs.existsSync(job.thumbPath)) {
      thumbnailEvents.emit("ready", job);
    }
    processQueue();
  });
}
