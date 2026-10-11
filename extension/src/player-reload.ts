// Puts YouTube's player back on a video after its source failed during a full-detail read: the video is loaded
// again at the viewer's second, playing or paused as before (PREFLIGHT PF32). Runs in the page (MAIN world), where
// the player's API is; only the video already loaded is ever reloaded.
import type { ReloadRequest } from "./protocol";

export interface ReloadablePlayer {
  loadVideoById?(o: { videoId: string; startSeconds: number }): void;
  cueVideoById?(o: { videoId: string; startSeconds: number }): void;
}

export function reloadPlayer(player: ReloadablePlayer | null, loadedVideoId: string | null, r: ReloadRequest): boolean {
  if (!player || loadedVideoId !== r.videoId) return false;
  const load = r.play ? player.loadVideoById : player.cueVideoById; // cue: ready at that second, paused
  if (typeof load !== "function") return false;
  load.call(player, { videoId: r.videoId, startSeconds: r.at });
  return true;
}
