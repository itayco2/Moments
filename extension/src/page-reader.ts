// Runs in YouTube's own page (MAIN world) because only there is the player's API reachable. It reads video id,
// length and the preview spec and posts them to the content script; and when the content script asks, it loads the
// same video again after the player failed during a full-detail read (player-reload.ts).
import { PAGE_SOURCE, parseReloadMessage } from "./protocol";
import { type ReloadablePlayer, reloadPlayer } from "./player-reload";
import { videoInfo } from "./video-info";

type Player = HTMLElement & ReloadablePlayer & { getPlayerResponse?: () => unknown };
const TRIES = 12;
const EVERY_MS = 500;

function post(): void {
  const player = document.getElementById("movie_player") as Player | null;
  const info = videoInfo(player?.getPlayerResponse?.());
  if (info && location.pathname === "/watch") window.postMessage({ source: PAGE_SOURCE, type: "video", info }, location.origin);
}

// The player response settles a little after load and after each in-page navigation: post a few times, the
// content script ignores repeats of the same video.
function burst(): void {
  let n = 0;
  const timer = setInterval(() => {
    if (++n >= TRIES) clearInterval(timer); // before post(), so a throwing post() cannot keep the burst alive
    post();
  }, EVERY_MS);
}

document.addEventListener("yt-navigate-finish", burst);
burst();

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const request = parseReloadMessage(e.data);
  if (!request) return;
  const player = document.getElementById("movie_player") as Player | null;
  reloadPlayer(player, videoInfo(player?.getPlayerResponse?.())?.videoId ?? null, request);
});
