// Messages between the page and the model worker.

export type Request =
  | { id: number; op: "load"; vision: boolean }
  | { id: number; op: "texts"; texts: string[] }
  | { id: number; op: "images"; images: { data: Uint8ClampedArray; width: number; height: number }[] };

export type Response =
  | { id: number; kind: "progress"; file: string; loaded: number; total: number }
  | { id: number; kind: "file-done"; file: string }
  | { id: number; kind: "loaded"; device: "webgpu" | "wasm"; vision: boolean }
  | { id: number; kind: "vectors"; vectors: Float32Array[] }
  | { id: number; kind: "error"; message: string };
