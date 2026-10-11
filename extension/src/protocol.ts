// Every message that crosses a boundary: page to content script (untrusted) and content script to engine.
import type { VideoInfo } from "./video-info";

export type { VideoInfo };
export const PAGE_SOURCE = "moments-page";
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_DURATION_S = 48 * 3600;
const MAX_SPEC_CHARS = 4000;

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
