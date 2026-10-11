// What the engine tells a tab, as plain data: the states that follow from what is known or what went wrong.
import type { FromEngine, Kind, ResultsMessage, StateMessage, ToEngine } from "../protocol";

// A video that is already saved needs no reading.
export function knownState(videoId: string, known: { kind: "preview" | "full"; times: readonly number[] }): StateMessage {
  return { type: "state", videoId, kind: known.kind, reading: null, done: known.times.length, total: known.times.length, problem: null, message: "" };
}

// A failure is always reported, and a failed search is still answered under its id so no tab waits for it forever.
export function failureReplies(m: ToEngine, kind: Kind, err: unknown): FromEngine[] {
  const problem: StateMessage = { type: "state", videoId: m.videoId, kind, reading: null, done: 0, total: 0, problem: "error", message: String(err) };
  if (m.type !== "search") return [problem];
  const answer: ResultsMessage = { type: "results", id: m.id, videoId: m.videoId, kind, hits: [], weak: false };
  return [problem, answer];
}
