// The engine's one model and what every tab hears about it. The shared embedder (web/src/embedder.ts) puts a
// deadline on every call and restarts its worker when the GPU is lost or stuck (PREFLIGHT PF26); this keeps the
// tabs told: "restarting" while that runs, "ready" again once a call succeeds, and "error" when a call fails for
// good, which rejects so nothing waits on it.
//
// The extension needs WebGPU: the model's 4-bit text half has no CPU (WebAssembly) implementation in the runtime
// ("GatherBlockQuantized"). Without WebGPU nothing is downloaded or loaded and every tab hears "unsupported".
import type { ModelMessage } from "../protocol";

export interface EmbedderLike {
  device: "webgpu" | "wasm" | null;
  vision: boolean;
  onProgress: (loaded: number, total: number) => void;
  onRestart: (reason: string) => void;
  load(vision: boolean): Promise<void>;
  embedText(text: string): Promise<Float32Array>;
  embedImages(images: ImageData[]): Promise<Float32Array[]>;
}

const MAX_REASON_CHARS = 200;
export const reason = (err: unknown): string => {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 3)}...` : text;
};

export const NO_WEBGPU = "this browser offers no WebGPU";

export class ModelHost {
  state: ModelMessage = { type: "model", phase: "idle", loaded: 0, total: 0, device: null, message: "" };
  private embedder: EmbedderLike | null = null;
  private loading: Promise<EmbedderLike> | null = null;
  private support: Promise<boolean> | null = null;

  constructor(
    private readonly create: () => EmbedderLike,
    private readonly publish: (m: ModelMessage) => void,
    private readonly hasWebGpu: () => Promise<boolean>,
  ) {}

  get unsupported(): boolean {
    return this.state.phase === "unsupported";
  }

  // Asked once, at the engine's start, so the first word every tab hears already says whether Moments can run.
  async checkSupport(): Promise<boolean> {
    this.support ??= this.hasWebGpu().catch(() => false);
    const ok = await this.support;
    if (!ok && !this.unsupported) this.set({ phase: "unsupported", message: NO_WEBGPU });
    return ok;
  }

  // Loads the model once, with the picture half. A restart inside the embedder loads it again by itself and keeps
  // device and vision set, so a model that was loaded once is never loaded again from here.
  ensure(): Promise<EmbedderLike> {
    const ready = this.embedder;
    if (ready?.device === "webgpu" && ready.vision) return Promise.resolve(ready);
    this.loading ??= this.load().then(
      (e) => {
        this.loading = null;
        return e;
      },
      (err: unknown) => {
        this.loading = null;
        if (!this.unsupported) this.set({ phase: "error", message: reason(err) });
        throw err;
      },
    );
    return this.loading;
  }

  // Try again after a failure. Loading again answers at once when the model is fine and restarts it when it is not.
  async retry(): Promise<void> {
    if (this.state.phase !== "error") return;
    const e = this.embedder;
    if (e?.device && e.vision) await this.use((m) => m.load(true));
    else await this.ensure();
  }

  // Every use of the model goes through here.
  async use<T>(work: (e: EmbedderLike) => Promise<T>): Promise<T> {
    const e = await this.ensure();
    try {
      const out = await work(e);
      this.refuseCpu(e);
      if (this.state.phase !== "ready" || this.state.device !== e.device) this.set({ phase: "ready", device: e.device, message: "" });
      return out;
    } catch (err) {
      if (!this.unsupported) this.set({ phase: "error", message: reason(err) });
      throw err;
    }
  }

  private async load(): Promise<EmbedderLike> {
    if (!(await this.checkSupport())) throw new Error(NO_WEBGPU);
    const e = (this.embedder ??= this.make());
    this.set({ phase: "loading" });
    await e.load(true);
    this.refuseCpu(e);
    this.set({ phase: "ready", device: e.device, message: "" });
    return e;
  }

  // The runtime picked the CPU (no GPU adapter after all, or none after a driver reset): the model cannot run there.
  private refuseCpu(e: EmbedderLike): void {
    if (e.device === "webgpu") return;
    this.set({ phase: "unsupported", device: e.device, message: NO_WEBGPU });
    throw new Error(NO_WEBGPU);
  }

  private make(): EmbedderLike {
    const e = this.create();
    e.onProgress = (loaded, total) => this.set({ phase: "loading", loaded, total });
    e.onRestart = (why) => this.set({ phase: "restarting", message: why });
    return e;
  }

  private set(patch: Partial<Omit<ModelMessage, "type">>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
}
