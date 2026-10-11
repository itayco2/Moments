// Model settings shared by the worker and the page. DTYPE and IMAGE_TOKENS are set from measurements
// (EVAL.md, "In the browser"), not guessed.

import type { ModelFile } from "./fetch-length";
import model from "./model.json";

export const MODEL_ID = model.id;
// The exact Hugging Face commit: the site's own copy and the Hugging Face fallback are the same bytes.
export const MODEL_REVISION = model.revision;
// The live site serves the model files itself: Hugging Face's CDN never caches them near the visitor, about
// 1 MB/s from Israel against 5+ MB/s from Vercel (PREFLIGHT PF20). Dev and CI load from Hugging Face.
export const SELF_HOSTED_MODEL = import.meta.env.VITE_SELF_HOSTED_MODEL === "1";
// Under the revision, so a file's URL never changes content and can be cached forever.
export const modelPath = (base: string) => `${base}models/${MODEL_REVISION.slice(0, 7)}/`;
// Where the worker loads model files from. The website serves its own copy (SELF_HOSTED_MODEL); the extension
// points at the website's copy (VITE_MODEL_BASE). Hugging Face at the same revision is the fallback either way.
// null means Hugging Face only.
export const MODEL_BASE: string | null =
  import.meta.env.VITE_MODEL_BASE || (SELF_HOSTED_MODEL ? modelPath(import.meta.env.BASE_URL) : null);
// The ONNX runtime's own files. The extension bundles them (the Chrome Web Store allows no remote code); the
// website lets transformers.js fetch them from its CDN. null means the CDN.
export const ORT_BASE: string | null = import.meta.env.VITE_ORT_BASE || null;
export const MODEL_FILES: ModelFile[] = model.files;
// What one load reads: the text half, plus the picture half for your own videos. Known up front, so the
// progress bar is exact from the first byte instead of growing as each file starts.
export const expectedBytes = (vision: boolean): number =>
  MODEL_FILES.filter((f) => vision || !f.path.includes("vision_encoder")).reduce((sum, f) => sum + f.size, 0);

export type Dtype = "q4" | "q8";
const SUFFIX: Record<Dtype, string> = { q4: "_q4", q8: "_quantized" }; // transformers.js file naming
export const onnxFiles = (text: Dtype, vision: Dtype): string[] =>
  [`model${SUFFIX[text]}`, `vision_encoder${SUFFIX[vision]}`].flatMap((n) => [`onnx/${n}.onnx`, `onnx/${n}.onnx_data`]);
// Measured on the 53 eval queries with the whole library built by transformers.js on WebGPU (EVAL.md):
// 4-bit pictures cost 3 first-place hits (37 vs 40), 8-bit pictures match Python; 4-bit text costs nothing.
export const TEXT_DTYPE: Dtype = "q4"; // 174 MB (+32 MB tokenizer), all a demo visitor downloads
export const VISION_DTYPE: Dtype = "q8"; // 195 MB more, only for your own videos
export const IMAGE_TOKENS = 70;
export const QUERY_PREFIX = "task: search result | query: ";
// Seconds between frames, by video length. Short clips every second: a game moment lasts a second or two, and
// every 4 s found the right one first 6 times in 16 against 10 at every second (PREFLIGHT PF21). Medium videos
// stay at 120 frames or fewer; long ones every 4 s, as the NASA demo was measured.
export const MAX_FRAME_EVERY_S = 4;
export const frameEvery = (duration: number): number =>
  Math.min(MAX_FRAME_EVERY_S, Math.max(1, Math.ceil(duration / 120)));
export const DECODE_SHORT_SIDE = 360;
// WebGPU fails above about 2,700 tokens per batch (model card); each picture costs IMAGE_TOKENS + 2.
export const IMAGES_PER_BATCH = Math.max(1, Math.floor(2600 / (IMAGE_TOKENS + 2)));
