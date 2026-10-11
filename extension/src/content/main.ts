// Ties the page reader, the engine and the bar together on YouTube. The decisions live in controller.ts; this file
// only connects it to the page.
import { CONTENT_SOURCE, parsePageMessage } from "../protocol";
import { readSettings } from "../settings";
import { Bar } from "./bar";
import { statusLine } from "./bar-state";
import { Controller } from "./controller";
import { EngineLink } from "./engine-link";
import { jpegCapture } from "./full-read";
import { clearMarks, drawMarks } from "./marks";
import { Overlay } from "./overlay";

const player = () => document.getElementById("movie_player");
const video = () => player()?.querySelector("video") ?? null;
const isAd = () => player()?.classList.contains("ad-showing") ?? false;

const link = new EngineLink();
const overlay = new Overlay(() => controller.skip());
const bar = new Bar({
  onSearch: (query) => void controller.search(query),
  onStep: (by) => controller.step(by),
  onClear: () => controller.clear(),
  onSkip: () => controller.skip(),
  onRetry: () => void controller.retry(),
});

const controller = new Controller({
  link,
  video,
  isAd,
  capture: (v) => jpegCapture(v as HTMLVideoElement),
  render: (s, elapsedS, duration) => {
    bar.render(s, statusLine(s, elapsedS, duration));
    if (s.hits.length) drawMarks(s.hits, s.current, duration);
    else clearMarks();
    if (s.full) overlay.show(statusLine(s, 0, duration), s.full.done / Math.max(s.full.total, 1));
    else overlay.hide();
  },
  readSettings,
  extensionAlive: () => Boolean(chrome.runtime?.id),
  // The source gone (no length) or YouTube's own error on the player.
  playerFailed: () => {
    const v = video();
    const error = player()?.querySelector<HTMLElement>(".ytp-error");
    return !v || !(v.duration > 0) || (!!error && error.offsetParent !== null);
  },
  // Only the page can call the player's API: the page reader loads the video again (player-reload.ts).
  reload: (videoId, at, play) => window.postMessage({ source: CONTENT_SOURCE, type: "reload", videoId, at, play }, location.origin),
  onWatchPage: () => location.pathname === "/watch",
});

link.onMessage((m) => controller.message(m));
link.onConnect(() => controller.connected());
link.onDisconnect(() => controller.disconnected());
link.onError((err) => controller.linkFailed(err));

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const next = parsePageMessage(e.data);
  if (!next) return;
  bar.mount();
  controller.video(next);
});
// YouTube's in-page navigation: from its start, the player may hold the next video.
document.addEventListener("yt-navigate-start", () => controller.navigateStart());
document.addEventListener("yt-navigate-finish", () => controller.navigateFinish());

chrome.runtime.onMessage.addListener((m, sender) => {
  if (sender.id === chrome.runtime.id && m?.type === "focus") bar.focus();
  return false;
});

// During a full-detail read: Esc stops it, and so does any player key (YouTube's seek keys would move the player
// under the read). Browser shortcuts (Ctrl, Alt, Meta) and keys typed into the bar do not.
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);
document.addEventListener(
  "keydown",
  (e) => {
    if (!e.isTrusted || !controller.isReading) return;
    if (e.key === "Escape") {
      controller.escape();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey || MODIFIERS.has(e.key) || e.composedPath().includes(bar.host)) return;
    controller.skip();
  },
  true,
);
