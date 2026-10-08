// Embed the parity frames with transformers.js (the browser's picture model) and compare to Python.
//   node scripts/embed-images.mjs D:/moments/parity/frames q4 70
import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
const BATCH = 4;
const [, , dir, dtype = "q4", tokens = "70"] = process.argv;
if (!dir) {
  console.error("usage: node scripts/embed-images.mjs <frames dir> [q4|q8] [tokens]");
  process.exit(2);
}
if (process.env.MOMENTS_HF_CACHE) env.cacheDir = process.env.MOMENTS_HF_CACHE;

const names = JSON.parse(readFileSync(join(dir, "names.json"), "utf-8"));
const config = await AutoConfig.from_pretrained(MODEL_ID);
config.audio_config = null;
const model = await AutoModel.from_pretrained(MODEL_ID, {
  config,
  dtype: { model: dtype, vision_encoder: dtype },
  device: "cpu",
});
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
processor.image_processor.max_soft_tokens = Number(tokens);

const vectors = [];
const t0 = performance.now();
for (let i = 0; i < names.length; i += BATCH) {
  const images = await Promise.all(names.slice(i, i + BATCH).map((n) => RawImage.read(join(dir, n))));
  const out = await model(await processor(null, images.map((im) => [im.rgb()])));
  const [n, dim] = out.sentence_embedding.dims;
  const data = out.sentence_embedding.data;
  for (let j = 0; j < n; j++) vectors.push(Array.from(data.slice(j * dim, (j + 1) * dim)));
}
const msPerImage = (performance.now() - t0) / names.length;
const out = join(dir, `js-${dtype}-t${tokens}.json`);
writeFileSync(out, JSON.stringify({ dtype, tokens: Number(tokens), names, vectors }));
console.log(`${dtype} at ${tokens} tokens: ${names.length} frames, ${msPerImage.toFixed(0)} ms/frame on CPU -> ${out}`);
