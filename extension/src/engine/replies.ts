// What the engine tells a tab, as plain data: the states that follow from what is known or what went wrong.
import type { FromEngine, Kind, ResultsMessage, StateMessage, ToEngine } from "../protocol";

export interface Known {
  kind: Kind;
  readUntil: number;
}
export const NOTHING: Known = { kind: "none", readUntil: 0 };

// A video that is already saved needs no reading.
export function knownState(videoId: string, known: Known & { times: readonly number[] }): StateMessage {
  const n = known.times.length;
  return { type: "state", videoId, kind: known.kind, readUntil: known.readUntil, reading: null, done: n, total: n, problem: null, message: "" };
}

// A failure is always reported, and a failed search is still answered under its id so no tab waits for it forever.
export function failureReplies(m: ToEngine, known: Known, err: unknown): FromEngine[] {
  const { kind, readUntil } = known;
  const problem: StateMessage = { type: "state", videoId: m.videoId, kind, readUntil, reading: null, done: 0, total: 0, problem: "error", message: String(err) };
  if (m.type !== "search") return [problem];
  const answer: ResultsMessage = { type: "results", id: m.id, videoId: m.videoId, kind, readUntil, hits: [], weak: false, failed: true };
  return [problem, answer];
}
