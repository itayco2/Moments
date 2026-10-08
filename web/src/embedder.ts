// The page's handle on the model worker: promise-based calls plus combined download progress.

import { IMAGES_PER_BATCH } from "./config";
import { DownloadTally } from "./progress";
import type { Request, Response } from "./protocol";

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void };
// Distributive Omit, so each member of the Request union keeps its own fields.
type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

export class Embedder {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private tally = new DownloadTally();
  device: "webgpu" | "wasm" | null = null;
  vision = false;
  onProgress: (loaded: number, total: number) => void = () => {};

  constructor() {
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const msg = event.data;
      if (msg.kind === "progress") {
        this.tally.update(msg);
        this.onProgress(this.tally.loaded, this.tally.total);
        return;
      }
      if (msg.kind === "file-done") {
        this.tally.done(msg.file);
        this.onProgress(this.tally.loaded, this.tally.total);
        return;
      }
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.kind === "error") waiter.reject(new Error(msg.message));
      else waiter.resolve(msg);
    };
  }

  private call(body: RequestBody, transfer: Transferable[] = []): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id } as Request, transfer);
    });
  }

  async load(vision: boolean): Promise<void> {
    const res = await this.call({ op: "load", vision });
    if (res.kind === "loaded") {
      this.device = res.device;
      this.vision = res.vision;
    }
  }

  async embedText(text: string): Promise<Float32Array> {
    const res = await this.call({ op: "texts", texts: [text] });
    if (res.kind !== "vectors") throw new Error("unexpected reply from the model");
    return res.vectors[0];
  }

  async embedImages(images: ImageData[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < images.length; i += IMAGES_PER_BATCH) {
      const batch = images.slice(i, i + IMAGES_PER_BATCH).map((im) => ({
        data: im.data,
        width: im.width,
        height: im.height,
      }));
      const res = await this.call({ op: "images", images: batch }, batch.map((b) => b.data.buffer));
      if (res.kind !== "vectors") throw new Error("unexpected reply from the model");
      out.push(...res.vectors);
    }
    return out;
  }
}
