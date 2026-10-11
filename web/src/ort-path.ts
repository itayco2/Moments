// Where the ONNX runtime loads its WebAssembly files from. The website leaves transformers.js's default (its CDN).
// The Chrome extension bundles the files and may never fall back to a CDN (the store allows no remote code), so a
// bundled path with no WebAssembly backend to give it to is an error, not a quiet default.

export interface WasmFlags {
  wasmPaths?: unknown;
}

export function useBundledRuntime(wasm: WasmFlags | undefined, base: string | null, from: string): void {
  if (!base) return;
  if (!wasm) throw new Error("the AI runtime has no WebAssembly backend to point at its bundled files");
  // A full address: the runtime resolves its files against it from inside the worker.
  wasm.wasmPaths = new URL(base, from).href;
}
