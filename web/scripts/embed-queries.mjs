// Embed the eval queries with transformers.js, exactly as the browser does, for the parity check.
//   node scripts/embed-queries.mjs ../eval/queries.json D:/moments/parity/queries-q4.json q4
import { AutoConfig, AutoModel, AutoProcessor, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync } from "node:fs";

const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
const PREFIX = "task: search result | query: ";
const BATCH = 8;
const [, , queriesPath, outPath, dtype = "q4"] = process.argv;
if (!queriesPath || !outPath) {
  console.error("usage: node scripts/embed-queries.mjs <queries.json> <out.json> [q4|q8|fp32]");
  process.exit(2);
}
if (process.env.MOMENTS_HF_CACHE) env.cacheDir = process.env.MOMENTS_HF_CACHE;

const spec = JSON.parse(readFileSync(queriesPath, "utf-8"));
const texts = [...spec.queries.map((q) => q.query), ...spec.negatives];

const config = await AutoConfig.from_pretrained(MODEL_ID);
config.vision_config = config.audio_config = null;
const t0 = performance.now();
const model = await AutoModel.from_pretrained(MODEL_ID, { config, dtype: { model: dtype }, device: "cpu" });
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const loadS = (performance.now() - t0) / 1000;

const vectors = [];
const t1 = performance.now();
for (let i = 0; i < texts.length; i += BATCH) {
  const out = await model(await processor(texts.slice(i, i + BATCH).map((t) => PREFIX + t)));
  const [n, dim] = out.sentence_embedding.dims;
  const data = out.sentence_embedding.data;
  for (let j = 0; j < n; j++) vectors.push(Array.from(data.slice(j * dim, (j + 1) * dim)));
}
const perQueryMs = (performance.now() - t1) / texts.length;
writeFileSync(outPath, JSON.stringify({ dtype, texts, vectors }));
console.log(`${dtype}: ${texts.length} queries, load ${loadS.toFixed(1)} s, ${perQueryMs.toFixed(0)} ms/query on CPU -> ${outPath}`);
