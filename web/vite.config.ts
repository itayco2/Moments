import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022" },
  // transformers.js ships its own WASM and ONNX runtime; pre-bundling it breaks the worker import.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
