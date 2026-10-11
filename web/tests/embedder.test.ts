// The embedder against a fake worker: a GPU that is lost or a run that never answers must end in a retry in a
// fresh worker, or in a clear error, never in an endless wait (PREFLIGHT PF26).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Embedder, type Timing, type WorkerLike } from "../src/embedder";
import type { Request, Response } from "../src/protocol";

const TIMING: Timing = { loadSilenceMs: 1_000, gpuCallMs: 500, cpuCallMs: 5_000, reloadTries: 3, restartPauseMs: 10 };
// Long enough for every reload try and its growing pause.
const RESTART_MS = TIMING.restartPauseMs * (1 + 2 + 3);

// What a worker does with each request: answer it (the default), stay silent, or reply with something else.
type Script = (req: Request, worker: FakeWorker) => void;

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<Response>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  sent: Request[] = [];
  terminated = false;
  constructor(private readonly script: Script) {}
  postMessage(req: Request): void {
    this.sent.push(req);
    this.script(req, this);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(msg: Response): void {
    queueMicrotask(() => this.onmessage?.({ data: msg } as MessageEvent<Response>));
  }
}

const answer: Script = (req, w) => {
  if (req.op === "load") w.reply({ id: req.id, kind: "loaded", device: "webgpu", vision: req.vision });
  else if (req.op === "texts") w.reply({ id: req.id, kind: "vectors", vectors: [new Float32Array([1, 0])] });
  else w.reply({ id: req.id, kind: "vectors", vectors: req.images.map((_, i) => new Float32Array([i])) });
};
const silentOn =
  (op: Request["op"]): Script =>
  (req, w) =>
    req.op === op ? undefined : answer(req, w);
const failOn =
  (op: Request["op"], message: string): Script =>
  (req, w) =>
    req.op === op ? w.reply({ id: req.id, kind: "error", message }) : answer(req, w);

// Worker n follows scripts[n]; any later worker answers everything.
function setup(...scripts: Script[]) {
  const workers: FakeWorker[] = [];
  const spawn = () => {
    const w = new FakeWorker(scripts[workers.length] ?? answer);
    workers.push(w);
    return w;
  };
  return { embedder: new Embedder(spawn, TIMING), workers };
}

const image = (fill: number) => ({ data: new Uint8ClampedArray(16).fill(fill), width: 2, height: 2 }) as ImageData;
const ops = (w: FakeWorker) => w.sent.map((r) => r.op);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Embedder", () => {
  it("answers calls on one worker when nothing goes wrong", async () => {
    const { embedder, workers } = setup(answer);
    await embedder.load(true);
    expect(await embedder.embedImages([image(1), image(2)])).toEqual([new Float32Array([0]), new Float32Array([1])]);
    expect(await embedder.embedText("a goal")).toEqual(new Float32Array([1, 0]));
    expect(embedder.device).toBe("webgpu");
    expect(workers).toHaveLength(1);
  });

  it("restarts a worker whose batch never answers, reloads the model and sends the same batch again", async () => {
    const { embedder, workers } = setup(silentOn("images"));
    await embedder.load(true);
    const result = embedder.embedImages([image(7)]);
    await vi.advanceTimersByTimeAsync(TIMING.gpuCallMs + RESTART_MS);
    expect(await result).toEqual([new Float32Array([0])]);
    expect(workers[0].terminated).toBe(true);
    expect(ops(workers[1])).toEqual(["load", "images"]);
    expect(workers[1].sent[0]).toMatchObject({ op: "load", vision: true });
    // The pixels went to the second worker intact: they were copied, not transferred away.
    const resent = workers[1].sent[1] as Extract<Request, { op: "images" }>;
    expect(Array.from(resent.images[0].data)).toEqual(new Array(16).fill(7));
  });

  it("does not wait for the deadline when the worker reports a lost GPU", async () => {
    const lostDuringBatch: Script = (req, w) =>
      req.op === "images" ? w.reply({ id: 0, kind: "lost", message: "DXGI_ERROR_DEVICE_HUNG" }) : answer(req, w);
    const { embedder, workers } = setup(lostDuringBatch);
    await embedder.load(true);
    const result = embedder.embedImages([image(1)]);
    await vi.advanceTimersByTimeAsync(RESTART_MS); // far less than gpuCallMs
    expect(await result).toEqual([new Float32Array([0])]);
    expect(workers).toHaveLength(2);
  });

  it("retries a load that failed (the runtime's bare-number error) in a fresh worker", async () => {
    const { embedder, workers } = setup(failOn("load", "the AI runtime failed (internal error 9950264)"));
    const loading = embedder.load(true);
    await vi.advanceTimersByTimeAsync(RESTART_MS);
    await loading;
    expect(embedder.device).toBe("webgpu");
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
  });

  it("ends in a clear error, not a hang, when the retry fails too", async () => {
    const { embedder } = setup(silentOn("images"), silentOn("images"));
    await embedder.load(true);
    const result = embedder.embedImages([image(1)]);
    const outcome = expect(result).rejects.toThrow(
      "the AI model failed twice, the second time after a restart: no answer for 1 s",
    );
    await vi.advanceTimersByTimeAsync(2 * TIMING.gpuCallMs + RESTART_MS);
    await outcome;
  });

  it("keeps opening fresh workers while the GPU cannot make a device, then sends the batch once more", async () => {
    const noDevice = failOn("load", "Failed to get a WebGPU device: D3D12 create command queue failed with E_OUTOFMEMORY");
    const { embedder, workers } = setup(silentOn("images"), noDevice, noDevice);
    await embedder.load(true);
    const result = embedder.embedImages([image(1)]);
    await vi.advanceTimersByTimeAsync(TIMING.gpuCallMs + RESTART_MS);
    expect(await result).toHaveLength(1);
    expect(workers.map(ops)).toEqual([["load", "images"], ["load"], ["load"], ["load", "images"]]);
  });

  it("gives up with the reason when no fresh worker can load the model", async () => {
    const noDevice = failOn("load", "Failed to get a WebGPU device");
    const { embedder, workers } = setup(failOn("texts", "the GPU was reset"), noDevice, noDevice, noDevice);
    await embedder.load(false);
    const result = embedder.embedText("a goal");
    const outcome = expect(result).rejects.toThrow("after a restart: Failed to get a WebGPU device");
    await vi.advanceTimersByTimeAsync(RESTART_MS);
    await outcome;
    expect(workers).toHaveLength(1 + TIMING.reloadTries);
  });

  it("tells the page about a restart, and keeps the reload's download progress to itself", async () => {
    const progressThenLoad: Script = (req, w) => {
      if (req.op === "load") w.reply({ id: req.id, kind: "progress", file: "model.onnx_data", loaded: 1, total: 2 });
      answer(req, w);
    };
    const { embedder } = setup(failOn("texts", "the GPU was reset: DXGI_ERROR_DEVICE_HUNG"), progressThenLoad);
    const reasons: string[] = [];
    let progress = 0;
    embedder.onRestart = (reason) => reasons.push(reason);
    embedder.onProgress = () => progress++;
    await embedder.load(false);
    const query = embedder.embedText("a goal");
    await vi.advanceTimersByTimeAsync(RESTART_MS);
    await query;
    expect(reasons).toEqual(["the GPU was reset: DXGI_ERROR_DEVICE_HUNG"]);
    expect(progress).toBe(0);
  });

  it("lets a slow load run as long as it keeps reporting progress", async () => {
    let loadId = 0;
    const slowLoad: Script = (req) => {
      if (req.op === "load") loadId = req.id;
    };
    const { embedder, workers } = setup(slowLoad);
    const loading = embedder.load(false);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(TIMING.loadSilenceMs - 100);
      workers[0].reply({ id: loadId, kind: "progress", file: "model.onnx_data", loaded: i, total: 10 });
    }
    workers[0].reply({ id: loadId, kind: "loaded", device: "webgpu", vision: false });
    await loading;
    expect(workers).toHaveLength(1); // 4.5 deadlines long, never restarted
  });

  it("restarts when the worker itself fails", async () => {
    const crashOnTexts: Script = (req, w) =>
      req.op === "texts" ? queueMicrotask(() => w.onerror?.({ message: "out of memory" } as ErrorEvent)) : answer(req, w);
    const { embedder, workers } = setup(crashOnTexts);
    await embedder.load(false);
    const result = embedder.embedText("a goal");
    await vi.advanceTimersByTimeAsync(RESTART_MS);
    expect(await result).toEqual(new Float32Array([1, 0]));
    expect(ops(workers[1])).toEqual(["load", "texts"]);
    expect(workers[1].sent[0]).toMatchObject({ vision: false });
  });

  it("restarts once for calls that were waiting on the same stuck worker", async () => {
    const { embedder, workers } = setup((req, w) => (req.op === "load" ? answer(req, w) : undefined));
    await embedder.load(true);
    const batch = embedder.embedImages([image(1)]);
    const query = embedder.embedText("a goal");
    await vi.advanceTimersByTimeAsync(TIMING.gpuCallMs + RESTART_MS);
    expect(await batch).toHaveLength(1);
    expect(await query).toEqual(new Float32Array([1, 0]));
    expect(workers).toHaveLength(2);
    expect(ops(workers[1]).filter((op) => op === "load")).toHaveLength(1);
  });

  it("gives the CPU fallback a longer deadline than the GPU", async () => {
    const cpu: Script = (req, w) =>
      req.op === "load" ? w.reply({ id: req.id, kind: "loaded", device: "wasm", vision: false }) : undefined;
    const { embedder, workers } = setup(cpu);
    await embedder.load(false);
    void embedder.embedText("a goal").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(TIMING.gpuCallMs * 2);
    expect(workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TIMING.cpuCallMs);
    expect(workers).toHaveLength(2);
  });
});
