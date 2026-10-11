// Everything the bar shows, as pure state. The DOM code only renders it.
import { clock } from "../../../web/src/format";
import { downloadStatus } from "../../../web/src/progress";
import type { Hit, Kind, ModelMessage, StateMessage } from "../protocol";

export interface Progress {
  done: number;
  total: number;
}

// Something that happened on this side of the engine: the line to it dropped and is being made again, a message
// could not reach it (Try again can help), or the extension was updated under this page (only a reload helps).
export interface Notice {
  kind: "reconnecting" | "failed" | "updated";
  text: string;
}

export interface BarState {
  model: { phase: ModelMessage["phase"]; loaded: number; total: number; message: string; device: ModelMessage["device"] };
  videoId: string | null;
  live: boolean;
  kind: Kind;
  readUntil: number;
  preview: Progress | null;
  full: Progress | null;
  problem: StateMessage["problem"];
  message: string;
  notice: Notice | null;
  waitingForAd: "jump" | "read" | null;
  query: string;
  searching: boolean;
  hits: Hit[];
  current: number;
  weak: boolean;
}

export const initialState: BarState = {
  model: { phase: "idle", loaded: 0, total: 0, message: "", device: null },
  videoId: null,
  live: false,
  kind: "none",
  readUntil: 0,
  preview: null,
  full: null,
  problem: null,
  message: "",
  notice: null,
  waitingForAd: null,
  query: "",
  searching: false,
  hits: [],
  current: -1,
  weak: false,
};

export type Action =
  | { type: "model"; phase: ModelMessage["phase"]; loaded: number; total: number; message: string; device: ModelMessage["device"] }
  | { type: "video"; videoId: string; live: boolean }
  | { type: "engine"; kind: Kind; readUntil: number; preview: Progress | null; problem: StateMessage["problem"]; message: string }
  | { type: "full"; progress: Progress | null }
  | { type: "ad"; waiting: BarState["waitingForAd"] }
  | { type: "searching"; query: string }
  | { type: "results"; query: string; hits: Hit[]; weak: boolean; kind: Kind; readUntil: number }
  | { type: "failed"; notice: Notice }
  | { type: "retry" }
  | { type: "step"; by: 1 | -1 }
  | { type: "clear" };

export function reduce(s: BarState, a: Action): BarState {
  switch (a.type) {
    case "model":
      // The device stays known while a restart runs, so the bar can say a restart failed rather than a first load.
      return { ...s, model: { phase: a.phase, loaded: a.loaded, total: a.total, message: a.message, device: a.device ?? s.model.device } };
    case "video":
      return { ...initialState, model: s.model, videoId: a.videoId, live: a.live };
    case "engine":
      return { ...s, kind: a.kind, readUntil: a.readUntil, preview: a.preview, problem: a.problem, message: a.message, notice: null };
    case "full":
      return { ...s, full: a.progress };
    case "ad":
      return { ...s, waitingForAd: a.waiting };
    case "searching":
      return { ...s, query: a.query, searching: true, notice: null };
    case "results":
      // What the engine holds now, also when this answer is for an older query: a saved read must not be read again.
      if (a.query !== s.query) return { ...s, kind: a.kind, readUntil: a.readUntil };
      return { ...s, kind: a.kind, readUntil: a.readUntil, searching: false, hits: a.hits, current: a.hits.length ? 0 : -1, weak: a.weak };
    case "failed":
      return { ...s, searching: false, notice: a.notice };
    case "retry":
      return { ...s, notice: null, problem: s.problem === "error" ? null : s.problem, message: "" };
    case "step":
      return s.hits.length ? { ...s, current: (s.current + a.by + s.hits.length) % s.hits.length } : s;
    case "clear":
      return { ...s, query: "", searching: false, hits: [], current: -1, weak: false };
  }
}

export const countText = (s: BarState): string => (s.hits.length ? `${s.current + 1} of ${s.hits.length}` : "");

// Try again is offered when something failed that another attempt can fix.
export const canRetry = (s: BarState): boolean =>
  !s.full && (s.notice ? s.notice.kind === "failed" : s.model.phase === "error" || s.problem === "error");

export const LIVE = "This is a live stream. Moments can search it once the stream has ended.";
export const NEEDS_WEBGPU =
  "Moments needs WebGPU: a recent Chrome, Edge or Brave on a computer with a graphics card. This browser does not offer it, so Moments cannot run here.";

// Why the model stopped, in plain words: a driver reset (a lost GPU device, or the runtime's bare error number that
// comes with one, PF26) or no answer in time. Anything else is shown as it is.
type Cause = "driver" | "silent" | "other";
const DRIVER = /GPU was reset|device (was )?lost|DXGI|DEVICE_HUNG|internal error \d+|WebGPU device/i;
export const causeOf = (message: string): Cause => (DRIVER.test(message) ? "driver" : /no answer for/i.test(message) ? "silent" : "other");

export function restartText(message: string): string {
  const cause = causeOf(message);
  if (cause === "driver") return "The graphics driver reset, so the AI model is restarting. This can take a minute.";
  if (cause === "silent") return "The AI model stopped answering, so it is restarting. This can take a minute.";
  return "The AI model stopped, so it is restarting. This can take a minute.";
}

export function modelErrorText(message: string, loadedBefore: boolean): string {
  const cause = causeOf(message);
  if (cause === "driver") return loadedBefore ? "The graphics driver reset and the AI model could not start again." : "The AI model could not load: the graphics driver reset.";
  if (cause === "silent") return loadedBefore ? "The AI model stopped answering." : "The AI model could not load: it stopped answering.";
  return `The AI model ${loadedBefore ? "stopped" : "could not load"}: ${message}`;
}

function trouble(s: BarState): string | null {
  if (s.notice?.kind === "updated") return s.notice.text; // nothing else works until the page is reloaded
  if (s.model.phase === "unsupported") return NEEDS_WEBGPU;
  if (s.live) return LIVE;
  if (s.model.phase === "error") return modelErrorText(s.model.message, s.model.device !== null);
  return null;
}

function busy(s: BarState, elapsedS: number, duration: number): string | null {
  if (s.waitingForAd === "jump") return "Jumps after the ad.";
  if (s.waitingForAd === "read") return "Reads after the ad.";
  if (s.full) return `Reading in full detail: ${clock((s.full.done / Math.max(s.full.total, 1)) * duration)} of ${clock(duration)}. Esc stops.`;
  if (s.model.phase === "restarting") return restartText(s.model.message);
  if (s.model.phase === "loading") return downloadStatus(s.model.loaded, s.model.total, elapsedS);
  if (s.preview) return `Reading this video: ${s.preview.done} of ${s.preview.total} moments`;
  return null;
}

function known(s: BarState): string {
  if (s.problem === "no-previews") return "No preview frames for this video. Search reads it in full detail.";
  if (s.kind === "preview") return "Quick results from preview frames. Your first search reads the video in full detail, once.";
  if (s.kind === "partial") return `Read in full detail up to ${clock(s.readUntil)}. Enter jumps to the next match.`;
  if (s.kind === "full") return "Read in full detail. Enter jumps to the next match.";
  return "Describe a moment in this video and press Enter.";
}

export function statusLine(s: BarState, elapsedS: number, duration: number): string {
  const blocked = trouble(s);
  if (blocked) return blocked;
  const working = busy(s, elapsedS, duration);
  if (working) return working;
  if (s.notice) return s.notice.text;
  if (s.problem === "error") return `Something went wrong reading this video: ${s.message}`;
  if (s.searching) return "Searching";
  if (s.query && s.hits.length === 0) return "Nothing found.";
  if (s.weak && s.hits.length) return "No clear match. Closest moments:";
  return known(s);
}
