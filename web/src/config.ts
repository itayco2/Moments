// Model settings shared by the worker and the page. DTYPE and IMAGE_TOKENS are set from measurements
// (EVAL.md, "In the browser"), not guessed.

export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
export type Dtype = "q4" | "q8";
// Measured on the 53 eval queries with the whole library built by transformers.js on WebGPU (EVAL.md):
// 4-bit pictures cost 3 first-place hits (37 vs 40), 8-bit pictures match Python; 4-bit text costs nothing.
export const TEXT_DTYPE: Dtype = "q4"; // 175 MB, all a demo visitor downloads
export const VISION_DTYPE: Dtype = "q8"; // 195 MB more, only for your own videos
export const IMAGE_TOKENS = 70;
export const QUERY_PREFIX = "task: search result | query: ";
export const FRAME_EVERY_S = 4;
export const DECODE_SHORT_SIDE = 360;
// WebGPU fails above about 2,700 tokens per batch (model card); each picture costs IMAGE_TOKENS + 2.
export const IMAGES_PER_BATCH = Math.max(1, Math.floor(2600 / (IMAGE_TOKENS + 2)));
