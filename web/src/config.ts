// Model settings shared by the worker and the page. DTYPE and IMAGE_TOKENS are set from measurements
// (EVAL.md, "In the browser"), not guessed.

export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
export type Dtype = "q4" | "q8";
export const DTYPE: Dtype = "q4";
export const IMAGE_TOKENS = 70;
export const QUERY_PREFIX = "task: search result | query: ";
export const FRAME_EVERY_S = 4;
export const DECODE_SHORT_SIDE = 360;
// WebGPU fails above about 2,700 tokens per batch (model card); each picture costs IMAGE_TOKENS + 2.
export const IMAGES_PER_BATCH = Math.max(1, Math.floor(2600 / (IMAGE_TOKENS + 2)));
