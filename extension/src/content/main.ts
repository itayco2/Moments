// Ties the page reader, the engine and the bar together on YouTube. The decisions live in controller.ts; this file
// only connects it to the page.
import { parsePageMessage } from "../protocol";
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

document.addEventListener(
  "keydown",
  (e) => {
    if (e.isTrusted && e.key === "Escape" && controller.escape()) e.stopPropagation();
  },
  true,
);
