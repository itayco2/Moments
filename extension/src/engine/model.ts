// The engine's one model and what every tab hears about it. The shared embedder (web/src/embedder.ts) puts a
// deadline on every call and restarts its worker when the GPU is lost or stuck (PREFLIGHT PF26); this keeps the
// tabs told: "restarting" while that runs, "ready" again (possibly on another device) once a call succeeds, and
// "error" when a call fails for good, which rejects so nothing waits on it.
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

export class ModelHost {
  state: ModelMessage = { type: "model", phase: "idle", loaded: 0, total: 0, device: null, message: "" };
  private embedder: EmbedderLike | null = null;
  private loading: Promise<EmbedderLike> | null = null;

  constructor(
    private readonly create: () => EmbedderLike,
    private readonly publish: (m: ModelMessage) => void,
  ) {}

  // Loads the model once, with the picture half. A restart inside the embedder loads it again by itself and keeps
  // device and vision set, so a model that was loaded once is never loaded again from here.
  ensure(): Promise<EmbedderLike> {
    const ready = this.embedder;
    if (ready?.device && ready.vision) return Promise.resolve(ready);
    this.loading ??= this.load().then(
      (e) => {
        this.loading = null;
        return e;
      },
      (err: unknown) => {
        this.loading = null;
        this.set({ phase: "error", message: reason(err) });
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
      if (this.state.phase !== "ready" || this.state.device !== e.device) this.set({ phase: "ready", device: e.device, message: "" });
      return out;
    } catch (err) {
      this.set({ phase: "error", message: reason(err) });
      throw err;
    }
  }

  private async load(): Promise<EmbedderLike> {
    const e = (this.embedder ??= this.make());
    this.set({ phase: "loading" });
    await e.load(true);
    this.set({ phase: "ready", device: e.device, message: "" });
    return e;
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
