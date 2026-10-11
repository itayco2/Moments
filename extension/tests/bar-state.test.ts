// extension/tests/bar-state.test.ts
import { describe, expect, it } from "vitest";
import { countText, initialState, reduce, statusLine } from "../src/content/bar-state";

const hits = [
  { start: 10, end: 11, score: 0.8 },
  { start: 50, end: 51, score: 0.78 },
  { start: 90, end: 91, score: 0.77 },
];

describe("reduce", () => {
  it("starts clean on a new video but keeps the model's state", () => {
    let s = reduce(initialState, { type: "model", phase: "ready", loaded: 1, total: 1, message: "" });
    s = reduce(s, { type: "searching", query: "a goal" });
    s = reduce(s, { type: "video", videoId: "dQw4w9WgXcQ" });
    expect(s).toMatchObject({ videoId: "dQw4w9WgXcQ", query: "", hits: [], model: { phase: "ready" } });
  });

  it("ignores results for a query the viewer has already replaced", () => {
    let s = reduce(initialState, { type: "searching", query: "a goal" });
    s = reduce(s, { type: "searching", query: "a save" });
    s = reduce(s, { type: "results", query: "a goal", hits, weak: false });
    expect(s.hits).toEqual([]);
    s = reduce(s, { type: "results", query: "a save", hits, weak: false });
    expect(s).toMatchObject({ hits, current: 0, searching: false });
  });

  it("steps through matches like Ctrl+F, wrapping at both ends", () => {
    let s = reduce(reduce(initialState, { type: "searching", query: "q" }), { type: "results", query: "q", hits, weak: false });
    s = reduce(s, { type: "step", by: -1 });
    expect(s.current).toBe(2);
    s = reduce(s, { type: "step", by: 1 });
    expect(countText(s)).toBe("1 of 3");
  });
});

describe("statusLine", () => {
  it("shows the one-time download with speed and time left", () => {
    const s = reduce(initialState, { type: "model", phase: "loading", loaded: 100e6, total: 402e6, message: "" });
    expect(statusLine(s, 10, 213)).toBe("Downloading the AI model to this browser, once: 100 of 402 MB, 10.0 MB/s, about 35 s left");
  });

  it("names a full-detail read in video time, with the way out", () => {
    const s = reduce(initialState, { type: "full", progress: { done: 50, total: 100 } });
    expect(statusLine(s, 0, 600)).toBe("Reading in full detail: 5:00 of 10:00. Esc stops.");
  });

  it("is honest about weak matches and missing previews", () => {
    let s = reduce(reduce(initialState, { type: "searching", query: "q" }), { type: "results", query: "q", hits, weak: true });
    expect(statusLine(s, 0, 100)).toBe("No clear match. Closest moments:");
    s = reduce(initialState, { type: "engine", kind: "none", preview: null, problem: "no-previews", message: "" });
    expect(statusLine(s, 0, 100)).toBe("No preview frames for this video. Search reads it in full detail.");
  });

  it("asks the viewer to wait for an ad", () => {
    expect(statusLine(reduce(initialState, { type: "ad", waiting: true }), 0, 100)).toBe("Jumps after the ad.");
  });
});
