// The page's handle on the model worker: promise-based calls plus combined download progress.
//
// The GPU can fail under the model: a driver reset loses the WebGPU device, and a run in flight then ends in an
// error, or never answers at all (PREFLIGHT PF26). So a lost GPU is reported at once, every call has a deadline,
// and a call that fails is tried once more in a fresh worker with the model loaded again. A second failure is an
// error with the reason in it, never an endless wait.

import { IMAGES_PER_BATCH } from "./config";
import { DownloadTally } from "./progress";
import type { Request, Response } from "./protocol";

// Distributive Omit, so each member of the Request union keeps its own fields.
type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

// The part of a Worker the embedder uses; tests pass a fake.
export interface WorkerLike {
  onmessage: ((event: MessageEvent<Response>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: Request): void;
  terminate(): void;
}

export interface Timing {
  // A load can take minutes on a slow line, but it reports progress all along: this long without a word, it is stuck.
  loadSilenceMs: number;
  // One search or one batch of pictures on the GPU: about 2 s for 36 pictures on an RTX 3070, at most 15 s with
  // three tabs indexing on that one GPU at once (PF26).
  gpuCallMs: number;
  // The CPU fallback is much slower and was not measured; only a hang should reach this.
  cpuCallMs: number;
  // Right after a driver reset, making a GPU device fails for a while (E_OUTOFMEMORY 12 to 17 s after the reset,
  // PF26): a restart tries up to this many fresh workers, the first after restartPauseMs, the next after twice that.
  reloadTries: number;
  restartPauseMs: number;
}

export const TIMING: Timing = {
  loadSilenceMs: 120_000,
  gpuCallMs: 60_000,
  cpuCallMs: 600_000,
  reloadTries: 4,
  restartPauseMs: 5_000,
};

type Pending = {
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
  silenceMs: number;
  timer?: ReturnType<typeof setTimeout>;
};

const MAX_REASON_CHARS = 200;
const brief = (err: unknown): string => {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 3)}...` : text;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const spawnWorker = (): WorkerLike => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

export class Embedder {
  device: "webgpu" | "wasm" | null = null;
  vision = false;
  onProgress: (loaded: number, total: number) => void = () => {};
  // A call failed and the model is being started again (no download progress is reported while that runs).
  onRestart: (reason: string) => void = () => {};
  private worker: WorkerLike;
  private generation = 0; // which worker this is; a call that failed on an older one does not restart again
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private tally = new DownloadTally();
  private wantVision: boolean | null = null; // what a fresh worker loads again; null until a load was asked for
  private restarting: Promise<void> | null = null;

  constructor(
    private readonly spawn: () => WorkerLike = spawnWorker,
    private readonly timing: Timing = TIMING,
  ) {
    this.worker = this.start();
  }

  async load(vision: boolean): Promise<void> {
    this.wantVision = vision || this.wantVision === true;
    await this.withRetry(() => this.loadOnce(vision));
  }

  async embedText(text: string): Promise<Float32Array> {
    const res = await this.withRetry(() => this.send({ op: "texts", texts: [text] }, this.callMs()));
    if (res.kind !== "vectors") throw new Error("unexpected reply from the model");
    return res.vectors[0];
  }

  async embedImages(images: ImageData[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < images.length; i += IMAGES_PER_BATCH) {
      // Copied to the worker, not transferred: a batch that fails is sent again to a fresh worker.
      const batch = images.slice(i, i + IMAGES_PER_BATCH).map((im) => ({
        data: im.data,
        width: im.width,
        height: im.height,
      }));
      const res = await this.withRetry(() => this.send({ op: "images", images: batch }, this.callMs()));
      if (res.kind !== "vectors") throw new Error("unexpected reply from the model");
      out.push(...res.vectors);
    }
    return out;
  }

  private start(): WorkerLike {
    const worker = this.spawn();
    const generation = ++this.generation;
    this.tally = new DownloadTally();
    worker.onmessage = (event) => generation === this.generation && this.receive(event.data);
    worker.onerror = (event) =>
      generation === this.generation && this.fail(new Error(`the AI model's worker failed: ${event.message || "unknown error"}`));
    return worker;
  }

  private callMs(): number {
    return this.device === "wasm" ? this.timing.cpuCallMs : this.timing.gpuCallMs;
  }

  private async loadOnce(vision: boolean): Promise<void> {
    const res = await this.send({ op: "load", vision }, this.timing.loadSilenceMs);
    if (res.kind === "loaded") {
      this.device = res.device;
      this.vision = res.vision;
    }
  }

  // Once, then once more after a restart. Calls made while a restart runs wait for it.
  private async withRetry<T>(run: () => Promise<T>): Promise<T> {
    await this.restarting?.catch(() => undefined);
    const generation = this.generation;
    try {
      return await run();
    } catch (first) {
      try {
        await this.restart(generation, first);
        return await run();
      } catch (second) {
        throw new Error(`the AI model failed twice, the second time after a restart: ${brief(second)}`);
      }
    }
  }

  // A fresh worker with the model loaded again. Calls that failed on the same worker share one restart.
  private restart(generation: number, cause: unknown): Promise<void> {
    if (generation === this.generation) {
      this.fail(new Error("the AI model was restarted")); // anything else waiting on the old worker tries again too
      this.onRestart(brief(cause));
      const restarting = this.reopen(this.wantVision);
      this.restarting = restarting;
      const done = () => {
        if (this.restarting === restarting) this.restarting = null;
      };
      restarting.then(done, done);
    }
    return this.restarting ?? Promise.resolve();
  }

  private async reopen(reload: boolean | null): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate(); // also frees what it held on the GPU
      this.worker = this.start();
      await pause(this.timing.restartPauseMs * attempt);
      if (reload === null) return;
      try {
        await this.loadOnce(reload);
        return;
      } catch (err) {
        if (attempt >= this.timing.reloadTries) throw err;
      }
    }
  }

  private send(body: RequestBody, silenceMs: number): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const waiter: Pending = { resolve, reject, silenceMs };
      this.pending.set(id, waiter);
      this.arm(waiter);
      try {
        this.worker.postMessage({ ...body, id } as Request);
      } catch (err) {
        clearTimeout(waiter.timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // A call's deadline; progress from a load pushes it back.
  private arm(waiter: Pending): void {
    clearTimeout(waiter.timer);
    const seconds = Math.round(waiter.silenceMs / 1000);
    waiter.timer = setTimeout(() => this.fail(new Error(`no answer for ${seconds} s`)), waiter.silenceMs);
  }

  // Every call waiting on the current worker fails: a worker that is stuck or lost its GPU answers none of them.
  private fail(reason: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    this.pending.clear();
  }

  private receive(msg: Response): void {
    if (msg.kind === "lost") return this.fail(new Error(`the GPU was reset: ${msg.message}`));
    const waiter = this.pending.get(msg.id);
    if (msg.kind === "progress" || msg.kind === "file-done") {
      if (msg.kind === "progress") this.tally.update(msg);
      else this.tally.done(msg.file);
      if (!this.restarting) this.onProgress(this.tally.loaded, this.tally.total);
      if (waiter) this.arm(waiter);
      return;
    }
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.pending.delete(msg.id);
    if (msg.kind === "error") waiter.reject(new Error(msg.message));
    else waiter.resolve(msg);
  }
}
