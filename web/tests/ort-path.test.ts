import { describe, expect, it } from "vitest";
import { useBundledRuntime, type WasmFlags } from "../src/ort-path";

const WORKER = "chrome-extension://abcdefghijklmnop/assets/worker-x.js";

describe("useBundledRuntime", () => {
  it("leaves the runtime's default alone when there is no bundled copy (the website)", () => {
    const wasm: WasmFlags = {};
    useBundledRuntime(wasm, null, WORKER);
    expect(wasm).toEqual({});
    expect(() => useBundledRuntime(undefined, null, WORKER)).not.toThrow();
  });

  it("points the runtime at the bundled files with a full address (the extension)", () => {
    const wasm: WasmFlags = { wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/" };
    useBundledRuntime(wasm, "/ort/", WORKER);
    expect(wasm.wasmPaths).toBe("chrome-extension://abcdefghijklmnop/ort/");
  });

  it("fails instead of quietly using the CDN when the WebAssembly backend is missing", () => {
    expect(() => useBundledRuntime(undefined, "/ort/", WORKER)).toThrow(/no WebAssembly backend/);
  });
});
