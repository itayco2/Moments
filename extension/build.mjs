// Three builds into dist/, then the static files.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { assertNoRemoteCode, rewriteRuntimeCdn } from "./scripts/remote-code.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const out = fileURLToPath(new URL("./dist/", import.meta.url));
const ortDir = fileURLToPath(new URL("../web/node_modules/onnxruntime-web/dist/", import.meta.url));
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];

// The shared worker reads these (web/src/config.ts): the website's model copy and the bundled runtime.
process.env.VITE_MODEL_BASE = "https://moments-video.vercel.app/models/daa72c5/";
process.env.VITE_ORT_BASE = "/ort/";

await rm(out, { recursive: true, force: true });
const common = { configFile: false, root, logLevel: "warn" };

// 1. Extension pages and the service worker: ES modules, the model worker as its own chunk.
await build({
  ...common,
  base: "./",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  build: {
    outDir: out,
    emptyOutDir: false,
    target: "es2022",
    rolldownOptions: {
      input: { offscreen: "offscreen.html", popup: "popup.html", background: "src/background.ts" },
      output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
});

// Vite emits a second copy of the ONNX runtime from transformers.js's `new URL(...wasm)`; the worker loads /ort/ instead.
const assets = new URL("./dist/assets/", import.meta.url);
for (const f of (await readdir(assets)).filter((n) => n.endsWith(".wasm"))) await rm(new URL(f, assets));
// No remote code (Chrome Web Store): transformers.js's jsDelivr default for the runtime becomes the bundled path.
if (rewriteRuntimeCdn(out, process.env.VITE_ORT_BASE) === 0) console.warn("build: no ONNX runtime CDN default found to rewrite");

// 2 and 3. Content scripts must be classic scripts: one self-contained IIFE each.
for (const [name, entry] of [["content", "src/content/main.ts"], ["page-reader", "src/page-reader.ts"]]) {
  if (!(await import("node:fs")).existsSync(fileURLToPath(new URL(entry, import.meta.url)))) continue;
  await build({
    ...common,
    build: {
      outDir: out,
      emptyOutDir: false,
      target: "es2022",
      lib: { entry, formats: ["iife"], name: `moments_${name.replace("-", "_")}`, fileName: () => `${name}.js` },
    },
  });
}

await cp(new URL("./manifest.json", import.meta.url), new URL("./dist/manifest.json", import.meta.url));
await cp(new URL("./icons/", import.meta.url), new URL("./dist/icons/", import.meta.url), { recursive: true });
await mkdir(new URL("./dist/ort/", import.meta.url), { recursive: true });
for (const f of ORT_FILES) await cp(`${ortDir}${f}`, fileURLToPath(new URL(`./dist/ort/${f}`, import.meta.url)));
assertNoRemoteCode(out);
console.log("built extension/dist");
