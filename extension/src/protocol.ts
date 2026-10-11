// Every message that crosses a boundary: page to content script (untrusted) and content script to engine.
import type { VideoInfo } from "./video-info";

export type { VideoInfo };
export const PAGE_SOURCE = "moments-page";
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_DURATION_S = 48 * 3600;
export const MAX_SPEC_CHARS = 4000;

export function parsePageMessage(data: unknown): VideoInfo | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { source?: unknown; type?: unknown; info?: unknown };
  if (m.source !== PAGE_SOURCE || m.type !== "video" || typeof m.info !== "object" || m.info === null) return null;
  const i = m.info as Record<string, unknown>;
  if (typeof i.videoId !== "string" || !VIDEO_ID.test(i.videoId)) return null;
  if (typeof i.duration !== "number" || !(i.duration >= 0 && i.duration <= MAX_DURATION_S)) return null;
  const spec = i.spec;
  if (spec !== null && (typeof spec !== "string" || spec.length > MAX_SPEC_CHARS || !spec.startsWith(`https://i.ytimg.com/sb/${i.videoId}/`))) {
    return null;
  }
  if (typeof i.live !== "boolean") return null;
  return { videoId: i.videoId, duration: i.duration, spec: spec as string | null, live: i.live };
}

export interface Hit {
  start: number;
  end: number;
  score: number;
}
export interface Frame {
  t: number;
  jpeg: string;
}
// What the engine holds for a video: nothing, preview frames, a full-detail read that stopped early ("partial":
// full detail from 0:00 up to `readUntil`, preview frames after it when the video has them), or a full-detail read.
export type Kind = "none" | "preview" | "partial" | "full";

// A full-detail read is one tab's: full-start opens it (after: null from 0:00, or the time a partial read reached),
// full-frames carry its frames, full-end closes it with how many frames the tab sent. Only a read that went through
// to the end and arrived whole becomes "full".
export type ToEngine =
  | { type: "open"; videoId: string; duration: number; spec: string | null; autoRead: boolean }
  | { type: "search"; id: number; videoId: string; query: string }
  | { type: "full-start"; videoId: string; after: number | null }
  | { type: "full-frames"; videoId: string; frames: Frame[] }
  | { type: "full-end"; videoId: string; complete: boolean; sent: number };

export type ModelMessage = {
  type: "model";
  // "restarting": the model stopped (a lost or stuck GPU) and is being started again (PREFLIGHT PF26).
  phase: "idle" | "loading" | "ready" | "restarting" | "error";
  loaded: number;
  total: number;
  device: "webgpu" | "wasm" | null;
  message: string;
};
export type StateMessage = {
  type: "state";
  videoId: string;
  kind: Kind;
  readUntil: number;
  reading: "preview" | null;
  done: number;
  total: number;
  problem: "no-previews" | "error" | null;
  message: string;
};
export type ResultsMessage = {
  type: "results";
  id: number;
  videoId: string;
  kind: Kind;
  readUntil: number;
  hits: Hit[];
  weak: boolean;
  failed: boolean;
};
export type FromEngine = ModelMessage | StateMessage | ResultsMessage;

export const MAX_QUERY = 200;
export const MAX_FRAMES_PER_MESSAGE = 32;
export const MAX_JPEG_CHARS = 800_000;
// One frame a second for the longest video allowed.
export const MAX_READ_FRAMES = MAX_DURATION_S + 1;
const JPEG_PREFIX = "data:image/jpeg;base64,";

const isId = (v: unknown): v is string => typeof v === "string" && VIDEO_ID.test(v);
const isTime = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= MAX_DURATION_S;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_READ_FRAMES;

// Content scripts are ours, but a compromised page could try to reach the engine through them: check anyway.
export function parseToEngine(msg: unknown): ToEngine | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!isId(m.videoId)) return null;
  switch (m.type) {
    case "open":
      if (!isTime(m.duration) || typeof m.autoRead !== "boolean") return null;
      if (m.spec !== null && (typeof m.spec !== "string" || m.spec.length > MAX_SPEC_CHARS || !m.spec.startsWith(`https://i.ytimg.com/sb/${m.videoId}/`))) {
        return null;
      }
      return { type: "open", videoId: m.videoId, duration: m.duration, spec: m.spec as string | null, autoRead: m.autoRead };
    case "search":
      if (!Number.isInteger(m.id) || typeof m.query !== "string" || m.query.length === 0 || m.query.length > MAX_QUERY) return null;
      return { type: "search", id: m.id as number, videoId: m.videoId, query: m.query };
    case "full-frames": {
      if (!Array.isArray(m.frames) || m.frames.length === 0 || m.frames.length > MAX_FRAMES_PER_MESSAGE) return null;
      const frames: Frame[] = [];
      for (const f of m.frames as Record<string, unknown>[]) {
        if (!isTime(f?.t) || typeof f.jpeg !== "string" || !f.jpeg.startsWith(JPEG_PREFIX) || f.jpeg.length > MAX_JPEG_CHARS) return null;
        frames.push({ t: f.t, jpeg: f.jpeg });
      }
      return { type: "full-frames", videoId: m.videoId, frames };
    }
    case "full-start":
      if (m.after !== null && !isTime(m.after)) return null;
      return { type: "full-start", videoId: m.videoId, after: m.after };
    case "full-end":
      if (typeof m.complete !== "boolean" || !isCount(m.sent)) return null;
      return { type: "full-end", videoId: m.videoId, complete: m.complete, sent: m.sent };
    default:
      return null;
  }
}
