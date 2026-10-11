// Everything the bar shows, as pure state. The DOM code only renders it.
import { clock } from "../../../web/src/format";
import { downloadStatus } from "../../../web/src/progress";
import type { Hit, Kind, ModelMessage, StateMessage } from "../protocol";

export interface Progress {
  done: number;
  total: number;
}

export interface BarState {
  model: { phase: ModelMessage["phase"]; loaded: number; total: number; message: string };
  videoId: string | null;
  kind: Kind;
  preview: Progress | null;
  full: Progress | null;
  problem: StateMessage["problem"];
  message: string;
  waitingForAd: boolean;
  query: string;
  searching: boolean;
  hits: Hit[];
  current: number;
  weak: boolean;
}

export const initialState: BarState = {
  model: { phase: "idle", loaded: 0, total: 0, message: "" },
  videoId: null,
  kind: "none",
  preview: null,
  full: null,
  problem: null,
  message: "",
  waitingForAd: false,
  query: "",
  searching: false,
  hits: [],
  current: -1,
  weak: false,
};

export type Action =
  | { type: "model"; phase: ModelMessage["phase"]; loaded: number; total: number; message: string }
  | { type: "video"; videoId: string }
  | { type: "engine"; kind: Kind; preview: Progress | null; problem: StateMessage["problem"]; message: string }
  | { type: "full"; progress: Progress | null }
  | { type: "ad"; waiting: boolean }
  | { type: "searching"; query: string }
  | { type: "results"; query: string; hits: Hit[]; weak: boolean }
  | { type: "step"; by: 1 | -1 }
  | { type: "clear" };

export function reduce(s: BarState, a: Action): BarState {
  switch (a.type) {
    case "model":
      return { ...s, model: { phase: a.phase, loaded: a.loaded, total: a.total, message: a.message } };
    case "video":
      return { ...initialState, model: s.model, videoId: a.videoId };
    case "engine":
      return { ...s, kind: a.kind, preview: a.preview, problem: a.problem, message: a.message };
    case "full":
      return { ...s, full: a.progress };
    case "ad":
      return { ...s, waitingForAd: a.waiting };
    case "searching":
      return { ...s, query: a.query, searching: true };
    case "results":
      if (a.query !== s.query) return s;
      return { ...s, searching: false, hits: a.hits, current: a.hits.length ? 0 : -1, weak: a.weak };
    case "step":
      return s.hits.length ? { ...s, current: (s.current + a.by + s.hits.length) % s.hits.length } : s;
    case "clear":
      return { ...s, query: "", searching: false, hits: [], current: -1, weak: false };
  }
}

export const countText = (s: BarState): string => (s.hits.length ? `${s.current + 1} of ${s.hits.length}` : "");

export function statusLine(s: BarState, elapsedS: number, duration: number): string {
  if (s.model.phase === "error") return `The AI model could not load: ${s.model.message}`;
  if (s.waitingForAd) return "Jumps after the ad.";
  if (s.full) return `Reading in full detail: ${clock((s.full.done / Math.max(s.full.total, 1)) * duration)} of ${clock(duration)}. Esc stops.`;
  if (s.model.phase === "loading") return downloadStatus(s.model.loaded, s.model.total, elapsedS);
  if (s.preview) return `Reading this video: ${s.preview.done} of ${s.preview.total} moments`;
  if (s.problem === "error") return `Something went wrong reading this video: ${s.message}`;
  if (s.searching) return "Searching";
  if (s.query && s.hits.length === 0) return "Nothing found.";
  if (s.weak && s.hits.length) return "No clear match. Closest moments:";
  if (s.problem === "no-previews") return "No preview frames for this video. Search reads it in full detail.";
  if (s.kind === "preview") return "Quick results from preview frames. Your first search reads the video in full detail, once.";
  if (s.kind === "full") return "Read in full detail. Enter jumps to the next match.";
  return "Describe a moment in this video and press Enter.";
}
