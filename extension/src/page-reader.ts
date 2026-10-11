// Runs in YouTube's own page (MAIN world) because only there is the player's API reachable. It only reads:
// video id, length and the preview spec, and posts them to the content script.
import { PAGE_SOURCE } from "./protocol";
import { videoInfo } from "./video-info";

type Player = HTMLElement & { getPlayerResponse?: () => unknown };
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
    post();
    if (++n >= TRIES) clearInterval(timer);
  }, EVERY_MS);
}

document.addEventListener("yt-navigate-finish", burst);
burst();
