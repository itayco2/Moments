// The full-detail read: step the viewer's own player through the video, grab each frame, put everything back.
// YouTube refuses a second, hidden player inside youtube.com (Error 152-4), so the viewer's player is the only
// source of real frames; the read happens once per video and the viewer can stop it at any moment.
//
// YouTube plays ads and the next video in the same <video>, so the read never pauses or seeks while an ad shows,
// checks after every seek that the player still holds the video being read, and puts the viewer's second back only
// onto that video (PREFLIGHT PF27, PF28).
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
  capture(): string | null; // null: this frame has no picture to grab
  isAd(): boolean;
  isCurrent(): boolean; // the player still holds the video being read
  playerFailed(): boolean; // the player lost its source or shows its error (PREFLIGHT PF32)
  send(frames: Frame[]): void;
  progress(done: number, total: number): void;
  signal: AbortSignal;
  seekTimeoutMs?: number;
  adPollMs?: number;
}

export interface ReadOutcome {
  complete: boolean; // went through every planned time
  sent: number; // frames handed to send()
  blank: number; // frames skipped because the player had no picture
  failed: boolean; // the player failed: it was not touched afterwards, and the caller loads the video again
  saved: { t: number; playing: boolean }; // where the viewer was, to put them back
}

export const BATCH = 8;
export const JPEG_QUALITY = 0.9;
const SEEK_TIMEOUT_MS = 5000;
const AD_POLL_MS = 500;
const AD_RETRIES_PER_FRAME = 2; // an ad that starts right after a seek: wait it out and seek again, twice at most
// One seek that never lands is skipped (a slow buffer); this many in a row means the player has stopped working.
const MAX_MISSED_SEEKS = 2;
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

// Waits while an ad shows, touching nothing. False when the read was stopped or the video changed meanwhile.
async function adOver(d: FullReadDeps): Promise<boolean> {
  while (d.isAd()) {
    if (d.signal.aborted) return false;
    await sleep(d.adPollMs ?? AD_POLL_MS);
  }
  return !d.signal.aborted && d.isCurrent();
}

// One frame: "stop" when the read must end, "failed" when the player failed, "missed" when the seek never landed
// (grabbing then would take the wrong frame), null when there is no picture, else the frame.
async function grab(d: FullReadDeps, t: number): Promise<Frame | "stop" | "failed" | "missed" | null> {
  for (let tries = 0; tries <= AD_RETRIES_PER_FRAME; tries++) {
    if (!(await adOver(d))) return "stop";
    const landed = await seek(d.video, t, d.seekTimeoutMs ?? SEEK_TIMEOUT_MS);
    if (d.signal.aborted || !d.isCurrent()) return "stop"; // never grab a frame of another video
    if (d.isAd()) continue; // the seek started an ad: that picture is the ad's
    if (d.playerFailed()) return "failed";
    if (!landed) return "missed";
    const jpeg = d.capture();
    return jpeg ? { t, jpeg } : null;
  }
  return null;
}

export async function fullRead(d: FullReadDeps): Promise<ReadOutcome> {
  const { video, times } = d;
  const saved = { t: video.currentTime, playing: !video.paused };
  const outcome: ReadOutcome = { complete: false, sent: 0, blank: 0, failed: false, saved };
  if (d.isAd() || !d.isCurrent()) return outcome; // the caller waits for the ad; this never touches one
  if (times.length === 0) return { ...outcome, complete: !d.signal.aborted }; // a continued read with nothing left
  let batch: Frame[] = [];
  const flush = () => {
    if (batch.length) d.send(batch);
    outcome.sent += batch.length;
    batch = [];
  };
  let missed = 0;
  video.pause();
  try {
    for (const [i, t] of times.entries()) {
      const frame = await grab(d, t);
      if (frame === "stop") return outcome;
      missed = frame === "missed" ? missed + 1 : 0;
      if (frame === "failed" || missed >= MAX_MISSED_SEEKS) {
        outcome.failed = true;
        return outcome;
      }
      if (frame && frame !== "missed") batch.push(frame);
      else outcome.blank++;
      if (batch.length === BATCH) flush();
      d.progress(i + 1, times.length);
    }
    outcome.complete = !d.signal.aborted;
    return outcome;
  } finally {
    flush(); // every frame in the batch was grabbed while the video was current
    if (!outcome.failed && !d.isAd() && d.isCurrent()) {
      video.currentTime = saved.t;
      if (saved.playing) void video.play().catch(() => undefined);
    }
  }
}

// Grabs the player's current picture at 360 px on the short side. The size is worked out for every frame: the
// player's picture size can change during a read (quality switch) and is 0 before the video has a picture.
export function jpegCapture(video: HTMLVideoElement): () => string | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas on this page");
  return () => {
    if (!(video.videoWidth > 0 && video.videoHeight > 0)) return null;
    const { w, h } = scaledSize(video.videoWidth, video.videoHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  };
}
