// What the engine tells a tab, as plain data: the states that follow from what is known or what went wrong.
import type { FromEngine, Kind, ResultsMessage, StateMessage, ToEngine } from "../protocol";

export interface Known {
  kind: Kind;
  readUntil: number;
  viewerStopped: boolean;
}
export const NOTHING: Known = { kind: "none", readUntil: 0, viewerStopped: false };

// A video that is already saved needs no reading.
export function knownState(videoId: string, known: Known & { times: readonly number[] }): StateMessage {
  const n = known.times.length;
  const { kind, readUntil, viewerStopped } = known;
  return { type: "state", videoId, kind, readUntil, viewerStopped, reading: null, done: n, total: n, problem: null, message: "" };
}

// A failure is always reported, and a failed search is still answered under its id so no tab waits for it forever.
export function failureReplies(m: ToEngine, known: Known, err: unknown): FromEngine[] {
  const { kind, readUntil, viewerStopped } = known;
  const problem: StateMessage = { type: "state", videoId: m.videoId, kind, readUntil, viewerStopped, reading: null, done: 0, total: 0, problem: "error", message: String(err) };
  if (m.type !== "search") return [problem];
  const answer: ResultsMessage = { type: "results", id: m.id, videoId: m.videoId, kind, readUntil, viewerStopped, hits: [], weak: false, failed: true };
  return [problem, answer];
}
