/// <reference lib="webworker" />
// Runs EmbeddingGemma 2 off the main thread so the page never freezes while the model loads or works.

import { AutoConfig, AutoModel, AutoProcessor, env, RawImage } from "@huggingface/transformers";
import {
  type Dtype,
  IMAGE_TOKENS,
  MODEL_FILES,
  MODEL_ID,
  MODEL_REVISION,
  modelPath,
  QUERY_PREFIX,
  SELF_HOSTED_MODEL,
  TEXT_DTYPE,
  VISION_DTYPE,
} from "./config";
import { sizeFor, withKnownLength } from "./fetch-length";
import type { Request, Response } from "./protocol";

// The live site serves its own copy of the model; a file missing there falls back to Hugging Face at the same
// revision (transformers.js tries the local path first, then the remote one).
if (SELF_HOSTED_MODEL) {
  env.allowLocalModels = true;
  env.localModelPath = modelPath(import.meta.env.BASE_URL);
}
const PINNED = { revision: MODEL_REVISION };
const plainFetch = env.fetch;
env.fetch = async (input: string | URL, init?: RequestInit) => {
  const res = await plainFetch(input, init);
  const size = sizeFor(String(input), MODEL_FILES);
  return size === undefined ? res : withKnownLength(res, size);
};

type Device = "webgpu" | "wasm";

// transformers.js types its models and processors loosely; the shapes used here are checked by the e2e test.
let model: any = null;
let processor: any = null;
let hasVision = false;
let device: Device | null = null;

const post = (message: Response, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

async function pickDevice(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function load(id: number, vision: boolean): Promise<void> {
  if (model && (hasVision || !vision)) {
    post({ id, kind: "loaded", device: device!, vision: hasVision });
    return;
  }
  device ??= await pickDevice();
  const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (e.status === "progress" && e.file) {
      post({ id, kind: "progress", file: e.file, loaded: e.loaded ?? 0, total: e.total ?? 0 });
    } else if (e.status === "done" && e.file) {
      post({ id, kind: "file-done", file: e.file });
    }
  };
  // Only the parts we need: the audio encoder is never loaded, the vision encoder only for your own videos.
  const config = (await AutoConfig.from_pretrained(MODEL_ID, PINNED)) as Awaited<
    ReturnType<typeof AutoConfig.from_pretrained>
  > & { audio_config: unknown; vision_config: unknown };
  config.audio_config = null;
  if (!vision) config.vision_config = null;
  const dtype: Record<string, Dtype> = vision
    ? { model: TEXT_DTYPE, vision_encoder: VISION_DTYPE }
    : { model: TEXT_DTYPE };
  const next = await AutoModel.from_pretrained(MODEL_ID, { ...PINNED, config, device, dtype, progress_callback });
  processor ??= await AutoProcessor.from_pretrained(MODEL_ID, PINNED);
  processor.image_processor.max_soft_tokens = IMAGE_TOKENS;
  await model?.dispose?.();
  model = next;
  hasVision = vision;
  post({ id, kind: "loaded", device, vision });
}

async function embed(inputs: unknown): Promise<Float32Array[]> {
  const out = await model(inputs);
  const emb = out.sentence_embedding;
  const [n, dim] = emb.dims as number[];
  const data = emb.data as Float32Array;
  return Array.from({ length: n }, (_, i) => data.slice(i * dim, (i + 1) * dim));
}

async function embedTexts(id: number, texts: string[]): Promise<void> {
  const vectors = await embed(await processor(texts.map((t) => QUERY_PREFIX + t)));
  post({ id, kind: "vectors", vectors }, vectors.map((v) => v.buffer));
}

async function embedImages(id: number, images: { data: Uint8ClampedArray; width: number; height: number }[]) {
  // One list per image: a flat list would be read as ONE sample holding every image.
  const raw = images.map((im) => [new RawImage(im.data, im.width, im.height, 4).rgb()]);
  const vectors = await embed(await processor(null, raw));
  post({ id, kind: "vectors", vectors }, vectors.map((v) => v.buffer));
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    if (req.op === "load") await load(req.id, req.vision);
    else if (!model) throw new Error("the model is not loaded yet");
    else if (req.op === "texts") await embedTexts(req.id, req.texts);
    else if (req.op === "images") {
      if (!hasVision) throw new Error("the picture model is not loaded");
      await embedImages(req.id, req.images);
    }
  } catch (err) {
    post({ id: req.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
