// Embed every exported index frame with transformers.js, as the browser does, to rebuild the index in
// the browser stack and score it end to end. WebGPU in Node uses the same ONNX Runtime path as a browser.
//   node scripts/embed-frames.mjs D:/moments/parity/index-frames D:/moments/parity/js-q4-t70.bin q4 70 webgpu
import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
const [, , dir, outPath, dtype = "q4", tokens = "70", device = "webgpu"] = process.argv;
if (!dir || !outPath) {
  console.error("usage: node scripts/embed-frames.mjs <frames dir> <out.bin> [dtype] [tokens] [device]");
  process.exit(2);
}
if (process.env.MOMENTS_HF_CACHE) env.cacheDir = process.env.MOMENTS_HF_CACHE;
// The same batch rule as the page (src/config.ts): stay under about 2,700 tokens per WebGPU dispatch.
const batch = Math.max(1, Math.floor(2600 / (Number(tokens) + 2)));

const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
const config = await AutoConfig.from_pretrained(MODEL_ID);
config.audio_config = null;
const model = await AutoModel.from_pretrained(MODEL_ID, {
  config,
  device,
  dtype: { model: dtype, vision_encoder: dtype },
});
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
processor.image_processor.max_soft_tokens = Number(tokens);

const dim = 768;
const out = new Float32Array(files.length * dim);
const t0 = performance.now();
for (let i = 0; i < files.length; i += batch) {
  const images = await Promise.all(files.slice(i, i + batch).map((f) => RawImage.read(join(dir, f))));
  const res = await model(await processor(null, images.map((im) => [im.rgb()])));
  out.set(res.sentence_embedding.data, i * dim);
  if ((i / batch) % 10 === 0) {
    const rate = (i + images.length) / ((performance.now() - t0) / 1000);
    console.log(`${i + images.length}/${files.length} frames, ${rate.toFixed(1)}/s`);
  }
}
const seconds = (performance.now() - t0) / 1000;
writeFileSync(outPath, Buffer.from(out.buffer));
console.log(`${dtype} ${tokens} tokens on ${device}: ${files.length} frames in ${seconds.toFixed(0)} s ` +
  `(${(files.length / seconds).toFixed(1)}/s, batch ${batch}) -> ${outPath}`);
