import { describe, expect, it } from "vitest";
import { type EmbedderLike, ModelHost } from "../src/engine/model";
import type { ModelMessage } from "../src/protocol";

// Stands in for web/src/embedder.ts: what the host sees of PF26's restarts is onRestart, a device that may change,
// and calls that resolve or reject.
class FakeEmbedder implements EmbedderLike {
  device: "webgpu" | "wasm" | null = null;
  vision = false;
  onProgress: (loaded: number, total: number) => void = () => {};
  onRestart: (reason: string) => void = () => {};
  loads = 0;
  loadFails: Error | null = null;
  images: () => Promise<Float32Array[]> = async () => [new Float32Array(1)];

  async load(vision: boolean): Promise<void> {
    this.loads++;
    this.onProgress(10, 100);
    if (this.loadFails) throw this.loadFails;
    this.device ??= "webgpu";
    this.vision = vision;
  }
  async embedText(): Promise<Float32Array> {
    return new Float32Array(1);
  }
  embedImages(): Promise<Float32Array[]> {
    return this.images();
  }
}

function host() {
  const fake = new FakeEmbedder();
  const heard: ModelMessage[] = [];
  const model = new ModelHost(() => fake, (m) => heard.push(m));
  const phases = () => heard.map((m) => m.phase);
  return { fake, model, heard, phases };
}

describe("ModelHost", () => {
  it("loads once for every caller and tells the tabs: loading, then ready on the GPU", async () => {
    const { fake, model, phases } = host();
    await Promise.all([model.ensure(), model.ensure()]);
    await model.ensure();
    expect(fake.loads).toBe(1);
    expect(phases()).toEqual(["loading", "loading", "ready"]);
    expect(model.state).toMatchObject({ phase: "ready", device: "webgpu" });
  });

  it("says when the model restarts, and ready again on the device it now runs on once a call answers", async () => {
    const { fake, model, heard } = host();
    await model.ensure();
    fake.images = async () => {
      fake.onRestart("the GPU was reset: device hung");
      fake.device = "wasm"; // after a driver reset the GPU can be gone for good
      return [new Float32Array(1)];
    };

    await model.use((e) => e.embedImages([]));

    expect(heard.at(-2)).toMatchObject({ phase: "restarting", message: "the GPU was reset: device hung" });
    expect(heard.at(-1)).toMatchObject({ phase: "ready", device: "wasm", message: "" });
  });

  it("rejects a call that failed for good and says so; the next call needs no new load", async () => {
    const { fake, model } = host();
    await model.ensure();
    fake.images = async () => {
      throw new Error("the AI model failed twice, the second time after a restart: no answer for 60 s");
    };

    await expect(model.use((e) => e.embedImages([]))).rejects.toThrow(/failed twice/);
    expect(model.state).toMatchObject({ phase: "error", message: expect.stringContaining("no answer for 60 s") });

    fake.images = async () => [new Float32Array(1)];
    await model.use((e) => e.embedImages([]));
    expect(model.state.phase).toBe("ready");
    expect(fake.loads).toBe(1);
  });

  it("reports a failed load and loads again on the next call", async () => {
    const { fake, model } = host();
    fake.loadFails = new Error("download failed");
    await expect(model.ensure()).rejects.toThrow("download failed");
    expect(model.state).toMatchObject({ phase: "error", message: "download failed" });

    fake.loadFails = null;
    await model.ensure();
    expect(fake.loads).toBe(2);
    expect(model.state.phase).toBe("ready");
  });

  it("Try again checks a loaded model by loading it again, and does nothing when there was no failure", async () => {
    const { fake, model } = host();
    await model.retry();
    expect(fake.loads).toBe(0);
    await model.ensure();
    fake.images = async () => {
      throw new Error("stuck");
    };
    await expect(model.use((e) => e.embedImages([]))).rejects.toThrow();

    await model.retry();

    expect(fake.loads).toBe(2);
    expect(model.state.phase).toBe("ready");
  });
});
