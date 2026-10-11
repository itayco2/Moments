// The one place that reads YouTube's player response. Everything YouTube gives is checked before use.
import { VIDEO_ID } from "./protocol";

export interface VideoInfo {
  videoId: string;
  duration: number;
  spec: string | null;
  live: boolean;
}

interface PlayerResponse {
  videoDetails?: { videoId?: unknown; lengthSeconds?: unknown; isLive?: unknown };
  storyboards?: { playerStoryboardSpecRenderer?: { spec?: unknown } };
}

export function videoInfo(response: unknown): VideoInfo | null {
  const r = response as PlayerResponse | null;
  const d = r?.videoDetails;
  if (!d || typeof d.videoId !== "string" || !VIDEO_ID.test(d.videoId)) return null;
  const duration = Number(d.lengthSeconds);
  const raw = r?.storyboards?.playerStoryboardSpecRenderer?.spec;
  // After in-page navigation the spec can still describe the previous video for a moment.
  const spec = typeof raw === "string" && raw.includes(`/sb/${d.videoId}/`) ? raw : null;
  return { videoId: d.videoId, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, spec, live: d.isLive === true };
}
