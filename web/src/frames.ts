// Grab one frame every few seconds from a local video file, entirely in the browser.

import { DECODE_SHORT_SIDE, FRAME_EVERY_S } from "./config";

export interface Grabbed {
  t: number;
  image: ImageData;
  thumb: Blob;
}

export const THUMB_WIDTH = 240;

// Frame times 0, every, 2*every ... strictly inside the video (a seek to the very end can return no frame).
export function frameTimes(duration: number, every = FRAME_EVERY_S): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("cannot read the length of this video");
  const times: number[] = [];
  for (let t = 0; t < duration - 0.05; t += every) times.push(t);
  return times;
}

// Scale so the shorter side is `shortSide` (never upscale), keeping both sides even for the decoder.
export function scaledSize(width: number, height: number, shortSide = DECODE_SHORT_SIDE): { w: number; h: number } {
  const scale = Math.min(1, shortSide / Math.min(width, height));
  const even = (x: number) => Math.max(2, Math.round((x * scale) / 2) * 2);
  return { w: even(width), h: even(height) };
}

export function openVideo(src: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("this browser cannot play this file (try MP4 or WebM)"));
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      reject(new Error(`could not read the frame at ${t.toFixed(0)} s`));
    };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.currentTime = t;
  });
}

export async function* grabFrames(file: File, every = FRAME_EVERY_S): AsyncGenerator<Grabbed & { total: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = await openVideo(url);
    const times = frameTimes(video.duration, every);
    const { w, h } = scaledSize(video.videoWidth, video.videoHeight);
    const frame = new OffscreenCanvas(w, h);
    const frameCtx = frame.getContext("2d", { willReadFrequently: true })!;
    const th = Math.round((THUMB_WIDTH * h) / w);
    const thumb = new OffscreenCanvas(THUMB_WIDTH, th);
    const thumbCtx = thumb.getContext("2d")!;
    for (const t of times) {
      await seek(video, t);
      frameCtx.drawImage(video, 0, 0, w, h);
      thumbCtx.drawImage(frame, 0, 0, THUMB_WIDTH, th);
      yield {
        t,
        total: times.length,
        image: frameCtx.getImageData(0, 0, w, h),
        thumb: await thumb.convertToBlob({ type: "image/webp", quality: 0.7 }),
      };
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function videoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return (await openVideo(url)).duration;
  } finally {
    URL.revokeObjectURL(url);
  }
}
