// The full-detail read: step the viewer's own player through the video, grab each frame, put everything back.
// YouTube refuses a second, hidden player inside youtube.com (Error 152-4), so the viewer's player is the only
// source of real frames; the read happens once per video and the viewer can stop it at any moment.
import { scaledSize } from "../../../web/src/frames";
import type { Frame } from "../protocol";

export interface Seekable extends EventTarget {
  currentTime: number;
  paused: boolean;
  pause(): void;
  play(): Promise<void>;
}

export interface FullReadDeps {
  video: Seekable;
  times: number[];
  capture(): string;
  isAd(): boolean;
  send(frames: Frame[]): void;
  progress(done: number, total: number): void;
  signal: AbortSignal;
  seekTimeoutMs?: number;
  adPollMs?: number;
}

export const BATCH = 8;
export const JPEG_QUALITY = 0.9;
const SEEK_TIMEOUT_MS = 5000;
const AD_POLL_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seek(video: Seekable, t: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", done);
      resolve(false);
    }, timeoutMs);
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = t;
  });
}

export async function fullRead(d: FullReadDeps): Promise<boolean> {
  const { video, times, signal } = d;
  const saved = { t: video.currentTime, playing: !video.paused };
  let batch: Frame[] = [];
  let done = 0;
  video.pause();
  try {
    for (const t of times) {
      while (d.isAd()) {
        if (signal.aborted) return false;
        await sleep(d.adPollMs ?? AD_POLL_MS);
      }
      if (signal.aborted) return false;
      if (await seek(video, t, d.seekTimeoutMs ?? SEEK_TIMEOUT_MS)) {
        batch.push({ t, jpeg: d.capture() });
        if (batch.length === BATCH) {
          d.send(batch);
          batch = [];
        }
      }
      d.progress(++done, times.length);
    }
    return !signal.aborted;
  } finally {
    if (batch.length) d.send(batch);
    video.currentTime = saved.t;
    if (saved.playing) void video.play().catch(() => undefined);
  }
}

export function jpegCapture(video: HTMLVideoElement): () => string {
  const { w, h } = scaledSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas on this page");
  return () => {
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  };
}
