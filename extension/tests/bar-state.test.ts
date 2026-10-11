// extension/tests/bar-state.test.ts
import { describe, expect, it } from "vitest";
import { type Action, canRetry, countText, initialState, LIVE, NEEDS_WEBGPU, reduce, restartText, statusLine } from "../src/content/bar-state";

const hits = [
  { start: 10, end: 11, score: 0.8 },
  { start: 50, end: 51, score: 0.78 },
  { start: 90, end: 91, score: 0.77 },
];
const model = (phase: Extract<Action, { type: "model" }>["phase"], over: Partial<Extract<Action, { type: "model" }>> = {}): Action => ({
  type: "model",
  phase,
  loaded: 0,
  total: 0,
  message: "",
  device: null,
  ...over,
});
const results = (query: string, over: Partial<Extract<Action, { type: "results" }>> = {}): Action => ({
  type: "results",
  query,
  hits,
  weak: false,
  kind: "preview",
  readUntil: 0,
  ...over,
});
const engine = (over: Partial<Extract<Action, { type: "engine" }>> = {}): Action => ({
  type: "engine",
  kind: "none",
  readUntil: 0,
  preview: null,
  problem: null,
  message: "",
  ...over,
});
const run = (...actions: Action[]) => actions.reduce(reduce, initialState);

describe("reduce", () => {
  it("starts clean on a new video but keeps the model's state", () => {
    const s = run(model("ready"), { type: "searching", query: "a goal" }, { type: "video", videoId: "dQw4w9WgXcQ", live: false });
    expect(s).toMatchObject({ videoId: "dQw4w9WgXcQ", query: "", hits: [], model: { phase: "ready" } });
  });

  it("ignores results for a query the viewer has already replaced", () => {
    let s = run({ type: "searching", query: "a goal" }, { type: "searching", query: "a save" }, results("a goal"));
    expect(s.hits).toEqual([]);
    s = reduce(s, results("a save"));
    expect(s).toMatchObject({ hits, current: 0, searching: false });
  });

  it("takes what the engine holds from every answer (M1: a stale kind would read a saved video again)", () => {
    const s = run(engine({ kind: "preview" }), { type: "searching", query: "q" }, results("q", { kind: "full", readUntil: 200 }));
    expect(s).toMatchObject({ kind: "full", readUntil: 200 });
    expect(reduce(s, results("q", { kind: "none" })).kind).toBe("none"); // after Forget all
  });

  it("steps through matches like Ctrl+F, wrapping at both ends", () => {
    let s = run({ type: "searching", query: "q" }, results("q"));
    s = reduce(s, { type: "step", by: -1 });
    expect(s.current).toBe(2);
    s = reduce(s, { type: "step", by: 1 });
    expect(countText(s)).toBe("1 of 3");
  });

  it("keeps the device known while the model restarts", () => {
    const s = run(model("ready", { device: "webgpu" }), model("restarting", { message: "no answer for 60 s" }));
    expect(s.model).toMatchObject({ phase: "restarting", device: "webgpu" });
  });
});

describe("errors never leave the bar on Searching (I4)", () => {
  it("a failed send ends Searching and offers Try again", () => {
    const s = run({ type: "searching", query: "q" }, { type: "failed", notice: { kind: "failed", text: "Moments could not reach its engine: gone" } });
    expect(s.searching).toBe(false);
    expect(statusLine(s, 0, 100)).toBe("Moments could not reach its engine: gone");
    expect(canRetry(s)).toBe(true);
  });

  it("after an extension update says to reload, above everything else, with no Try again", () => {
    const s = run(model("loading", { loaded: 1, total: 2 }), { type: "searching", query: "q" }, { type: "failed", notice: { kind: "updated", text: "Moments was updated: reload this page to keep using it." } });
    expect(statusLine(s, 0, 100)).toBe("Moments was updated: reload this page to keep using it.");
    expect(canRetry(s)).toBe(false);
  });

  it("while reconnecting says so without Try again, and the engine's next word clears it", () => {
    let s = run({ type: "searching", query: "q" }, { type: "failed", notice: { kind: "reconnecting", text: "Lost the line to Moments. Reconnecting." } });
    expect(s.searching).toBe(false);
    expect(canRetry(s)).toBe(false);
    s = reduce(s, engine({ kind: "preview" }));
    expect(s.notice).toBeNull();
  });

  it("a failed search answered by the engine shows its error with Try again; Try again clears it", () => {
    let s = run({ type: "searching", query: "q" }, engine({ problem: "error", message: "Error: stuck" }), results("q", { hits: [] }));
    expect(statusLine(s, 0, 100)).toBe("Something went wrong reading this video: Error: stuck");
    expect(canRetry(s)).toBe(true);
    s = reduce(s, { type: "retry" });
    expect(s.problem).toBeNull();
    expect(canRetry(s)).toBe(false);
  });
});

describe("statusLine", () => {
  it("shows the one-time download with speed and time left", () => {
    const s = run(model("loading", { loaded: 100e6, total: 402e6 }));
    expect(statusLine(s, 10, 213)).toBe("Downloading the AI model to this browser, once: 100 of 402 MB, 10.0 MB/s, about 35 s left");
  });

  it("names a full-detail read in video time, with the way out", () => {
    const s = run({ type: "full", progress: { done: 50, total: 100 } });
    expect(statusLine(s, 0, 600)).toBe("Reading in full detail: 5:00 of 10:00. Esc stops.");
  });

  it("is honest about weak matches and missing previews", () => {
    expect(statusLine(run({ type: "searching", query: "q" }, results("q", { weak: true })), 0, 100)).toBe("No clear match. Closest moments:");
    expect(statusLine(run(engine({ problem: "no-previews" })), 0, 100)).toBe("No preview frames for this video. Search reads it in full detail.");
  });

  it("asks the viewer to wait for an ad, for a jump and for a read (C2)", () => {
    expect(statusLine(run({ type: "ad", waiting: "jump" }), 0, 100)).toBe("Jumps after the ad.");
    expect(statusLine(run({ type: "ad", waiting: "read" }), 0, 100)).toBe("Reads after the ad.");
  });

  it("says how far a partial read reached", () => {
    expect(statusLine(run(engine({ kind: "partial", readUntil: 130 })), 0, 600)).toBe("Read in full detail up to 2:10. Enter jumps to the next match.");
  });

  it("tells a live stream it cannot be searched instead of promising a full read (M7)", () => {
    expect(statusLine(run({ type: "video", videoId: "dQw4w9WgXcQ", live: true }, engine({ problem: "no-previews" })), 0, 0)).toBe(LIVE);
  });

  it("says plainly that Moments needs WebGPU, above everything else, with no Try again", () => {
    const s = run(model("unsupported", { message: "this browser offers no WebGPU" }), engine({ kind: "preview" }), { type: "searching", query: "q" });
    expect(statusLine(s, 0, 100)).toBe(NEEDS_WEBGPU);
    expect(canRetry(s)).toBe(false);
  });

  it("says when the model restarts and when it stopped for good, with Try again (C3)", () => {
    const restarting = run(model("ready", { device: "webgpu" }), model("restarting", { message: "the GPU was reset: DXGI_ERROR_DEVICE_HUNG" }));
    expect(statusLine(restarting, 0, 100)).toBe("The graphics driver reset, so the AI model is restarting. This can take a minute.");
    expect(canRetry(restarting)).toBe(false);
    const failed = reduce(restarting, model("error", { message: "failed twice" }));
    expect(statusLine(failed, 0, 100)).toBe("The AI model stopped: failed twice");
    expect(canRetry(failed)).toBe(true);
    expect(statusLine(run(model("error", { message: "download failed" })), 0, 100)).toBe("The AI model could not load: download failed");
  });

  it("uses plain keyboard punctuation only", () => {
    const lines = [LIVE, NEEDS_WEBGPU, restartText("x"), statusLine(run(engine({ kind: "partial", readUntil: 5 })), 0, 10)];
    for (const line of lines) expect(line).not.toMatch(/[–—…]/);
  });
});

describe("restart and failure wording (plain, no raw numbers or nested brackets)", () => {
  it("names a driver reset for a lost device and for the runtime's bare error number", () => {
    for (const message of [
      "the GPU was reset: ID3D12Device::GetDeviceRemovedReason failed with DXGI_ERROR_DEVICE_HUNG (0x887A0006)",
      "the AI runtime failed (internal error 9950264)",
      "the AI model failed twice, the second time after a restart: the GPU was reset: device lost",
    ]) {
      expect(restartText(message)).toBe("The graphics driver reset, so the AI model is restarting. This can take a minute.");
    }
  });

  it("names a model that stopped answering, and keeps other reasons out of the restart line", () => {
    expect(restartText("no answer for 60 s")).toBe("The AI model stopped answering, so it is restarting. This can take a minute.");
    expect(restartText("something else")).toBe("The AI model stopped, so it is restarting. This can take a minute.");
  });

  it("says a driver reset plainly when the model could not start again", () => {
    const s = run(model("ready", { device: "webgpu" }), model("error", { message: "the AI model failed twice, the second time after a restart: the AI runtime failed (internal error 9950264)" }));
    expect(statusLine(s, 0, 100)).toBe("The graphics driver reset and the AI model could not start again.");
    expect(statusLine(run(model("error", { message: "the AI runtime failed (internal error 9950264)" })), 0, 100)).toBe("The AI model could not load: the graphics driver reset.");
  });
});
