// Ties the page reader, the engine and the bar together on YouTube.
import { type FromEngine, parsePageMessage, type VideoInfo } from "../protocol";
import { readSettings } from "../settings";
import { Bar } from "./bar";
import { type Action, type BarState, initialState, reduce, statusLine } from "./bar-state";
import { EngineLink } from "./engine-link";
import { clearMarks, drawMarks } from "./marks";

const link = new EngineLink();
let info: VideoInfo | null = null;
let state: BarState = initialState;
let searchId = 0;
let modelStarted = 0;

const player = () => document.getElementById("movie_player");
const video = () => player()?.querySelector("video") ?? null;
const isAd = () => player()?.classList.contains("ad-showing") ?? false;
const duration = () => video()?.duration || info?.duration || 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const bar = new Bar({
  onSearch: (query) => void search(query),
  onStep: (by) => {
    dispatch({ type: "step", by });
    void jump();
  },
  onClear: () => {
    dispatch({ type: "clear" });
    clearMarks();
  },
  onSkip: () => undefined,
});

function dispatch(a: Action): void {
  state = reduce(state, a);
  bar.render(state, statusLine(state, (performance.now() - modelStarted) / 1000, duration()));
  drawMarks(state.hits, state.current, duration());
}

async function search(query: string): Promise<void> {
  if (!info) return;
  const id = ++searchId;
  dispatch({ type: "searching", query });
  await link.send({ type: "search", id, videoId: info.videoId, query });
}

async function jump(): Promise<void> {
  const hit = state.hits[state.current];
  const v = video();
  if (!hit || !v) return;
  if (isAd()) {
    dispatch({ type: "ad", waiting: true });
    while (isAd()) await sleep(500);
    dispatch({ type: "ad", waiting: false });
  }
  v.currentTime = hit.start;
  void v.play().catch(() => undefined);
}

async function open(): Promise<void> {
  if (!info) return;
  const { backgroundReading } = await readSettings();
  await link.send({ type: "open", videoId: info.videoId, duration: info.duration, spec: info.spec, autoRead: backgroundReading && !info.live });
}

link.onConnect(() => void open().catch((err: unknown) => console.warn("Moments: could not open the video", err)));

link.onMessage((m: FromEngine) => {
  if (m.type === "model") {
    if (m.phase === "loading" && !modelStarted) modelStarted = performance.now();
    dispatch({ type: "model", phase: m.phase, loaded: m.loaded, total: m.total, message: m.message });
    return;
  }
  if (!info || m.videoId !== info.videoId) return;
  if (m.type === "state") {
    dispatch({ type: "engine", kind: m.kind, preview: m.reading === "preview" ? { done: m.done, total: m.total } : null, problem: m.problem, message: m.message });
    return;
  }
  if (m.id !== searchId) return;
  dispatch({ type: "results", query: state.query, hits: m.hits, weak: m.weak });
  if (m.hits.length) void jump();
});

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const next = parsePageMessage(e.data);
  if (!next || next.videoId === info?.videoId) return;
  info = next;
  searchId++;
  clearMarks();
  dispatch({ type: "video", videoId: next.videoId });
  bar.mount();
  void open().catch((err: unknown) => console.warn("Moments: could not open the video", err));
});

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "focus") bar.focus();
  return false;
});
