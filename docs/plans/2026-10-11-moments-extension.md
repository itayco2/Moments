# Moments for YouTube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that lets a viewer type what they want to see on any YouTube video and jump to that second, with the model running on their own computer.

**Architecture:** A content script draws a search bar under the YouTube player; a script in YouTube's own page world reads the video's id, length and preview-frame spec. One offscreen document (the "engine") loads EmbeddingGemma 2 once for the whole browser through the website's `web/src` code, reads each video from YouTube's preview sheets, ingests full-detail frames that the content script grabs from the viewer's own player on the first search, stores per-video vectors in IndexedDB under a 200 MB cap, and answers searches. The background service worker only wakes the engine, routes the keyboard command and unloads the engine when no YouTube tab is open.

**Tech Stack:** TypeScript 7.0.2, Vite 8.3.4 (Rolldown), Vitest 5.0.3, Playwright 1.63.0 with its bundled Chromium, Chrome Manifest V3 (offscreen documents, `world: "MAIN"` content scripts), transformers.js 4.3.1 with the bundled ONNX runtime, IndexedDB, fflate 0.7.5.

**Spec:** `docs/specs/2026-10-11-moments-extension-design.md` (approved 2026-10-11).

## Global Constraints

- YouTube only: content scripts match `https://www.youtube.com/*`; the bar acts on `/watch` pages.
- Model: `onnx-community/embeddinggemma-2-ONNX` at revision `daa72c51243991dfcaf9f9137d2c573d8f7790c0` (from `web/src/model.json`), text `q4`, pictures `q8`. Weights load from `https://moments-video.vercel.app/models/daa72c5/`, Hugging Face at the same revision as fallback.
- No remote code: the ONNX runtime files `ort-wasm-simd-threaded.asyncify.mjs` and `.wasm` are copied into `dist/ort/`. Only model weights are downloaded.
- Extension page CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
- Permissions exactly: `offscreen`, `storage`, `alarms`; hosts `https://www.youtube.com/*`, `https://i.ytimg.com/*`, `https://moments-video.vercel.app/*`, `https://huggingface.co/*`, `https://*.hf.co/*`.
- Saved vectors: 768 numbers per moment in fp16; total cap 200 MB (`200_000_000` bytes), least recently opened videos dropped first.
- Full-detail read: frame times from `frameEvery(duration)` (`web/src/config.ts`), frames drawn at 360 px on the short side (`scaledSize` in `web/src/frames.ts`), sent as JPEG at quality 0.9.
- Keyboard: Alt+M focuses the bar.
- Pinned dev dependencies: `vite@8.3.4`, `typescript@7.0.2`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `@types/chrome@0.3.0`, `fflate@0.7.5`.
- User-facing text uses plain keyboard punctuation: no em or en dashes, no ellipsis character, straight quotes.
- Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`). Every defect found gets a row in `PREFLIGHT.md`.
- Accuracy gate (acceptance): after the full-detail read, the right moment in the top 5 for at least 18 of 20 pre-registered searches, first for at least 14 of 20.

---

## File Structure

```
web/src/config.ts               MODIFY  MODEL_BASE and ORT_BASE from the build environment
web/src/worker.ts               MODIFY  use MODEL_BASE / ORT_BASE
web/tests/config-env.test.ts    CREATE
extension/
  package.json, tsconfig.json, vite.config.ts (Vitest), playwright.config.ts, .gitignore
  build.mjs                     three Vite builds + manifest, icons and ONNX runtime copy
  manifest.json
  offscreen.html, popup.html    extension pages (Vite inputs)
  icons/16.png 32.png 48.png 128.png   rendered by scripts/icons.mjs
  src/
    storyboard.ts               pure: preview spec to sheets, frame times, crop boxes
    video-info.ts               pure: YouTube player response to VideoInfo
    protocol.ts                 message types and validators (page and engine)
    fp16.ts                     Float32 to fp16
    store-policy.ts             pure: 200 MB cap, eviction order
    settings.ts                 chrome.storage settings
    page-reader.ts              MAIN world: posts VideoInfo on load and in-page navigation
    background.ts               engine lifecycle, keyboard command, idle unload
    engine/
      offscreen.ts              the engine: ports, model, queue, messages
      sheets.ts                 preview sheets and JPEG frames to ImageData
      library.ts                per-video vectors in memory, merge, search
      store.ts                  IndexedDB persistence with eviction
    content/
      main.ts                   wiring: page messages, engine link, bar, full read
      bar.ts, bar-state.ts      the bar (Shadow DOM) and its pure state
      styles.ts                 CSS strings for bar and overlay
      marks.ts                  marks on YouTube's progress bar
      engine-link.ts            port to the engine, reconnects
      full-read.ts              full-detail read through the viewer's player
      overlay.ts                the overlay shown while reading in full detail
    popup/popup.ts              settings and status
  tests/                        Vitest unit tests (+ fixtures/)
  e2e/                          Playwright with the unpacked extension
  acceptance/                   pre-registered queries, results, acceptance test
  scripts/                      icons, contact sheets, package, screenshots
  store/                        listing text and screenshots for the Chrome Web Store
web/privacy.html                CREATE  privacy page served by the website
```

---

### Task 1: The model and runtime locations come from the build

The website keeps working exactly as now; the extension will point the shared worker at the website's model copy and at its own bundled runtime.

**Files:**
- Modify: `web/src/config.ts` (after the `modelPath` line)
- Modify: `web/src/worker.ts` (imports and the `if (SELF_HOSTED_MODEL)` block)
- Test: `web/tests/config-env.test.ts`

**Interfaces:**
- Produces: `MODEL_BASE: string | null` and `ORT_BASE: string | null` exported from `web/src/config.ts`. Env vars `VITE_MODEL_BASE` (absolute URL ending in `/`) and `VITE_ORT_BASE` (path ending in `/`).

- [ ] **Step 1: Write the failing test**

```ts
// web/tests/config-env.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("where the worker loads the model and its runtime from", () => {
  it("uses Hugging Face and the runtime's CDN by default", async () => {
    const config = await import("../src/config");
    expect(config.MODEL_BASE).toBeNull();
    expect(config.ORT_BASE).toBeNull();
  });

  it("uses the site's own copy when the site is built self-hosted", async () => {
    vi.stubEnv("VITE_SELF_HOSTED_MODEL", "1");
    const config = await import("../src/config");
    expect(config.MODEL_BASE).toBe(`/models/${config.MODEL_REVISION.slice(0, 7)}/`);
  });

  it("lets the extension point at the website's copy and its own bundled runtime", async () => {
    vi.stubEnv("VITE_MODEL_BASE", "https://moments-video.vercel.app/models/daa72c5/");
    vi.stubEnv("VITE_ORT_BASE", "/ort/");
    const config = await import("../src/config");
    expect(config.MODEL_BASE).toBe("https://moments-video.vercel.app/models/daa72c5/");
    expect(config.ORT_BASE).toBe("/ort/");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd web && npx vitest run tests/config-env.test.ts`
Expected: FAIL, `MODEL_BASE` is `undefined`.

- [ ] **Step 3: Add the two settings to `web/src/config.ts`**

Insert right after the line `export const modelPath = (base: string) => ...;`:

```ts
// Where the worker loads model files from. The website serves its own copy (SELF_HOSTED_MODEL); the extension
// points at the website's copy (VITE_MODEL_BASE). Hugging Face at the same revision is the fallback either way.
// null means Hugging Face only.
export const MODEL_BASE: string | null =
  import.meta.env.VITE_MODEL_BASE || (SELF_HOSTED_MODEL ? modelPath(import.meta.env.BASE_URL) : null);
// The ONNX runtime's own files. The extension bundles them (the Chrome Web Store allows no remote code); the
// website lets transformers.js fetch them from its CDN. null means the CDN.
export const ORT_BASE: string | null = import.meta.env.VITE_ORT_BASE || null;
```

- [ ] **Step 4: Use them in `web/src/worker.ts`**

In the import list from `"./config"`, replace `modelPath,` with `MODEL_BASE,`, replace `SELF_HOSTED_MODEL,` with `ORT_BASE,`. Then replace the block

```ts
if (SELF_HOSTED_MODEL) {
  env.allowLocalModels = true;
  env.localModelPath = modelPath(import.meta.env.BASE_URL);
}
```

with

```ts
if (MODEL_BASE) {
  env.allowLocalModels = true;
  env.localModelPath = MODEL_BASE;
}
if (ORT_BASE && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = new URL(ORT_BASE, self.location.href).href;
```

and update the comment above it to: `// The model comes from MODEL_BASE when set (the site's or the website's copy); a file missing there falls back to Hugging Face at the same revision. The runtime comes from ORT_BASE when set.`

- [ ] **Step 5: Run all web checks**

Run: `cd web && npx tsc --noEmit && npx vitest run && npx playwright test e2e/demo.spec.ts`
Expected: type check clean; all unit tests pass (73 = 70 + 3 new); 5 browser tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/config.ts web/src/worker.ts web/tests/config-env.test.ts
git commit -m "refactor(web): model and runtime locations come from the build"
```

---

### Task 2: Extension skeleton and the engine page (WebGPU gate)

Proves the riskiest assumption first: an offscreen document loads the model on WebGPU, from the website's copy, with the bundled runtime and no CDN.

**Files:**
- Create: `extension/package.json`, `extension/tsconfig.json`, `extension/vite.config.ts`, `extension/playwright.config.ts`, `extension/.gitignore`, `extension/build.mjs`, `extension/manifest.json`, `extension/offscreen.html`, `extension/popup.html`, `extension/src/background.ts`, `extension/src/engine/offscreen.ts`, `extension/src/popup/popup.ts`, `extension/scripts/icons.mjs`, `extension/e2e/helpers.ts`, `extension/e2e/engine.spec.ts`
- Modify: `.github/workflows/tests.yml` (new `extension` job)

**Interfaces:**
- Produces: `launchExtension(): Promise<{ context: BrowserContext; extensionId: string }>` in `extension/e2e/helpers.ts`; runtime message `{ type: "engine:ensure" }` answered by the background with `{ ok: true }` or `{ ok: false, message }`; runtime message `{ type: "stats", load?: boolean }` answered by the engine with `{ phase, device, message, videos, bytes }` (videos and bytes are 0 until Task 7).

- [ ] **Step 1: Package and config files**

```json
// extension/package.json
{
  "name": "moments-extension",
  "private": true,
  "version": "1.0.0",
  "description": "Moments for YouTube: type what you want to see and jump to that second.",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "build": "tsc --noEmit && node build.mjs",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@types/chrome": "0.3.0",
    "fflate": "0.7.5",
    "typescript": "7.0.2",
    "vite": "8.3.4",
    "vitest": "5.0.3"
  }
}
```

```json
// extension/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "chrome"]
  },
  "include": ["src", "tests", "e2e", "acceptance"]
}
```

```ts
// extension/vite.config.ts (unit tests only; the extension itself is built by build.mjs)
import { defineConfig } from "vite";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

```ts
// extension/playwright.config.ts
import { defineConfig } from "@playwright/test";

// The unpacked extension runs in Playwright's own Chromium: branded Chrome no longer loads unpacked extensions
// from the command line. YouTube serves VP9 or AV1 there, which Chromium plays.
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  retries: 0,
  workers: 1,
});
```

```gitignore
# extension/.gitignore
node_modules/
dist/
.pw-profile/
test-results/
playwright-report/
*.zip
```

- [ ] **Step 2: Install**

Run: `cd extension && npm install && npx playwright install chromium`
Expected: `package-lock.json` created; Playwright downloads Chromium build 1243 (about 150 MB).

- [ ] **Step 3: Icons**

```js
// extension/scripts/icons.mjs: renders the site's logo at the sizes Chrome asks for.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#16161A"/><path d="M6.5 18.5h15" stroke="#F7F6F3" stroke-width="2" stroke-linecap="round"/><rect x="15" y="8.5" width="3.2" height="13" rx="1.6" fill="#9D92FA"/></svg>`;
mkdirSync("icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${SVG.replace("<svg ", `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: `icons/${size}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log("icons written");
```

Run: `cd extension && node scripts/icons.mjs`
Expected: `icons written`; four PNG files in `extension/icons/`.

- [ ] **Step 4: Manifest and pages**

```json
// extension/manifest.json
{
  "manifest_version": 3,
  "name": "Moments: search YouTube by what you see",
  "short_name": "Moments",
  "version": "1.0.0",
  "description": "Type what you want to see and jump to that second of any YouTube video. The AI runs on your computer.",
  "minimum_chrome_version": "124",
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
  "action": { "default_popup": "popup.html", "default_icon": { "16": "icons/16.png", "32": "icons/32.png" } },
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["offscreen", "storage", "alarms"],
  "host_permissions": [
    "https://www.youtube.com/*",
    "https://i.ytimg.com/*",
    "https://moments-video.vercel.app/*",
    "https://huggingface.co/*",
    "https://*.hf.co/*"
  ],
  "content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }
}
```

```html
<!-- extension/offscreen.html -->
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Moments engine</title></head>
<body><script type="module" src="/src/engine/offscreen.ts"></script></body>
</html>
```

```html
<!-- extension/popup.html (filled in by Task 10) -->
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Moments</title></head>
<body><main id="app">Moments</main><script type="module" src="/src/popup/popup.ts"></script></body>
</html>
```

- [ ] **Step 5: Background, minimal engine, minimal popup**

```ts
// extension/src/background.ts
// Wakes the engine (one offscreen document for the whole browser) and passes nothing else. Stateless.

const ENGINE_URL = "offscreen.html";
let creating: Promise<void> | null = null;

async function engineExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

export async function ensureEngine(): Promise<void> {
  if (await engineExists()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: ENGINE_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the Moments search model once for all YouTube tabs.",
    })
    .finally(() => (creating = null));
  await creating;
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== "engine:ensure") return false;
  ensureEngine().then(
    () => reply({ ok: true }),
    (err: unknown) => reply({ ok: false, message: String(err) }),
  );
  return true;
});
```

```ts
// extension/src/engine/offscreen.ts (replaced by the full engine in Task 7)
import { Embedder } from "../../../web/src/embedder";

type Phase = "idle" | "loading" | "ready" | "error";
let embedder: Embedder | null = null;
let phase: Phase = "idle";
let message = "";
let loading: Promise<void> | null = null;

function ensureModel(): Promise<void> {
  loading ??= (async () => {
    embedder ??= new Embedder();
    phase = "loading";
    await embedder.load(true);
    phase = "ready";
  })().catch((err: unknown) => {
    phase = "error";
    message = String(err);
    loading = null;
  });
  return loading;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "stats") return false;
  const answer = () => reply({ phase, device: embedder?.device ?? null, message, videos: 0, bytes: 0 });
  if (msg.load) void ensureModel().then(answer);
  else answer();
  return true;
});
```

```ts
// extension/src/popup/popup.ts (replaced in Task 10)
const app = document.getElementById("app");
chrome.runtime
  .sendMessage({ type: "engine:ensure" })
  .then(() => chrome.runtime.sendMessage({ type: "stats" }))
  .then((s: { phase: string }) => {
    if (app) app.textContent = `Moments model: ${s.phase}`;
  })
  .catch((err: unknown) => {
    if (app) app.textContent = `Moments could not start: ${String(err)}`;
  });
```

- [ ] **Step 6: Build script**

```js
// extension/build.mjs: three builds into dist/, then the static files.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

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
console.log("built extension/dist");
```

Run: `cd extension && npm run build`
Expected: `built extension/dist`; `dist/` has `manifest.json`, `background.js`, `offscreen.html`, `popup.html`, `assets/`, `icons/`, `ort/` with both runtime files. If Vite reports an unknown option `rolldownOptions`, rename it to `rollupOptions` (the deprecated alias) and record that in PREFLIGHT.

- [ ] **Step 7: The e2e helper and the gate test**

```ts
// extension/e2e/helpers.ts
import { chromium, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
// A fixed profile keeps the 402 MB model cached between test runs.
const PROFILE = fileURLToPath(new URL("../.pw-profile", import.meta.url));

export async function launchExtension(extraArgs: string[] = []): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--autoplay-policy=no-user-gesture-required", ...extraArgs],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, extensionId: new URL(worker.url()).host };
}

// Any request to the runtime's CDN fails to resolve: the model can only load if the runtime is bundled.
export const NO_CDN = ["--host-resolver-rules=MAP cdn.jsdelivr.net 0.0.0.0"];
```

```ts
// extension/e2e/engine.spec.ts
import { expect, test } from "@playwright/test";
import { launchExtension, NO_CDN } from "./helpers";

test("the engine page loads the model once, on the GPU, with the bundled runtime", async () => {
  const { context, extensionId } = await launchExtension(NO_CDN);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const stats = await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: "engine:ensure" });
    return chrome.runtime.sendMessage({ type: "stats", load: true });
  });
  expect(stats).toMatchObject({ phase: "ready", device: "webgpu" });
  await context.close();
});
```

- [ ] **Step 8: Run the gate**

Run: `cd extension && npx playwright test e2e/engine.spec.ts`
Expected: PASS (first run downloads 402 MB; later runs use `.pw-profile`).
If `device` is `"wasm"`: WebGPU is not available in offscreen documents on this Chrome. STOP and report to Itay with the measured result; the fallback design is the engine in a hidden extension iframe inside the YouTube tab (one model per tab), which needs his decision.
If `phase` is `"error"` with a fetch failure for `ort-wasm`: the runtime file name differs; list `self.performance.getEntriesByType("resource")` in the worker to find the requested file, add it to `ORT_FILES`, rebuild.

- [ ] **Step 9: CI job**

Add to `.github/workflows/tests.yml`, after the `web` job, using the same pinned action SHAs as the `web` job:

```yaml
  extension:
    name: extension (types, unit tests)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - run: npm ci
        working-directory: web
      - run: npm ci
        working-directory: extension
      - run: npx tsc --noEmit && npx vitest run
        working-directory: extension
```

- [ ] **Step 10: Commit**

```bash
git add extension .github/workflows/tests.yml
git commit -m "feat(extension): skeleton and engine page, model on WebGPU with the bundled runtime"
```

---

### Task 3: Root cause of the automated-Chrome crash on the website

The live website's first visit crashed the page ("Target crashed") in automated Chrome twice on 2026-10-11 after PF24, with WebGPU available and no cache error. The engine runs the same model code, so this is found before the engine grows. Use superpowers:systematic-debugging.

**Files:**
- Create: `web/scripts/first-visit.mjs` (a reusable first-visit check)
- Modify: whatever the evidence points to; `PREFLIGHT.md` (new row)

- [ ] **Step 1: The check script**

```js
// web/scripts/first-visit.mjs: a fresh browser opens the site, opens Your videos, drops a clip during the
// download, waits for "indexed" and runs one search. Exit code 0 only if it finished without a crash.
//   node scripts/first-visit.mjs <site> <clip> [--headed] [--chromium] [--no-drop]
import { chromium } from "@playwright/test";

const [site, clip] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (f) => process.argv.includes(f);
const browser = await chromium.launch({
  channel: flag("--chromium") ? "chromium" : "chrome",
  headless: !flag("--headed"),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext()).newPage();
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
let crashed = false;
page.on("crash", () => {
  crashed = true;
  console.log(at(), "PAGE CRASH");
});
page.on("worker", (w) => w.on("console", (m) => console.log(at(), "worker", m.type(), m.text().slice(0, 200))));
page.on("requestfailed", (r) => console.log(at(), "FAILED", r.url().slice(-60), r.failure()?.errorText));
await page.goto(site);
await page.locator("#stats").filter({ hasText: "NASA" }).waitFor();
await page.locator("#tabOwn").click();
if (!flag("--no-drop")) await page.locator("#files").setInputFiles(clip);
let status = "";
while (!crashed && Date.now() - t0 < 240_000) {
  status = await page.locator(flag("--no-drop") ? "#model" : "#ownStatus").textContent().catch(() => "(gone)");
  if (/indexed\. Type|ready|Could not|could not/.test(status)) break;
  await page.waitForTimeout(1000);
}
console.log(at(), crashed ? "RESULT crash" : `RESULT ${status}`);
await browser.close().catch(() => {});
process.exit(crashed || !/indexed\. Type|ready/.test(status) ? 1 : 0);
```

- [ ] **Step 2: Reproduce with browser logs**

Run three times (PowerShell or Git Bash), saving output:

```bash
cd web
DEBUG=pw:browser node scripts/first-visit.mjs https://moments-video.vercel.app/ "D:/plays/Valorant/Valorant 2026.05.03 - 22.18.25.02.DVR.mp4" > ../first-visit-1.log 2>&1; echo exit $?
```

Expected: record how many of 3 runs crash. Search the logs: `grep -iE "crash|oom|out of memory|gpu process|renderer|exit_code|status" ../first-visit-*.log`.

- [ ] **Step 3: One variable at a time**

Run once each and record the result in a table in your notes: `--no-drop` (no video dropped), `--headed`, `--chromium`, and the local production build with the PF24 server (`moments-web-vercellike-immutable` from `.claude/launch.json`, URL `http://localhost:4181/`). The variable that turns crash into pass names the component to investigate.

- [ ] **Step 4: Hypothesis, failing check, fix**

Write the hypothesis in one sentence in PREFLIGHT notes ("X causes the crash because Y"). The failing check is `first-visit.mjs` exiting 1 on the live site. Make the smallest change that tests the hypothesis; rebuild (`cd web && VITE_SELF_HOSTED_MODEL=1 npm run build`), run against `http://localhost:4181/` first, then push and run against the live site.

Done when: 5 consecutive live runs exit 0, and `npx vitest run` plus `npx playwright test e2e/demo.spec.ts` still pass. If the evidence shows the crash happens only under Playwright automation and never in a normal Chrome profile (check with Itay's own Chrome on the live site), record that with the evidence and continue; the extension's e2e must then use the configuration that passes.

- [ ] **Step 5: Record and commit**

Add a PREFLIGHT row PF25 with the evidence table from Step 3, the root cause, the fix and the 5-run result.

```bash
git add web/scripts/first-visit.mjs PREFLIGHT.md web/src
git commit -m "fix(web): <the root cause in a few words> (PF25)"
```

---

### Task 4: Storyboard parsing (YouTube's preview frames)

**Files:**
- Create: `extension/src/storyboard.ts`
- Create: `extension/tests/fixtures/spec_short.json`, `spec_long.json`, `spec_lowres.json`
- Test: `extension/tests/storyboard.test.ts`

**Interfaces:**
- Produces:
  - `interface Level { index: number; width: number; height: number; count: number; cols: number; rows: number; intervalMs: number; name: string; sigh: string }`
  - `interface Storyboard { videoId: string; base: string; levels: Level[] }`
  - `interface Tile { t: number; sheet: string; x: number; y: number; width: number; height: number }`
  - `parseSpec(spec: string): Storyboard | null`, `bestLevel(sb: Storyboard): Level | null`, `sheetUrl(sb: Storyboard, level: Level, sheet: number): string`, `tiles(sb: Storyboard, level: Level, duration: number): Tile[]`

- [ ] **Step 1: Fixtures (captured from YouTube on 2026-10-11)**

```json
// extension/tests/fixtures/spec_short.json
{"videoId":"dQw4w9WgXcQ","lengthSeconds":213,"spec":"https://i.ytimg.com/sb/dQw4w9WgXcQ/storyboard3_L$L/$N.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjXxPfBBg==|48#27#100#10#10#0#default#rs$AOn4CLDgtWGAnaqZZSEHsiFathAqjUlfLQ|80#45#108#10#10#2000#M$M#rs$AOn4CLBf8GkpJjLT0oNOXNqGg2XsF5MCMg|160#90#108#5#5#2000#M$M#rs$AOn4CLClA1jTU48sHENDTij_c2ZcE493TQ|320#180#108#3#3#2000#M$M#rs$AOn4CLCHZGerbRu0IiBb-AIyubx5_-E4oQ"}
```

```json
// extension/tests/fixtures/spec_long.json
{"videoId":"-idr3GEYf1Q","lengthSeconds":2664,"spec":"https://i.ytimg.com/sb/-idr3GEYf1Q/storyboard3_L$L/$N.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgj7tPfCBg==|48#27#100#10#10#0#default#rs$AOn4CLAJdVx1287UnmQ8fDTVdEFoZaYWjQ|80#45#268#10#10#10000#M$M#rs$AOn4CLCjuiloI7CLyFl230EIgZtVtp1Zqg|160#90#268#5#5#10000#M$M#rs$AOn4CLB-HfiqfMi8osaecxvrQ3J9XtJ8-Q|320#180#268#3#3#10000#M$M#rs$AOn4CLCs3bsNBrU0LLxsI7Ebx-aQYQmudw"}
```

```json
// extension/tests/fixtures/spec_lowres.json
{"videoId":"YrM9I19GN2A","lengthSeconds":2532,"spec":"https://i.ytimg.com/sb/YrM9I19GN2A/storyboard3_L$L/$N.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjNkZTRBQ==|48#27#100#10#10#0#default#rs$AOn4CLA-kOpyW9rXRT1oW8ynlAJ6KOZ1Hw|80#45#255#10#10#10000#M$M#rs$AOn4CLA5xpId69NULvtJST82kQKpLeFH0A|160#90#255#5#5#10000#M$M#rs$AOn4CLBx1CDu1MeYtJnxEMXp9euIEEXnfg"}
```

(Store them without the comment line: each file is exactly the JSON object.)

- [ ] **Step 2: Write the failing test**

```ts
// extension/tests/storyboard.test.ts
import { describe, expect, it } from "vitest";
import { bestLevel, parseSpec, sheetUrl, tiles } from "../src/storyboard";
import long from "./fixtures/spec_long.json";
import lowres from "./fixtures/spec_lowres.json";
import short from "./fixtures/spec_short.json";

describe("parseSpec", () => {
  it("reads the video id and every level of a real spec", () => {
    const sb = parseSpec(short.spec)!;
    expect(sb.videoId).toBe("dQw4w9WgXcQ");
    expect(sb.levels.map((l) => `${l.width}x${l.height}@${l.intervalMs}`)).toEqual([
      "48x27@0",
      "80x45@2000",
      "160x90@2000",
      "320x180@2000",
    ]);
  });

  it("refuses text that is not a YouTube storyboard spec", () => {
    expect(parseSpec("")).toBeNull();
    expect(parseSpec("https://evil.example/sb/dQw4w9WgXcQ/storyboard3_L$L/$N.jpg?x|1#1#1#1#1#1#M$M#s")).toBeNull();
    expect(parseSpec(short.spec.split("|")[0])).toBeNull();
    expect(parseSpec(short.spec.replace("320#180#108", "320#abc#108"))).toBeNull();
  });
});

describe("bestLevel", () => {
  it("picks 320x180 when the video has it", () => {
    expect(bestLevel(parseSpec(long.spec)!)).toMatchObject({ index: 3, width: 320, intervalMs: 10000 });
  });

  it("falls back to 160x90 for older uploads", () => {
    expect(bestLevel(parseSpec(lowres.spec)!)).toMatchObject({ index: 2, width: 160, cols: 5, rows: 5 });
  });
});

describe("tiles", () => {
  it("gives one frame every 2 s of a short video, inside its length", () => {
    const sb = parseSpec(short.spec)!;
    const all = tiles(sb, bestLevel(sb)!, short.lengthSeconds);
    expect(all).toHaveLength(107);
    expect(all.at(-1)!.t).toBe(212);
  });

  it("cuts 3x3 sheets left to right, top to bottom", () => {
    const sb = parseSpec(short.spec)!;
    const all = tiles(sb, bestLevel(sb)!, short.lengthSeconds);
    expect(all[4]).toMatchObject({ x: 320, y: 180, width: 320, height: 180 });
    expect(all[4].sheet).toContain("storyboard3_L3/M0.jpg?");
    expect(all[9]).toMatchObject({ x: 0, y: 0 });
    expect(all[9].sheet).toContain("/M1.jpg?");
    expect(all[9].sheet).toMatch(/&sigh=rs\$AOn4CLCHZGerbRu0IiBb-AIyubx5_-E4oQ$/);
  });

  it("gives one frame every 10 s of a long video", () => {
    const sb = parseSpec(long.spec)!;
    const all = tiles(sb, bestLevel(sb)!, long.lengthSeconds);
    expect(all).toHaveLength(267);
    expect(new Set(all.map((t) => t.sheet)).size).toBe(30);
  });
});

describe("sheetUrl", () => {
  it("fills in the level and the sheet number", () => {
    const sb = parseSpec(lowres.spec)!;
    expect(sheetUrl(sb, bestLevel(sb)!, 2)).toMatch(
      /^https:\/\/i\.ytimg\.com\/sb\/YrM9I19GN2A\/storyboard3_L2\/M2\.jpg\?sqp=.+&sigh=rs\$/,
    );
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `cd extension && npx vitest run tests/storyboard.test.ts`
Expected: FAIL, cannot find module `../src/storyboard`.

- [ ] **Step 4: Implement**

```ts
// extension/src/storyboard.ts
// YouTube's preview frames ("storyboards"): the player response holds a spec string describing sprite sheets of
// small frames taken at a fixed interval. Pure functions: spec text in; sheet URLs, frame times and crop boxes out.

export interface Level {
  index: number;
  width: number;
  height: number;
  count: number;
  cols: number;
  rows: number;
  intervalMs: number;
  name: string;
  sigh: string;
}

export interface Storyboard {
  videoId: string;
  base: string;
  levels: Level[];
}

export interface Tile {
  t: number;
  sheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const BASE = /^https:\/\/i\.ytimg\.com\/sb\/([A-Za-z0-9_-]{11})\/storyboard3_L\$L\/\$N\.jpg\?/;
const MIN_WIDTH = 160; // smaller previews (48x27, 80x45) carry too little to search

export function parseSpec(spec: string): Storyboard | null {
  const [base, ...parts] = spec.split("|");
  const match = BASE.exec(base ?? "");
  if (!match || parts.length === 0) return null;
  const levels: Level[] = [];
  for (const [index, part] of parts.entries()) {
    const fields = part.split("#");
    if (fields.length < 8) return null;
    const numbers = fields.slice(0, 6).map(Number);
    if (!numbers.every((n) => Number.isInteger(n) && n >= 0)) return null;
    const [width, height, count, cols, rows, intervalMs] = numbers;
    levels.push({ index, width, height, count, cols, rows, intervalMs, name: fields[6], sigh: fields[7] });
  }
  return { videoId: match[1], base, levels };
}

export function bestLevel(sb: Storyboard): Level | null {
  const usable = sb.levels.filter((l) => l.intervalMs > 0 && l.width >= MIN_WIDTH && l.cols > 0 && l.rows > 0);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

export function sheetUrl(sb: Storyboard, level: Level, sheet: number): string {
  const name = level.name.replace("$M", String(sheet));
  return `${sb.base.replace("$L", String(level.index)).replace("$N", name)}&sigh=${level.sigh}`;
}

export function tiles(sb: Storyboard, level: Level, duration: number): Tile[] {
  const perSheet = level.cols * level.rows;
  const out: Tile[] = [];
  for (let k = 0; k < level.count; k++) {
    const t = (k * level.intervalMs) / 1000;
    if (t > duration) break;
    const cell = k % perSheet;
    out.push({
      t,
      sheet: sheetUrl(sb, level, Math.floor(k / perSheet)),
      x: (cell % level.cols) * level.width,
      y: Math.floor(cell / level.cols) * level.height,
      width: level.width,
      height: level.height,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `cd extension && npx vitest run tests/storyboard.test.ts && npx tsc --noEmit`
Expected: 8 tests pass; type check clean.

- [ ] **Step 6: Commit**

```bash
git add extension/src/storyboard.ts extension/tests
git commit -m "feat(extension): read YouTube's preview-frame spec into sheets, times and crop boxes"
```

---

### Task 5: The page reader and page-message validation

**Files:**
- Create: `extension/src/video-info.ts`, `extension/src/protocol.ts` (page half), `extension/src/page-reader.ts`
- Modify: `extension/manifest.json` (content script in the MAIN world)
- Test: `extension/tests/video-info.test.ts`, `extension/tests/protocol-page.test.ts`, `extension/e2e/page-reader.spec.ts`

**Interfaces:**
- Produces: `interface VideoInfo { videoId: string; duration: number; spec: string | null; live: boolean }` and `videoInfo(response: unknown): VideoInfo | null` (video-info.ts); `PAGE_SOURCE = "moments-page"`, `VIDEO_ID: RegExp`, `MAX_DURATION_S`, `parsePageMessage(data: unknown): VideoInfo | null` (protocol.ts). The page reader posts `{ source: "moments-page", type: "video", info: VideoInfo }` with `window.postMessage(msg, location.origin)`.

- [ ] **Step 1: Write the failing tests**

```ts
// extension/tests/video-info.test.ts
import { describe, expect, it } from "vitest";
import { videoInfo } from "../src/video-info";
import short from "./fixtures/spec_short.json";

const response = (over: Record<string, unknown> = {}, spec: unknown = short.spec) => ({
  videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213", isLive: false, ...over },
  storyboards: { playerStoryboardSpecRenderer: { spec } },
});

describe("videoInfo", () => {
  it("reads id, length and preview spec from YouTube's player response", () => {
    expect(videoInfo(response())).toEqual({ videoId: "dQw4w9WgXcQ", duration: 213, spec: short.spec, live: false });
  });

  it("drops a preview spec that belongs to another video (seen after in-page navigation)", () => {
    expect(videoInfo(response({ videoId: "aaaaaaaaaaa" }))?.spec).toBeNull();
  });

  it("marks live streams and survives a missing spec", () => {
    expect(videoInfo(response({ isLive: true }, undefined))).toMatchObject({ live: true, spec: null });
  });

  it("refuses anything without a proper video id", () => {
    expect(videoInfo(null)).toBeNull();
    expect(videoInfo({ videoDetails: { videoId: "<script>" } })).toBeNull();
  });
});
```

```ts
// extension/tests/protocol-page.test.ts
import { describe, expect, it } from "vitest";
import { PAGE_SOURCE, parsePageMessage } from "../src/protocol";
import short from "./fixtures/spec_short.json";

const good = { videoId: "dQw4w9WgXcQ", duration: 213, spec: short.spec, live: false };
const wrap = (info: unknown) => ({ source: PAGE_SOURCE, type: "video", info });

describe("parsePageMessage (the page is untrusted)", () => {
  it("accepts a well-formed message from the page reader", () => {
    expect(parsePageMessage(wrap(good))).toEqual(good);
  });

  it("refuses other senders and malformed fields", () => {
    expect(parsePageMessage({ ...wrap(good), source: "someone-else" })).toBeNull();
    expect(parsePageMessage(wrap({ ...good, videoId: "x" }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, duration: -1 }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, duration: 1e9 }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, spec: "https://evil.example/sb/dQw4w9WgXcQ/x" }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, live: "no" }))).toBeNull();
    expect(parsePageMessage("hello")).toBeNull();
  });

  it("accepts a video without previews", () => {
    expect(parsePageMessage(wrap({ ...good, spec: null }))).toMatchObject({ spec: null });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd extension && npx vitest run tests/video-info.test.ts tests/protocol-page.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// extension/src/video-info.ts
// The one place that reads YouTube's player response. Everything YouTube gives is checked before use.

export interface VideoInfo {
  videoId: string;
  duration: number;
  spec: string | null;
  live: boolean;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

interface PlayerResponse {
  videoDetails?: { videoId?: unknown; lengthSeconds?: unknown; isLive?: unknown };
  storyboards?: { playerStoryboardSpecRenderer?: { spec?: unknown } };
}

export function videoInfo(response: unknown): VideoInfo | null {
  const r = response as PlayerResponse | null;
  const d = r?.videoDetails;
  if (!d || typeof d.videoId !== "string" || !ID.test(d.videoId)) return null;
  const duration = Number(d.lengthSeconds);
  const raw = r?.storyboards?.playerStoryboardSpecRenderer?.spec;
  // After in-page navigation the spec can still describe the previous video for a moment.
  const spec = typeof raw === "string" && raw.includes(`/sb/${d.videoId}/`) ? raw : null;
  return { videoId: d.videoId, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, spec, live: d.isLive === true };
}
```

```ts
// extension/src/protocol.ts
// Every message that crosses a boundary: page to content script (untrusted) and content script to engine.
import type { VideoInfo } from "./video-info";

export type { VideoInfo };
export const PAGE_SOURCE = "moments-page";
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_DURATION_S = 48 * 3600;
const MAX_SPEC_CHARS = 4000;

export function parsePageMessage(data: unknown): VideoInfo | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { source?: unknown; type?: unknown; info?: unknown };
  if (m.source !== PAGE_SOURCE || m.type !== "video" || typeof m.info !== "object" || m.info === null) return null;
  const i = m.info as Record<string, unknown>;
  if (typeof i.videoId !== "string" || !VIDEO_ID.test(i.videoId)) return null;
  if (typeof i.duration !== "number" || !(i.duration >= 0 && i.duration <= MAX_DURATION_S)) return null;
  const spec = i.spec;
  if (spec !== null && (typeof spec !== "string" || spec.length > MAX_SPEC_CHARS || !spec.startsWith(`https://i.ytimg.com/sb/${i.videoId}/`))) {
    return null;
  }
  if (typeof i.live !== "boolean") return null;
  return { videoId: i.videoId, duration: i.duration, spec: spec as string | null, live: i.live };
}
```

```ts
// extension/src/page-reader.ts
// Runs in YouTube's own page (MAIN world) because only there is the player's API reachable. It only reads:
// video id, length and the preview spec, and posts them to the content script.
import { PAGE_SOURCE } from "./protocol";
import { videoInfo } from "./video-info";

type Player = HTMLElement & { getPlayerResponse?: () => unknown };
const TRIES = 12;
const EVERY_MS = 500;

function post(): void {
  const player = document.getElementById("movie_player") as Player | null;
  const info = videoInfo(player?.getPlayerResponse?.());
  if (info && location.pathname === "/watch") window.postMessage({ source: PAGE_SOURCE, type: "video", info }, location.origin);
}

// The player response settles a little after load and after each in-page navigation: post a few times, the
// content script ignores repeats of the same video.
function burst(): void {
  let n = 0;
  const timer = setInterval(() => {
    post();
    if (++n >= TRIES) clearInterval(timer);
  }, EVERY_MS);
}

document.addEventListener("yt-navigate-finish", burst);
burst();
```

- [ ] **Step 4: Register it**

In `extension/manifest.json` add after `"background"`:

```json
  "content_scripts": [
    { "matches": ["https://www.youtube.com/*"], "js": ["page-reader.js"], "run_at": "document_idle", "world": "MAIN" }
  ],
```

- [ ] **Step 5: The browser test**

```ts
// extension/e2e/page-reader.spec.ts
import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the page reader reports the video and follows in-page navigation", async () => {
  const { context } = await launchExtension();
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { seen: string[] }).seen = [];
    window.addEventListener("message", (e) => {
      if (e.data?.source === "moments-page") (window as unknown as { seen: string[] }).seen.push(e.data.info.videoId);
    });
  });
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect.poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen.at(-1)), { timeout: 30_000 }).toBe("dQw4w9WgXcQ");
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>("a#thumbnail[href*='/watch']")?.click());
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen.at(-1)), { timeout: 30_000 })
    .not.toBe("dQw4w9WgXcQ");
  await context.close();
});
```

- [ ] **Step 6: Run everything**

Run: `cd extension && npx vitest run && npx tsc --noEmit && npm run build && npx playwright test e2e/page-reader.spec.ts`
Expected: unit tests pass (15); build writes `dist/page-reader.js`; browser test passes.

- [ ] **Step 7: Commit**

```bash
git add extension
git commit -m "feat(extension): page reader posts the video id, length and preview spec, validated on arrival"
```

---

### Task 6: Saved vectors (fp16, 200 MB cap, IndexedDB)

**Files:**
- Create: `extension/src/fp16.ts`, `extension/src/store-policy.ts`, `extension/src/engine/store.ts`
- Test: `extension/tests/fp16.test.ts`, `extension/tests/store-policy.test.ts`

**Interfaces:**
- Produces: `toFp16(values: Float32Array): Uint16Array`; `CAP_BYTES = 200_000_000`, `interface StoredMeta { videoId: string; bytes: number; lastOpened: number }`, `entryBytes(frames: number, dim: number): number`, `evict(entries: StoredMeta[], cap?: number): string[]`; `interface SavedVideo { videoId: string; kind: "preview" | "full"; dim: number; times: Float32Array; vectors: Uint16Array }`, `loadVideo(videoId: string): Promise<SavedVideo | undefined>`, `saveVideo(v: SavedVideo): Promise<void>`, `usage(): Promise<{ videos: number; bytes: number }>`, `forgetAll(): Promise<void>`.
- Consumes: `fp16ToFloat32(bits: Uint16Array): Float32Array` from `web/src/format.ts` (tests).

- [ ] **Step 1: Write the failing tests**

```ts
// extension/tests/fp16.test.ts
import { describe, expect, it } from "vitest";
import { fp16ToFloat32 } from "../../web/src/format";
import { toFp16 } from "../src/fp16";

describe("toFp16", () => {
  it("encodes exactly representable values exactly", () => {
    expect(Array.from(toFp16(new Float32Array([0, 1, -1, 0.5, -2])))).toEqual([0x0000, 0x3c00, 0xbc00, 0x3800, 0xc000]);
  });

  it("round-trips unit-vector values within half precision", () => {
    const values = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.37) * 0.2);
    const back = fp16ToFloat32(toFp16(values));
    let worst = 0;
    for (let i = 0; i < values.length; i++) worst = Math.max(worst, Math.abs(back[i] - values[i]));
    expect(worst).toBeLessThan(1e-4);
  });

  it("keeps tiny values as subnormals instead of dropping them to zero", () => {
    const back = fp16ToFloat32(toFp16(new Float32Array([3e-6])));
    expect(back[0]).toBeGreaterThan(2.5e-6);
    expect(back[0]).toBeLessThan(3.5e-6);
  });
});
```

```ts
// extension/tests/store-policy.test.ts
import { describe, expect, it } from "vitest";
import { CAP_BYTES, entryBytes, evict } from "../src/store-policy";

describe("the 200 MB cap", () => {
  it("costs about half a megabyte for an hour of video read every 10 s", () => {
    expect(entryBytes(360, 768)).toBe(360 * (768 * 2 + 4));
    expect(entryBytes(360, 768) / 1e6).toBeCloseTo(0.55, 1);
  });

  it("drops the least recently opened videos first, only as many as needed", () => {
    const entries = [
      { videoId: "a", bytes: 60, lastOpened: 3 },
      { videoId: "b", bytes: 60, lastOpened: 1 },
      { videoId: "c", bytes: 60, lastOpened: 2 },
    ];
    expect(evict(entries, 100)).toEqual(["b", "c"]);
    expect(evict(entries, 130)).toEqual(["b"]);
    expect(evict(entries, 180)).toEqual([]);
  });

  it("is 200 MB in the units the popup shows", () => {
    expect(CAP_BYTES).toBe(200_000_000);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd extension && npx vitest run tests/fp16.test.ts tests/store-policy.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the pure parts**

```ts
// extension/src/fp16.ts
// Float32 to IEEE 754 half precision, rounding half up. Saved vectors are fp16: the NASA demo ships its vectors
// the same way and scores the same as fp32.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toFp16(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    f32[0] = values[i];
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 112; // rebias 127 to 15
    const mant = x & 0x7fffff;
    if (exp <= 0) {
      // Too small for a normal half: a subnormal, or zero when even that underflows.
      out[i] = exp < -10 ? sign : sign | ((((mant | 0x800000) >>> (1 - exp)) + 0x1000) >>> 13);
    } else if (exp >= 31) {
      out[i] = sign | 0x7c00;
    } else {
      out[i] = (sign | (exp << 10) | (mant >>> 13)) + ((mant >>> 12) & 1);
    }
  }
  return out;
}
```

```ts
// extension/src/store-policy.ts
// How much a saved video costs and which videos go when the cap is reached. Pure.
export const CAP_BYTES = 200_000_000;

export interface StoredMeta {
  videoId: string;
  bytes: number;
  lastOpened: number;
}

// fp16 vector plus a 4-byte time per moment.
export const entryBytes = (frames: number, dim: number): number => frames * (dim * 2 + 4);

export function evict(entries: StoredMeta[], cap = CAP_BYTES): string[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => a.lastOpened - b.lastOpened)) {
    if (total <= cap) break;
    out.push(e.videoId);
    total -= e.bytes;
  }
  return out;
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `cd extension && npx vitest run tests/fp16.test.ts tests/store-policy.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: IndexedDB store (exercised by the engine tests in Task 7)**

```ts
// extension/src/engine/store.ts
// Saved per-video vectors in the engine's IndexedDB. Metadata lives apart from vectors so eviction never loads
// 200 MB of vectors just to read sizes and dates.
import { CAP_BYTES, entryBytes, evict, type StoredMeta } from "../store-policy";

export interface SavedVideo {
  videoId: string;
  kind: "preview" | "full";
  dim: number;
  times: Float32Array;
  vectors: Uint16Array;
}

const DB_NAME = "moments";
const VERSION = 1;
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("meta", { keyPath: "videoId" });
      req.result.createObjectStore("vectors", { keyPath: "videoId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function loadVideo(videoId: string): Promise<SavedVideo | undefined> {
  const tx = (await db()).transaction(["meta", "vectors"], "readwrite");
  const saved = (await result(tx.objectStore("vectors").get(videoId))) as SavedVideo | undefined;
  const meta = (await result(tx.objectStore("meta").get(videoId))) as StoredMeta | undefined;
  if (meta) tx.objectStore("meta").put({ ...meta, lastOpened: Date.now() });
  await finished(tx);
  return saved;
}

export async function saveVideo(v: SavedVideo): Promise<void> {
  const tx = (await db()).transaction(["meta", "vectors"], "readwrite");
  tx.objectStore("vectors").put(v);
  tx.objectStore("meta").put({ videoId: v.videoId, bytes: entryBytes(v.times.length, v.dim), lastOpened: Date.now() });
  const all = (await result(tx.objectStore("meta").getAll())) as StoredMeta[];
  for (const id of evict(all, CAP_BYTES)) {
    tx.objectStore("meta").delete(id);
    tx.objectStore("vectors").delete(id);
  }
  await finished(tx);
}

export async function usage(): Promise<{ videos: number; bytes: number }> {
  const tx = (await db()).transaction("meta", "readonly");
  const all = (await result(tx.objectStore("meta").getAll())) as StoredMeta[];
  return { videos: all.length, bytes: all.reduce((sum, m) => sum + m.bytes, 0) };
}

export async function forgetAll(): Promise<void> {
  const tx = (await db()).transaction(["meta", "vectors"], "readwrite");
  tx.objectStore("meta").clear();
  tx.objectStore("vectors").clear();
  await finished(tx);
}
```

- [ ] **Step 6: Type check and commit**

Run: `cd extension && npx tsc --noEmit && npx vitest run`
Expected: clean; 21 tests pass.

```bash
git add extension/src/fp16.ts extension/src/store-policy.ts extension/src/engine/store.ts extension/tests
git commit -m "feat(extension): saved vectors in fp16 with a 200 MB cap, least recently opened dropped first"
```

---

### Task 7: The engine (preview read, full-detail ingestion, search)

**Files:**
- Modify: `extension/src/protocol.ts` (engine half)
- Create: `extension/src/engine/sheets.ts`, `extension/src/engine/library.ts`
- Replace: `extension/src/engine/offscreen.ts`
- Test: `extension/tests/protocol-engine.test.ts`, `extension/tests/library.test.ts`, `extension/e2e/engine-read.spec.ts`

**Interfaces:**
- Consumes: `parseSpec`, `bestLevel`, `tiles`, `Tile` (Task 4); `SavedVideo`, `loadVideo`, `saveVideo`, `usage`, `forgetAll` (Task 6); `toFp16` (Task 6); from `web/src`: `Embedder` (`load(vision)`, `embedText(text)`, `embedImages(images)`, `onProgress`, `device`), `search(rows, vectors, dim, query, k)`, `isWeakMatch(hits)`, `Row`, `fp16ToFloat32`, `IMAGES_PER_BATCH`.
- Produces (protocol.ts):
  - `interface Hit { start: number; end: number; score: number }`, `interface Frame { t: number; jpeg: string }`, `type Kind = "none" | "preview" | "full"`
  - `type ToEngine = { type: "open"; videoId: string; duration: number; spec: string | null; autoRead: boolean } | { type: "search"; id: number; videoId: string; query: string } | { type: "full-frames"; videoId: string; frames: Frame[] } | { type: "full-end"; videoId: string; complete: boolean }`
  - `type ModelMessage = { type: "model"; phase: "idle" | "loading" | "ready" | "error"; loaded: number; total: number; device: "webgpu" | "wasm" | null; message: string }`
  - `type StateMessage = { type: "state"; videoId: string; kind: Kind; reading: "preview" | null; done: number; total: number; problem: "no-previews" | "error" | null; message: string }`
  - `type ResultsMessage = { type: "results"; id: number; videoId: string; kind: Kind; hits: Hit[]; weak: boolean }`
  - `type FromEngine = ModelMessage | StateMessage | ResultsMessage`
  - `parseToEngine(msg: unknown): ToEngine | null`, constants `MAX_QUERY = 200`, `MAX_FRAMES_PER_MESSAGE = 32`, `MAX_JPEG_CHARS = 800_000`
- Produces (library.ts): `class Library { get(videoId): Promise<Entry | null>; put(videoId, kind: "preview" | "full", times: number[], vectors: Float32Array[]): Promise<Entry>; addFull(videoId, times: number[], vectors: Float32Array[]): void; finishFull(videoId, complete: boolean): Promise<Entry | null>; find(entry: Entry, query: Float32Array): { hits: Hit[]; weak: boolean }; clear(): void }`, `interface Entry { kind: "preview" | "full"; times: number[]; vectors: Float32Array; dim: number }`, `mergePartial(full: Part, preview: Part | null, dim: number): Part` where `interface Part { times: number[]; vectors: Float32Array }`.
- Port name: `"moments"`. Runtime messages answered by the engine: `{ type: "stats", load?: boolean }` and `{ type: "forget-all" }`.

- [ ] **Step 1: Write the failing tests**

```ts
// extension/tests/protocol-engine.test.ts
import { describe, expect, it } from "vitest";
import { MAX_FRAMES_PER_MESSAGE, MAX_QUERY, parseToEngine } from "../src/protocol";

const jpeg = "data:image/jpeg;base64,/9j/4AAQ";

describe("parseToEngine", () => {
  it("accepts the four message kinds", () => {
    expect(parseToEngine({ type: "open", videoId: "dQw4w9WgXcQ", duration: 213, spec: null, autoRead: true })).toMatchObject({ type: "open" });
    expect(parseToEngine({ type: "search", id: 3, videoId: "dQw4w9WgXcQ", query: "a man singing" })).toMatchObject({ type: "search", id: 3 });
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: 4, jpeg }] })).toMatchObject({ type: "full-frames" });
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: false })).toMatchObject({ complete: false });
  });

  it("refuses malformed or oversized messages", () => {
    expect(parseToEngine({ type: "search", id: 1, videoId: "dQw4w9WgXcQ", query: "x".repeat(MAX_QUERY + 1) })).toBeNull();
    expect(parseToEngine({ type: "search", id: 1, videoId: "bad", query: "a" })).toBeNull();
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: -1, jpeg }] })).toBeNull();
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: 1, jpeg: "data:text/html,hi" }] })).toBeNull();
    const many = Array.from({ length: MAX_FRAMES_PER_MESSAGE + 1 }, (_, t) => ({ t, jpeg }));
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: many })).toBeNull();
    expect(parseToEngine({ type: "open", videoId: "dQw4w9WgXcQ", duration: 213, spec: 5, autoRead: true })).toBeNull();
    expect(parseToEngine({ type: "unknown" })).toBeNull();
  });
});
```

```ts
// extension/tests/library.test.ts
import { describe, expect, it } from "vitest";
import { mergePartial } from "../src/engine/library";

const vec = (...xs: number[]) => Float32Array.from(xs);

describe("mergePartial", () => {
  it("keeps the full-detail frames and the preview frames after the last one read", () => {
    const full = { times: [0, 2, 4], vectors: vec(1, 1, 2, 2, 3, 3) };
    const preview = { times: [0, 10, 20], vectors: vec(9, 9, 8, 8, 7, 7) };
    const merged = mergePartial(full, preview, 2);
    expect(merged.times).toEqual([0, 2, 4, 10, 20]);
    expect(Array.from(merged.vectors)).toEqual([1, 1, 2, 2, 3, 3, 8, 8, 7, 7]);
  });

  it("is just the full-detail frames when there was no preview", () => {
    const full = { times: [0, 2], vectors: vec(1, 1, 2, 2) };
    expect(mergePartial(full, null, 2)).toEqual(full);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd extension && npx vitest run tests/protocol-engine.test.ts tests/library.test.ts`
Expected: FAIL, `parseToEngine` and `mergePartial` missing.

- [ ] **Step 3: Engine half of the protocol**

Append to `extension/src/protocol.ts`:

```ts
export interface Hit {
  start: number;
  end: number;
  score: number;
}
export interface Frame {
  t: number;
  jpeg: string;
}
export type Kind = "none" | "preview" | "full";

export type ToEngine =
  | { type: "open"; videoId: string; duration: number; spec: string | null; autoRead: boolean }
  | { type: "search"; id: number; videoId: string; query: string }
  | { type: "full-frames"; videoId: string; frames: Frame[] }
  | { type: "full-end"; videoId: string; complete: boolean };

export type ModelMessage = {
  type: "model";
  phase: "idle" | "loading" | "ready" | "error";
  loaded: number;
  total: number;
  device: "webgpu" | "wasm" | null;
  message: string;
};
export type StateMessage = {
  type: "state";
  videoId: string;
  kind: Kind;
  reading: "preview" | null;
  done: number;
  total: number;
  problem: "no-previews" | "error" | null;
  message: string;
};
export type ResultsMessage = { type: "results"; id: number; videoId: string; kind: Kind; hits: Hit[]; weak: boolean };
export type FromEngine = ModelMessage | StateMessage | ResultsMessage;

export const MAX_QUERY = 200;
export const MAX_FRAMES_PER_MESSAGE = 32;
export const MAX_JPEG_CHARS = 800_000;
const JPEG_PREFIX = "data:image/jpeg;base64,";

const isId = (v: unknown): v is string => typeof v === "string" && VIDEO_ID.test(v);
const isTime = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= MAX_DURATION_S;

// Content scripts are ours, but a compromised page could try to reach the engine through them: check anyway.
export function parseToEngine(msg: unknown): ToEngine | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!isId(m.videoId)) return null;
  switch (m.type) {
    case "open":
      if (!isTime(m.duration) || typeof m.autoRead !== "boolean") return null;
      if (m.spec !== null && (typeof m.spec !== "string" || !m.spec.startsWith(`https://i.ytimg.com/sb/${m.videoId}/`))) return null;
      return { type: "open", videoId: m.videoId, duration: m.duration, spec: m.spec as string | null, autoRead: m.autoRead };
    case "search":
      if (!Number.isInteger(m.id) || typeof m.query !== "string" || m.query.length === 0 || m.query.length > MAX_QUERY) return null;
      return { type: "search", id: m.id as number, videoId: m.videoId, query: m.query };
    case "full-frames": {
      if (!Array.isArray(m.frames) || m.frames.length === 0 || m.frames.length > MAX_FRAMES_PER_MESSAGE) return null;
      const frames: Frame[] = [];
      for (const f of m.frames as Record<string, unknown>[]) {
        if (!isTime(f?.t) || typeof f.jpeg !== "string" || !f.jpeg.startsWith(JPEG_PREFIX) || f.jpeg.length > MAX_JPEG_CHARS) return null;
        frames.push({ t: f.t, jpeg: f.jpeg });
      }
      return { type: "full-frames", videoId: m.videoId, frames };
    }
    case "full-end":
      if (typeof m.complete !== "boolean") return null;
      return { type: "full-end", videoId: m.videoId, complete: m.complete };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Sheets and frames to pixels**

```ts
// extension/src/engine/sheets.ts
// Turns preview sheets and full-detail JPEG frames into the ImageData the model reads.
import type { Frame } from "../protocol";
import type { Tile } from "../storyboard";

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`preview sheet answered HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

function pixels(source: CanvasImageSource, sx: number, sy: number, w: number, h: number): ImageData {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas in the engine page");
  ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Sheets come in order; each is downloaded once and cut into its tiles.
export async function* readSheets(list: Tile[], batchSize: number): AsyncGenerator<{ times: number[]; images: ImageData[] }> {
  let current = "";
  let bitmap: ImageBitmap | null = null;
  let batch = { times: [] as number[], images: [] as ImageData[] };
  try {
    for (const tile of list) {
      if (tile.sheet !== current) {
        bitmap?.close();
        bitmap = await fetchBitmap(tile.sheet);
        current = tile.sheet;
      }
      batch.times.push(tile.t);
      batch.images.push(pixels(bitmap as ImageBitmap, tile.x, tile.y, tile.width, tile.height));
      if (batch.images.length === batchSize) {
        yield batch;
        batch = { times: [], images: [] };
      }
    }
    if (batch.images.length) yield batch;
  } finally {
    bitmap?.close();
  }
}

export async function decodeFrames(frames: Frame[]): Promise<ImageData[]> {
  return Promise.all(
    frames.map(async (f) => {
      const bitmap = await createImageBitmap(await (await fetch(f.jpeg)).blob());
      try {
        return pixels(bitmap, 0, 0, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }),
  );
}
```

- [ ] **Step 5: The library**

```ts
// extension/src/engine/library.ts
// Each video's vectors in memory, saved to IndexedDB, merged after a full-detail read, and searched with the
// website's rule (web/src/search.ts, frame-counted hide window from PF21).
import { fp16ToFloat32 } from "../../../web/src/format";
import { isWeakMatch, type Row, search } from "../../../web/src/search";
import { toFp16 } from "../fp16";
import type { Hit } from "../protocol";
import { loadVideo, saveVideo } from "./store";

export interface Part {
  times: number[];
  vectors: Float32Array;
}
export interface Entry extends Part {
  kind: "preview" | "full";
  dim: number;
  rows: Row[];
}

export const DIM = 768;
const RESULTS = 6;

export function flatten(vectors: Float32Array[], dim: number): Float32Array {
  const out = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => out.set(v, i * dim));
  return out;
}

// A full-detail read runs from the start; if it stopped early, the preview covers the rest of the video.
export function mergePartial(full: Part, preview: Part | null, dim: number): Part {
  if (!preview || full.times.length === 0) return full;
  const last = full.times[full.times.length - 1];
  const keep = preview.times.map((t, i) => [t, i] as const).filter(([t]) => t > last);
  const vectors = new Float32Array((full.times.length + keep.length) * dim);
  vectors.set(full.vectors);
  keep.forEach(([, i], k) => vectors.set(preview.vectors.subarray(i * dim, (i + 1) * dim), (full.times.length + k) * dim));
  return { times: [...full.times, ...keep.map(([t]) => t)], vectors };
}

function entry(kind: Entry["kind"], part: Part, dim: number): Entry {
  return { kind, dim, ...part, rows: part.times.map((t) => ({ video: "this", start: t, end: t + 1, thumb: "" })) };
}

export class Library {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, { times: number[]; vectors: Float32Array[] }>();

  async get(videoId: string): Promise<Entry | null> {
    const cached = this.entries.get(videoId);
    if (cached) return cached;
    const saved = await loadVideo(videoId).catch((err: unknown) => {
      console.warn("Moments: could not read the saved video", videoId, err);
      return undefined;
    });
    if (!saved) return null;
    const loaded = entry(saved.kind, { times: Array.from(saved.times), vectors: fp16ToFloat32(saved.vectors) }, saved.dim);
    this.entries.set(videoId, loaded);
    return loaded;
  }

  async put(videoId: string, kind: Entry["kind"], times: number[], vectors: Float32Array[]): Promise<Entry> {
    return this.store(videoId, entry(kind, { times, vectors: flatten(vectors, DIM) }, DIM));
  }

  addFull(videoId: string, times: number[], vectors: Float32Array[]): void {
    const p = this.pending.get(videoId) ?? { times: [], vectors: [] };
    p.times.push(...times);
    p.vectors.push(...vectors);
    this.pending.set(videoId, p);
  }

  async finishFull(videoId: string, complete: boolean): Promise<Entry | null> {
    const p = this.pending.get(videoId);
    this.pending.delete(videoId);
    if (!p || p.times.length === 0) return this.get(videoId);
    const full = { times: p.times, vectors: flatten(p.vectors, DIM) };
    const before = complete ? null : await this.get(videoId);
    const part = complete ? full : mergePartial(full, before, DIM);
    return this.store(videoId, entry(complete ? "full" : (before?.kind ?? "full"), part, DIM));
  }

  find(e: Entry, query: Float32Array): { hits: Hit[]; weak: boolean } {
    const found = search(e.rows, e.vectors, e.dim, query, RESULTS);
    return { hits: found.map((h) => ({ start: h.start, end: h.end, score: h.score })), weak: isWeakMatch(found) };
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  private async store(videoId: string, e: Entry): Promise<Entry> {
    this.entries.set(videoId, e);
    await saveVideo({ videoId, kind: e.kind, dim: e.dim, times: Float32Array.from(e.times), vectors: toFp16(e.vectors) }).catch(
      (err: unknown) => console.warn("Moments: storage refused, keeping this video for the session only", videoId, err),
    );
    return e;
  }
}
```

Note: a partial full read after a preview keeps the preview's kind only when the read stopped early; the bar then still offers to finish the read on the next search.

- [ ] **Step 6: Run the unit tests**

Run: `cd extension && npx vitest run && npx tsc --noEmit`
Expected: all pass (25); clean.

- [ ] **Step 7: The engine**

```ts
// extension/src/engine/offscreen.ts
// The engine: one model for the whole browser. Talks to content scripts over "moments" ports and to the popup
// over runtime messages.
import { IMAGES_PER_BATCH } from "../../../web/src/config";
import { Embedder } from "../../../web/src/embedder";
import { type FromEngine, type ModelMessage, parseToEngine, type StateMessage, type ToEngine } from "../protocol";
import { bestLevel, parseSpec, tiles } from "../storyboard";
import { Library } from "./library";
import { decodeFrames, readSheets } from "./sheets";
import { forgetAll, usage } from "./store";

const ports = new Set<chrome.runtime.Port>();
const library = new Library();
let embedder: Embedder | null = null;
let loading: Promise<Embedder> | null = null;
let model: ModelMessage = { type: "model", phase: "idle", loaded: 0, total: 0, device: null, message: "" };
const queue: { videoId: string; duration: number; spec: string | null; port: chrome.runtime.Port }[] = [];
let reading = false;

const send = (port: chrome.runtime.Port, m: FromEngine) => {
  try {
    port.postMessage(m);
  } catch {
    ports.delete(port); // the tab went away
  }
};
const broadcast = (m: FromEngine) => ports.forEach((p) => send(p, m));
const state = (port: chrome.runtime.Port, s: Omit<StateMessage, "type">) => send(port, { type: "state", ...s });

function ensureModel(): Promise<Embedder> {
  if (embedder?.device && embedder.vision) return Promise.resolve(embedder);
  loading ??= (async () => {
    const e = (embedder ??= new Embedder());
    e.onProgress = (loaded, total) => {
      model = { ...model, phase: "loading", loaded, total };
      broadcast(model);
    };
    model = { ...model, phase: "loading" };
    broadcast(model);
    await e.load(true);
    model = { ...model, phase: "ready", device: e.device, message: "" };
    broadcast(model);
    return e;
  })().catch((err: unknown) => {
    model = { ...model, phase: "error", message: String(err) };
    broadcast(model);
    loading = null;
    throw err;
  });
  return loading;
}

async function previewRead(job: (typeof queue)[number]): Promise<void> {
  const { videoId, duration, spec, port } = job;
  const sb = spec ? parseSpec(spec) : null;
  const level = sb && sb.videoId === videoId ? bestLevel(sb) : null;
  if (!sb || !level) {
    state(port, { videoId, kind: "none", reading: null, done: 0, total: 0, problem: "no-previews", message: "" });
    return;
  }
  const list = tiles(sb, level, duration);
  const e = await ensureModel();
  const times: number[] = [];
  const vectors: Float32Array[] = [];
  for await (const batch of readSheets(list, IMAGES_PER_BATCH)) {
    vectors.push(...(await e.embedImages(batch.images)));
    times.push(...batch.times);
    state(port, { videoId, kind: "none", reading: "preview", done: times.length, total: list.length, problem: null, message: "" });
  }
  await library.put(videoId, "preview", times, vectors);
  state(port, { videoId, kind: "preview", reading: null, done: times.length, total: list.length, problem: null, message: "" });
}

// One preview read at a time; the most recently opened video goes first.
async function drain(): Promise<void> {
  if (reading) return;
  reading = true;
  try {
    for (let job = queue.pop(); job; job = queue.pop()) {
      if (!ports.has(job.port) || (await library.get(job.videoId))) continue;
      await previewRead(job).catch((err: unknown) => {
        console.warn("Moments: preview read failed", job.videoId, err);
        state(job.port, { videoId: job.videoId, kind: "none", reading: null, done: 0, total: 0, problem: "error", message: String(err) });
      });
    }
  } finally {
    reading = false;
  }
}

async function handle(port: chrome.runtime.Port, m: ToEngine): Promise<void> {
  switch (m.type) {
    case "open": {
      const known = await library.get(m.videoId);
      if (known) {
        state(port, { videoId: m.videoId, kind: known.kind, reading: null, done: known.times.length, total: known.times.length, problem: null, message: "" });
        return;
      }
      state(port, { videoId: m.videoId, kind: "none", reading: null, done: 0, total: 0, problem: m.spec ? null : "no-previews", message: "" });
      if (m.autoRead && m.spec) {
        queue.push({ videoId: m.videoId, duration: m.duration, spec: m.spec, port });
        void drain();
      }
      return;
    }
    case "search": {
      const e = await ensureModel();
      const query = await e.embedText(m.query);
      const found = await library.get(m.videoId);
      const answer = found ? library.find(found, query) : { hits: [], weak: false };
      send(port, { type: "results", id: m.id, videoId: m.videoId, kind: found?.kind ?? "none", ...answer });
      return;
    }
    case "full-frames": {
      const e = await ensureModel();
      const vectors = await e.embedImages(await decodeFrames(m.frames));
      library.addFull(m.videoId, m.frames.map((f) => f.t), vectors);
      return;
    }
    case "full-end": {
      const done = await library.finishFull(m.videoId, m.complete);
      const n = done?.times.length ?? 0;
      state(port, { videoId: m.videoId, kind: done?.kind ?? "none", reading: null, done: n, total: n, problem: null, message: "" });
      return;
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "moments") return;
  ports.add(port);
  send(port, model);
  // Messages from one tab run in order: frames must be embedded before the read is finished.
  let chain = Promise.resolve();
  port.onMessage.addListener((raw: unknown) => {
    const m = parseToEngine(raw);
    if (!m) {
      console.warn("Moments: ignored a malformed message");
      return;
    }
    chain = chain.then(() =>
      handle(port, m).catch((err: unknown) => {
        console.warn("Moments: engine error", err);
        if ("videoId" in m) state(port, { videoId: m.videoId, kind: "none", reading: null, done: 0, total: 0, problem: "error", message: String(err) });
      }),
    );
  });
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "stats") {
    const answer = async () =>
      reply({ phase: model.phase, device: model.device, message: model.message, ...(await usage().catch(() => ({ videos: 0, bytes: 0 }))) });
    (msg.load ? ensureModel().then(() => undefined, () => undefined) : Promise.resolve()).then(answer);
    return true;
  }
  if (msg?.type === "forget-all") {
    library.clear();
    forgetAll().then(
      () => reply({ ok: true }),
      (err: unknown) => reply({ ok: false, message: String(err) }),
    );
    return true;
  }
  return false;
});
```

- [ ] **Step 8: Browser test through a port**

```ts
// extension/e2e/engine-read.spec.ts
import { expect, test } from "@playwright/test";
import short from "../tests/fixtures/spec_short.json";
import { launchExtension } from "./helpers";

test("the engine reads a video from its previews, saves it and answers a search", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const outcome = await page.evaluate(async (fixture) => {
    await chrome.runtime.sendMessage({ type: "forget-all" }).catch(() => undefined);
    await chrome.runtime.sendMessage({ type: "engine:ensure" });
    const port = chrome.runtime.connect({ name: "moments" });
    const seen: { type: string; kind?: string; hits?: unknown[] }[] = [];
    const next = (pred: (m: { type: string; kind?: string; hits?: unknown[] }) => boolean) =>
      new Promise<{ type: string; kind?: string; hits?: { start: number }[] }>((resolve) => {
        port.onMessage.addListener(function on(m) {
          seen.push(m);
          if (pred(m)) {
            port.onMessage.removeListener(on);
            resolve(m);
          }
        });
      });
    const t0 = performance.now();
    port.postMessage({ type: "open", videoId: fixture.videoId, duration: fixture.lengthSeconds, spec: fixture.spec, autoRead: true });
    await next((m) => m.type === "state" && m.kind === "preview");
    const readSeconds = (performance.now() - t0) / 1000;
    port.postMessage({ type: "search", id: 1, videoId: fixture.videoId, query: "a man singing into a microphone" });
    const results = await next((m) => m.type === "results");
    const stats = await chrome.runtime.sendMessage({ type: "stats" });
    return { readSeconds, hits: results.hits ?? [], stats };
  }, short);
  expect(outcome.hits.length).toBeGreaterThan(0);
  expect(outcome.hits[0].start).toBeLessThanOrEqual(213);
  expect(outcome.stats.videos).toBe(1);
  console.log(`preview read of a 3.5-minute video: ${outcome.readSeconds.toFixed(1)} s`);
  await context.close();
});
```

Run: `cd extension && npm run build && npx playwright test e2e/engine-read.spec.ts`
Expected: PASS; the printed preview read time is under 10 s once the model is cached.

- [ ] **Step 9: Commit**

```bash
git add extension
git commit -m "feat(extension): engine reads previews, ingests full-detail frames, saves and searches"
```

---

### Task 8: The search bar (preview search end to end)

**Files:**
- Create: `extension/src/content/bar-state.ts`, `extension/src/content/styles.ts`, `extension/src/content/bar.ts`, `extension/src/content/marks.ts`, `extension/src/content/engine-link.ts`, `extension/src/content/main.ts`, `extension/src/settings.ts`
- Modify: `extension/manifest.json` (isolated content script)
- Test: `extension/tests/bar-state.test.ts`, `extension/e2e/bar.spec.ts`

**Interfaces:**
- Consumes: protocol types (Task 7), `parsePageMessage` (Task 5), `downloadStatus` (`web/src/progress.ts`), `clock` (`web/src/format.ts`).
- Produces:
  - `bar-state.ts`: `interface Progress { done: number; total: number }`, `interface BarState { model: { phase: ModelMessage["phase"]; loaded: number; total: number; message: string }; videoId: string | null; kind: Kind; preview: Progress | null; full: Progress | null; problem: StateMessage["problem"]; message: string; waitingForAd: boolean; query: string; searching: boolean; hits: Hit[]; current: number; weak: boolean }`, `initialState`, `type Action`, `reduce(s, a): BarState`, `statusLine(s, elapsedS, duration): string`, `countText(s): string`.
  - `settings.ts`: `DEFAULT_BACKGROUND_READING`, `interface Settings { backgroundReading: boolean }`, `readSettings(): Promise<Settings>`, `writeSettings(s: Settings): Promise<void>`.
  - `bar.ts`: `interface BarHandlers { onSearch(query: string): void; onStep(by: 1 | -1): void; onClear(): void; onSkip(): void }`, `class Bar { host: HTMLElement; mount(): void; focus(): void; render(s: BarState, status: string): void }`. The host element carries test hooks `data-kind`, `data-status`, `data-hits` (JSON array of start seconds) and `data-current`.
  - `marks.ts`: `drawMarks(hits: Hit[], current: number, duration: number): void`, `clearMarks(): void`.
  - `engine-link.ts`: `class EngineLink { onMessage(fn: (m: FromEngine) => void): void; onConnect(fn: () => void): void; send(m: ToEngine): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

```ts
// extension/tests/bar-state.test.ts
import { describe, expect, it } from "vitest";
import { countText, initialState, reduce, statusLine } from "../src/content/bar-state";

const hits = [
  { start: 10, end: 11, score: 0.8 },
  { start: 50, end: 51, score: 0.78 },
  { start: 90, end: 91, score: 0.77 },
];

describe("reduce", () => {
  it("starts clean on a new video but keeps the model's state", () => {
    let s = reduce(initialState, { type: "model", phase: "ready", loaded: 1, total: 1, message: "" });
    s = reduce(s, { type: "searching", query: "a goal" });
    s = reduce(s, { type: "video", videoId: "dQw4w9WgXcQ" });
    expect(s).toMatchObject({ videoId: "dQw4w9WgXcQ", query: "", hits: [], model: { phase: "ready" } });
  });

  it("ignores results for a query the viewer has already replaced", () => {
    let s = reduce(initialState, { type: "searching", query: "a goal" });
    s = reduce(s, { type: "searching", query: "a save" });
    s = reduce(s, { type: "results", query: "a goal", hits, weak: false });
    expect(s.hits).toEqual([]);
    s = reduce(s, { type: "results", query: "a save", hits, weak: false });
    expect(s).toMatchObject({ hits, current: 0, searching: false });
  });

  it("steps through matches like Ctrl+F, wrapping at both ends", () => {
    let s = reduce(reduce(initialState, { type: "searching", query: "q" }), { type: "results", query: "q", hits, weak: false });
    s = reduce(s, { type: "step", by: -1 });
    expect(s.current).toBe(2);
    s = reduce(s, { type: "step", by: 1 });
    expect(countText(s)).toBe("1 of 3");
  });
});

describe("statusLine", () => {
  it("shows the one-time download with speed and time left", () => {
    const s = reduce(initialState, { type: "model", phase: "loading", loaded: 100e6, total: 402e6, message: "" });
    expect(statusLine(s, 10, 213)).toBe("Downloading the AI model to this browser, once: 100 of 402 MB, 10.0 MB/s, about 35 s left");
  });

  it("names a full-detail read in video time, with the way out", () => {
    const s = reduce(initialState, { type: "full", progress: { done: 50, total: 100 } });
    expect(statusLine(s, 0, 600)).toBe("Reading in full detail: 5:00 of 10:00. Esc stops.");
  });

  it("is honest about weak matches and missing previews", () => {
    let s = reduce(reduce(initialState, { type: "searching", query: "q" }), { type: "results", query: "q", hits, weak: true });
    expect(statusLine(s, 0, 100)).toBe("No clear match. Closest moments:");
    s = reduce(initialState, { type: "engine", kind: "none", preview: null, problem: "no-previews", message: "" });
    expect(statusLine(s, 0, 100)).toBe("No preview frames for this video. Search reads it in full detail.");
  });

  it("asks the viewer to wait for an ad", () => {
    expect(statusLine(reduce(initialState, { type: "ad", waiting: true }), 0, 100)).toBe("Jumps after the ad.");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd extension && npx vitest run tests/bar-state.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: State, settings, styles**

```ts
// extension/src/content/bar-state.ts
// Everything the bar shows, as pure state. The DOM code only renders it.
import { clock } from "../../../web/src/format";
import { downloadStatus } from "../../../web/src/progress";
import type { Hit, Kind, ModelMessage, StateMessage } from "../protocol";

export interface Progress {
  done: number;
  total: number;
}

export interface BarState {
  model: { phase: ModelMessage["phase"]; loaded: number; total: number; message: string };
  videoId: string | null;
  kind: Kind;
  preview: Progress | null;
  full: Progress | null;
  problem: StateMessage["problem"];
  message: string;
  waitingForAd: boolean;
  query: string;
  searching: boolean;
  hits: Hit[];
  current: number;
  weak: boolean;
}

export const initialState: BarState = {
  model: { phase: "idle", loaded: 0, total: 0, message: "" },
  videoId: null,
  kind: "none",
  preview: null,
  full: null,
  problem: null,
  message: "",
  waitingForAd: false,
  query: "",
  searching: false,
  hits: [],
  current: -1,
  weak: false,
};

export type Action =
  | { type: "model"; phase: ModelMessage["phase"]; loaded: number; total: number; message: string }
  | { type: "video"; videoId: string }
  | { type: "engine"; kind: Kind; preview: Progress | null; problem: StateMessage["problem"]; message: string }
  | { type: "full"; progress: Progress | null }
  | { type: "ad"; waiting: boolean }
  | { type: "searching"; query: string }
  | { type: "results"; query: string; hits: Hit[]; weak: boolean }
  | { type: "step"; by: 1 | -1 }
  | { type: "clear" };

export function reduce(s: BarState, a: Action): BarState {
  switch (a.type) {
    case "model":
      return { ...s, model: { phase: a.phase, loaded: a.loaded, total: a.total, message: a.message } };
    case "video":
      return { ...initialState, model: s.model, videoId: a.videoId };
    case "engine":
      return { ...s, kind: a.kind, preview: a.preview, problem: a.problem, message: a.message };
    case "full":
      return { ...s, full: a.progress };
    case "ad":
      return { ...s, waitingForAd: a.waiting };
    case "searching":
      return { ...s, query: a.query, searching: true };
    case "results":
      if (a.query !== s.query) return s;
      return { ...s, searching: false, hits: a.hits, current: a.hits.length ? 0 : -1, weak: a.weak };
    case "step":
      return s.hits.length ? { ...s, current: (s.current + a.by + s.hits.length) % s.hits.length } : s;
    case "clear":
      return { ...s, query: "", searching: false, hits: [], current: -1, weak: false };
  }
}

export const countText = (s: BarState): string => (s.hits.length ? `${s.current + 1} of ${s.hits.length}` : "");

export function statusLine(s: BarState, elapsedS: number, duration: number): string {
  if (s.model.phase === "error") return `The AI model could not load: ${s.model.message}`;
  if (s.waitingForAd) return "Jumps after the ad.";
  if (s.full) return `Reading in full detail: ${clock((s.full.done / Math.max(s.full.total, 1)) * duration)} of ${clock(duration)}. Esc stops.`;
  if (s.model.phase === "loading") return downloadStatus(s.model.loaded, s.model.total, elapsedS);
  if (s.preview) return `Reading this video: ${s.preview.done} of ${s.preview.total} moments`;
  if (s.problem === "error") return `Something went wrong reading this video: ${s.message}`;
  if (s.searching) return "Searching";
  if (s.query && s.hits.length === 0) return "Nothing found.";
  if (s.weak && s.hits.length) return "No clear match. Closest moments:";
  if (s.problem === "no-previews") return "No preview frames for this video. Search reads it in full detail.";
  if (s.kind === "preview") return "Quick results from preview frames. Your first search reads the video in full detail, once.";
  if (s.kind === "full") return "Read in full detail. Enter jumps to the next match.";
  return "Describe a moment in this video and press Enter.";
}
```

```ts
// extension/src/settings.ts
// Set from the acceptance measurement (Task 11): on only if playback stutter rises less than 1 point.
export const DEFAULT_BACKGROUND_READING = true;

export interface Settings {
  backgroundReading: boolean;
}

export async function readSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get({ backgroundReading: DEFAULT_BACKGROUND_READING });
  return { backgroundReading: s.backgroundReading === true };
}

export async function writeSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set(s);
}
```

```ts
// extension/src/content/styles.ts
// YouTube's look: its font, its light and dark greys, one accent from the website.
export const BAR_CSS = `
:host { all: initial; display: block; margin: 12px 0 0; --bg: #f2f2f2; --ink: #0f0f0f; --muted: #606060;
  --line: #e5e5e5; --accent: #4b3fd6; --field: #ffffff; font-family: "Roboto", "Arial", sans-serif; }
:host([data-theme="dark"]) { --bg: #272727; --ink: #f1f1f1; --muted: #aaaaaa; --line: #3f3f3f; --accent: #9d92fa; --field: #121212; }
:host([data-place="floating"]) { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 60; margin: 0; }
.bar { direction: ltr; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 12px;
  background: var(--bg); color: var(--ink); }
.row { display: flex; align-items: center; gap: 10px; }
.logo { flex: none; display: block; }
input { flex: 1; min-width: 0; height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 18px;
  background: var(--field); color: var(--ink); font: 400 14px "Roboto", "Arial", sans-serif; outline: none; }
input:focus { border-color: var(--accent); }
input::placeholder { color: var(--muted); }
.count { min-width: 56px; text-align: right; font: 500 13px "Roboto", "Arial", sans-serif; color: var(--muted); }
button { height: 32px; min-width: 32px; padding: 0 8px; border: 0; border-radius: 16px; background: transparent;
  color: var(--ink); font: 500 16px "Roboto", "Arial", sans-serif; cursor: pointer; }
button:hover:not(:disabled) { background: var(--line); }
button:disabled { opacity: 0.35; cursor: default; }
.status { font: 400 12px/1.4 "Roboto", "Arial", sans-serif; color: var(--muted); }
.line { height: 2px; border-radius: 1px; background: var(--line); overflow: hidden; }
.line i { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.2s ease; }
`;

export const OVERLAY_CSS = `
:host { all: initial; position: absolute; inset: 0; z-index: 70; display: block; cursor: default; }
.panel { position: absolute; left: 0; right: 0; bottom: 0; padding: 48px 20px 16px; display: flex; align-items: flex-end;
  gap: 16px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.75)); color: #ffffff;
  font-family: "Roboto", "Arial", sans-serif; }
.text { flex: 1; display: flex; flex-direction: column; gap: 8px; font: 500 15px "Roboto", "Arial", sans-serif; }
.line { height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
.line i { display: block; height: 100%; width: 0; background: #9d92fa; }
button { flex: none; height: 36px; padding: 0 16px; border: 0; border-radius: 18px; background: rgba(255, 255, 255, 0.18);
  color: #ffffff; font: 500 14px "Roboto", "Arial", sans-serif; cursor: pointer; }
button:hover { background: rgba(255, 255, 255, 0.3); }
`;

export const LOGO_SVG = `<svg class="logo" width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#16161A"/><path d="M6.5 18.5h15" stroke="#F7F6F3" stroke-width="2" stroke-linecap="round"/><rect x="15" y="8.5" width="3.2" height="13" rx="1.6" fill="#9D92FA"/></svg>`;
```

- [ ] **Step 4: Run the state tests**

Run: `cd extension && npx vitest run tests/bar-state.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: The bar, the marks, the engine link**

```ts
// extension/src/content/bar.ts
// The search bar under the player, sealed in a Shadow DOM so YouTube's styles and ours never meet. The template
// is static: no page or user text ever goes through innerHTML.
import { type BarState, countText } from "./bar-state";
import { BAR_CSS, LOGO_SVG } from "./styles";

export interface BarHandlers {
  onSearch(query: string): void;
  onStep(by: 1 | -1): void;
  onClear(): void;
  onSkip(): void;
}

export class Bar {
  readonly host = document.createElement("moments-bar");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private lastQuery = "";

  constructor(h: BarHandlers) {
    this.root.innerHTML = `<style>${BAR_CSS}</style>
      <div class="bar">
        <div class="row">${LOGO_SVG}
          <input type="text" maxlength="200" spellcheck="false" placeholder="Describe a moment in this video" aria-label="Search this video">
          <span class="count" aria-live="polite"></span>
          <button type="button" class="prev" aria-label="Previous match" disabled>&#8249;</button>
          <button type="button" class="next" aria-label="Next match" disabled>&#8250;</button>
        </div>
        <div class="status"></div>
        <div class="line"><i></i></div>
      </div>`;
    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.input = q<HTMLInputElement>("input");
    this.count = q<HTMLElement>(".count");
    this.status = q<HTMLElement>(".status");
    this.fill = q<HTMLElement>(".line i");
    this.prev = q<HTMLButtonElement>(".prev");
    this.next = q<HTMLButtonElement>(".next");
    // YouTube listens for k, f, j, l and digits on the document: keys typed here stay here.
    for (const type of ["keydown", "keyup", "keypress"]) this.input.addEventListener(type, (e) => e.stopPropagation());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const query = this.input.value.trim();
        if (!query) return;
        if (query !== this.lastQuery) {
          this.lastQuery = query;
          h.onSearch(query);
        } else h.onStep(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.input.value = "";
        this.lastQuery = "";
        this.input.blur();
        h.onSkip();
        h.onClear();
      }
    });
    this.prev.addEventListener("click", () => h.onStep(-1));
    this.next.addEventListener("click", () => h.onStep(1));
  }

  // Under the player when YouTube's layout allows; otherwise floating on the player itself.
  mount(): void {
    if (this.host.isConnected) return;
    const below = document.querySelector("ytd-watch-flexy #below");
    if (below) {
      this.host.dataset.place = "below";
      below.prepend(this.host);
      return;
    }
    const player = document.getElementById("movie_player");
    if (player) {
      this.host.dataset.place = "floating";
      player.append(this.host);
    }
  }

  focus(): void {
    this.mount();
    this.input.focus();
  }

  render(s: BarState, status: string): void {
    this.host.dataset.theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
    this.host.dataset.kind = s.kind;
    this.host.dataset.status = status;
    this.host.dataset.hits = JSON.stringify(s.hits.map((h) => h.start));
    this.host.dataset.current = String(s.current);
    if (!s.query) this.lastQuery = "";
    this.count.textContent = countText(s);
    this.status.textContent = status;
    this.prev.disabled = this.next.disabled = s.hits.length < 2;
    const progress = s.full ?? s.preview ?? (s.model.phase === "loading" ? { done: s.model.loaded, total: s.model.total } : null);
    this.fill.style.width = progress && progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "0";
  }
}
```

```ts
// extension/src/content/marks.ts
// One mark per match on YouTube's own progress bar; the current match is white and taller.
import type { Hit } from "../protocol";

const LAYER = "moments-marks";

export function clearMarks(): void {
  document.querySelectorAll(`.ytp-progress-bar > .${LAYER}`).forEach((el) => el.remove());
}

export function drawMarks(hits: Hit[], current: number, duration: number): void {
  const bar = document.querySelector<HTMLElement>(".ytp-progress-bar");
  if (!bar || !(duration > 0)) return;
  let layer = bar.querySelector<HTMLElement>(`:scope > .${LAYER}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = LAYER;
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:40";
    bar.append(layer);
  }
  layer.replaceChildren(
    ...hits.map((hit, i) => {
      const on = i === current;
      const mark = document.createElement("div");
      const w = on ? 6 : 4;
      const h = on ? 14 : 10;
      const left = Math.min(100, Math.max(0, (hit.start / duration) * 100));
      mark.style.cssText = `position:absolute;top:50%;left:${left}%;width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;border-radius:2px;background:${on ? "#ffffff" : "#9d92fa"};box-shadow:0 0 0 1px rgba(0,0,0,0.45)`;
      return mark;
    }),
  );
}
```

```ts
// extension/src/content/engine-link.ts
// The tab's line to the engine. Wakes the engine first; reconnects if Chrome unloaded it.
import type { FromEngine, ToEngine } from "../protocol";

export class EngineLink {
  private port: chrome.runtime.Port | null = null;
  private connecting: Promise<chrome.runtime.Port> | null = null;
  private readonly listeners = new Set<(m: FromEngine) => void>();
  private readonly connected = new Set<() => void>();

  onMessage(fn: (m: FromEngine) => void): void {
    this.listeners.add(fn);
  }

  onConnect(fn: () => void): void {
    this.connected.add(fn);
  }

  async send(m: ToEngine): Promise<void> {
    (await this.connect()).postMessage(m);
  }

  private connect(): Promise<chrome.runtime.Port> {
    if (this.port) return Promise.resolve(this.port);
    this.connecting ??= (async () => {
      const answer = await chrome.runtime.sendMessage({ type: "engine:ensure" });
      if (!answer?.ok) throw new Error(answer?.message ?? "the Moments engine did not start");
      const port = chrome.runtime.connect({ name: "moments" });
      port.onMessage.addListener((m: FromEngine) => this.listeners.forEach((fn) => fn(m)));
      port.onDisconnect.addListener(() => {
        this.port = null;
      });
      this.port = port;
      queueMicrotask(() => this.connected.forEach((fn) => fn()));
      return port;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
}
```

- [ ] **Step 6: Wiring (full read is added in Task 9)**

```ts
// extension/src/content/main.ts
// Ties the page reader, the engine and the bar together on YouTube.
import { type FromEngine, parsePageMessage, type VideoInfo } from "../protocol";
import { readSettings } from "../settings";
import { Bar } from "./bar";
import { type Action, type BarState, initialState, reduce, statusLine } from "./bar-state";
import { EngineLink } from "./engine-link";
import { clearMarks, drawMarks } from "./marks";

const link = new EngineLink();
let info: VideoInfo | null = null;
let state: BarState = initialState;
let searchId = 0;
let modelStarted = 0;

const player = () => document.getElementById("movie_player");
const video = () => player()?.querySelector("video") ?? null;
const isAd = () => player()?.classList.contains("ad-showing") ?? false;
const duration = () => video()?.duration || info?.duration || 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const bar = new Bar({
  onSearch: (query) => void search(query),
  onStep: (by) => {
    dispatch({ type: "step", by });
    void jump();
  },
  onClear: () => {
    dispatch({ type: "clear" });
    clearMarks();
  },
  onSkip: () => undefined,
});

function dispatch(a: Action): void {
  state = reduce(state, a);
  bar.render(state, statusLine(state, (performance.now() - modelStarted) / 1000, duration()));
  drawMarks(state.hits, state.current, duration());
}

async function search(query: string): Promise<void> {
  if (!info) return;
  const id = ++searchId;
  dispatch({ type: "searching", query });
  await link.send({ type: "search", id, videoId: info.videoId, query });
}

async function jump(): Promise<void> {
  const hit = state.hits[state.current];
  const v = video();
  if (!hit || !v) return;
  if (isAd()) {
    dispatch({ type: "ad", waiting: true });
    while (isAd()) await sleep(500);
    dispatch({ type: "ad", waiting: false });
  }
  v.currentTime = hit.start;
  void v.play().catch(() => undefined);
}

async function open(): Promise<void> {
  if (!info) return;
  const { backgroundReading } = await readSettings();
  await link.send({ type: "open", videoId: info.videoId, duration: info.duration, spec: info.spec, autoRead: backgroundReading && !info.live });
}

link.onConnect(() => void open().catch((err: unknown) => console.warn("Moments: could not open the video", err)));

link.onMessage((m: FromEngine) => {
  if (m.type === "model") {
    if (m.phase === "loading" && !modelStarted) modelStarted = performance.now();
    dispatch({ type: "model", phase: m.phase, loaded: m.loaded, total: m.total, message: m.message });
    return;
  }
  if (!info || m.videoId !== info.videoId) return;
  if (m.type === "state") {
    dispatch({ type: "engine", kind: m.kind, preview: m.reading === "preview" ? { done: m.done, total: m.total } : null, problem: m.problem, message: m.message });
    return;
  }
  if (m.id !== searchId) return;
  dispatch({ type: "results", query: state.query, hits: m.hits, weak: m.weak });
  if (m.hits.length) void jump();
});

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const next = parsePageMessage(e.data);
  if (!next || next.videoId === info?.videoId) return;
  info = next;
  searchId++;
  clearMarks();
  dispatch({ type: "video", videoId: next.videoId });
  bar.mount();
  void open().catch((err: unknown) => console.warn("Moments: could not open the video", err));
});

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "focus") bar.focus();
  return false;
});
```

- [ ] **Step 7: Register the content script**

In `extension/manifest.json`, extend `"content_scripts"`:

```json
  "content_scripts": [
    { "matches": ["https://www.youtube.com/*"], "js": ["page-reader.js"], "run_at": "document_idle", "world": "MAIN" },
    { "matches": ["https://www.youtube.com/*"], "js": ["content.js"], "run_at": "document_idle" }
  ],
```

- [ ] **Step 8: Browser test**

```ts
// extension/e2e/bar.spec.ts
import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the bar appears under the player, reads previews, finds a moment and marks it", async () => {
  const { context } = await launchExtension();
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const host = page.locator("moments-bar");
  await expect(host).toHaveAttribute("data-place", "below", { timeout: 30_000 });
  await expect(host).toHaveAttribute("data-kind", "preview", { timeout: 180_000 });
  const input = host.locator("input");
  await input.fill("a man in a trench coat dancing");
  await input.press("Enter");
  await expect(host).not.toHaveAttribute("data-hits", "[]", { timeout: 60_000 });
  const first = JSON.parse((await host.getAttribute("data-hits")) ?? "[]")[0] as number;
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.currentTime ?? -1)).toBeGreaterThanOrEqual(first - 1);
  await expect(page.locator(".ytp-progress-bar > .moments-marks > div").first()).toBeAttached();
  await input.press("Enter");
  await expect(host).toHaveAttribute("data-current", "1");
  await context.close();
});
```

Run: `cd extension && npx vitest run && npx tsc --noEmit && npm run build && npx playwright test e2e/bar.spec.ts`
Expected: all unit tests pass; build writes `dist/content.js`; browser test passes.

- [ ] **Step 9: Commit**

```bash
git add extension
git commit -m "feat(extension): search bar under the player with Ctrl+F stepping and marks on the progress bar"
```

---

### Task 9: The automatic full-detail read

**Files:**
- Create: `extension/src/content/full-read.ts`, `extension/src/content/overlay.ts`
- Modify: `extension/src/content/main.ts`
- Test: `extension/tests/full-read.test.ts`, `extension/e2e/full-read.spec.ts`

**Interfaces:**
- Consumes: `frameTimes(duration, every?)`, `scaledSize(w, h)` from `web/src/frames.ts`; `Frame` (Task 7); `EngineLink`, `Bar`, `bar-state` actions `full` (Task 8).
- Produces: `interface Seekable extends EventTarget { currentTime: number; paused: boolean; pause(): void; play(): Promise<void> }`, `interface FullReadDeps { video: Seekable; times: number[]; capture(): string; isAd(): boolean; send(frames: Frame[]): void; progress(done: number, total: number): void; signal: AbortSignal; seekTimeoutMs?: number; adPollMs?: number }`, `fullRead(d: FullReadDeps): Promise<boolean>` (true when every frame was read), `BATCH = 8`, `JPEG_QUALITY = 0.9`, `jpegCapture(video: HTMLVideoElement): () => string`; `class Overlay { constructor(onSkip: () => void); show(text: string, fraction: number): void; hide(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// extension/tests/full-read.test.ts
import { describe, expect, it } from "vitest";
import { type Frame, } from "../src/protocol";
import { fullRead } from "../src/content/full-read";

class FakeVideo extends EventTarget {
  paused = false;
  private t = 30;
  stuckAt: number | null = null;
  get currentTime(): number {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    if (v !== this.stuckAt) queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  pause(): void {
    this.paused = true;
  }
  async play(): Promise<void> {
    this.paused = false;
  }
}

const times = Array.from({ length: 20 }, (_, i) => i * 2);

function run(video: FakeVideo, over: Partial<Parameters<typeof fullRead>[0]> = {}) {
  const sent: Frame[][] = [];
  const done: number[] = [];
  const controller = new AbortController();
  const promise = fullRead({
    video,
    times,
    capture: () => `data:image/jpeg;base64,${video.currentTime}`,
    isAd: () => false,
    send: (frames) => sent.push(frames),
    progress: (n) => done.push(n),
    signal: controller.signal,
    seekTimeoutMs: 5,
    adPollMs: 1,
    ...over,
  });
  return { promise, sent, done, controller };
}

describe("fullRead", () => {
  it("reads every frame in order, in batches of 8, then puts the viewer back", async () => {
    const video = new FakeVideo();
    const { promise, sent } = run(video);
    expect(await promise).toBe(true);
    expect(sent.map((b) => b.length)).toEqual([8, 8, 4]);
    expect(sent.flat().map((f) => f.t)).toEqual(times);
    expect(video.currentTime).toBe(30);
    expect(video.paused).toBe(false);
  });

  it("stops at once when the viewer acts, keeps what it read and restores the player", async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    const sent: Frame[][] = [];
    const ok = await fullRead({
      video,
      times,
      capture: () => "data:image/jpeg;base64,x",
      isAd: () => false,
      send: (f) => sent.push(f),
      progress: (n) => n === 5 && controller.abort(),
      signal: controller.signal,
      seekTimeoutMs: 5,
    });
    expect(ok).toBe(false);
    expect(sent.flat()).toHaveLength(5);
    expect(video.currentTime).toBe(30);
    expect(video.paused).toBe(false);
  });

  it("leaves a paused viewer paused", async () => {
    const video = new FakeVideo();
    video.paused = true;
    await run(video).promise;
    expect(video.paused).toBe(true);
  });

  it("waits while an ad plays", async () => {
    let polls = 0;
    const video = new FakeVideo();
    const { promise, sent } = run(video, { isAd: () => ++polls <= 3 });
    expect(await promise).toBe(true);
    expect(sent.flat()).toHaveLength(20);
    expect(polls).toBeGreaterThan(3);
  });

  it("skips a frame whose seek never finishes instead of capturing the wrong one", async () => {
    const video = new FakeVideo();
    video.stuckAt = 10;
    const { promise, sent, done } = run(video);
    await promise;
    expect(sent.flat().map((f) => f.t)).not.toContain(10);
    expect(done.at(-1)).toBe(20);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd extension && npx vitest run tests/full-read.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the read and the overlay**

```ts
// extension/src/content/full-read.ts
// The full-detail read: step the viewer's own player through the video, grab each frame, put everything back.
// YouTube refuses a second, hidden player inside youtube.com (Error 152-4), so the viewer's player is the only
// source of real frames; the read happens once per video and the viewer can stop it at any moment.
import { scaledSize } from "../../../web/src/frames";
import type { Frame } from "../protocol";

export interface Seekable extends EventTarget {
  currentTime: number;
  paused: boolean;
  pause(): void;
  play(): Promise<void>;
}

export interface FullReadDeps {
  video: Seekable;
  times: number[];
  capture(): string;
  isAd(): boolean;
  send(frames: Frame[]): void;
  progress(done: number, total: number): void;
  signal: AbortSignal;
  seekTimeoutMs?: number;
  adPollMs?: number;
}

export const BATCH = 8;
export const JPEG_QUALITY = 0.9;
const SEEK_TIMEOUT_MS = 5000;
const AD_POLL_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seek(video: Seekable, t: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", done);
      resolve(false);
    }, timeoutMs);
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = t;
  });
}

export async function fullRead(d: FullReadDeps): Promise<boolean> {
  const { video, times, signal } = d;
  const saved = { t: video.currentTime, playing: !video.paused };
  let batch: Frame[] = [];
  let done = 0;
  video.pause();
  try {
    for (const t of times) {
      while (d.isAd()) {
        if (signal.aborted) return false;
        await sleep(d.adPollMs ?? AD_POLL_MS);
      }
      if (signal.aborted) return false;
      if (await seek(video, t, d.seekTimeoutMs ?? SEEK_TIMEOUT_MS)) {
        batch.push({ t, jpeg: d.capture() });
        if (batch.length === BATCH) {
          d.send(batch);
          batch = [];
        }
      }
      d.progress(++done, times.length);
    }
    return !signal.aborted;
  } finally {
    if (batch.length) d.send(batch);
    video.currentTime = saved.t;
    if (saved.playing) void video.play().catch(() => undefined);
  }
}

export function jpegCapture(video: HTMLVideoElement): () => string {
  const { w, h } = scaledSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas on this page");
  return () => {
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  };
}
```

```ts
// extension/src/content/overlay.ts
// Covers the player during a full-detail read: the frames show through above, status and Skip below. It also
// catches clicks, so a click on the video cannot start playback in the middle of the read.
import { OVERLAY_CSS } from "./styles";

export class Overlay {
  private readonly host = document.createElement("moments-overlay");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly text: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(onSkip: () => void) {
    this.root.innerHTML = `<style>${OVERLAY_CSS}</style>
      <div class="panel"><div class="text"><span></span><div class="line"><i></i></div></div><button type="button">Skip</button></div>`;
    this.text = this.root.querySelector(".text span") as HTMLElement;
    this.fill = this.root.querySelector(".line i") as HTMLElement;
    (this.root.querySelector("button") as HTMLButtonElement).addEventListener("click", (e) => {
      e.stopPropagation();
      onSkip();
    });
    for (const type of ["click", "dblclick", "mousedown", "mouseup"]) this.host.addEventListener(type, (e) => e.stopPropagation());
  }

  show(text: string, fraction: number): void {
    const player = document.getElementById("movie_player");
    if (!player) return;
    if (this.host.parentElement !== player) player.append(this.host);
    this.text.textContent = text;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  hide(): void {
    this.host.remove();
  }
}
```

- [ ] **Step 4: Run the unit tests**

Run: `cd extension && npx vitest run tests/full-read.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Wire it into `extension/src/content/main.ts`**

Add imports:

```ts
import { frameTimes } from "../../../web/src/frames";
import { fullRead, jpegCapture } from "./full-read";
import { Overlay } from "./overlay";
```

Add state next to `let modelStarted = 0;`:

```ts
let reader: AbortController | null = null;
const overlay = new Overlay(() => stopReading());
const stopReading = () => reader?.abort();
```

Change the bar handlers to:

```ts
const bar = new Bar({
  onSearch: (query) => void search(query),
  onStep: (by) => {
    stopReading();
    dispatch({ type: "step", by });
    void jump();
  },
  onClear: () => {
    dispatch({ type: "clear" });
    clearMarks();
  },
  onSkip: () => stopReading(),
});
```

At the end of `dispatch`, add:

```ts
  if (state.full) overlay.show(statusLine(state, 0, duration()), state.full.done / Math.max(state.full.total, 1));
  else overlay.hide();
```

In `search`, after `await link.send(...)`, add:

```ts
  if (state.kind !== "full" && !state.full && !reader) void readInFull();
```

Add the read itself:

```ts
// The first search reads the video in full detail, once; results sharpen when it ends.
async function readInFull(): Promise<void> {
  const v = video();
  if (!info || !v || reader || !(v.duration > 0)) return;
  const videoId = info.videoId;
  const controller = (reader = new AbortController());
  const onPlay = () => controller.abort(); // the viewer pressed play: their video wins
  let complete = false;
  v.addEventListener("play", onPlay);
  try {
    complete = await fullRead({
      video: v,
      times: frameTimes(v.duration),
      capture: jpegCapture(v),
      isAd,
      send: (frames) => void link.send({ type: "full-frames", videoId, frames }).catch((err: unknown) => console.warn("Moments: frames not sent", err)),
      progress: (done, total) => dispatch({ type: "full", progress: { done, total } }),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn("Moments: the full-detail read stopped", err);
  } finally {
    v.removeEventListener("play", onPlay);
    reader = null;
    dispatch({ type: "full", progress: null });
    if (info?.videoId === videoId) await link.send({ type: "full-end", videoId, complete });
  }
}
```

In the engine `state` branch of `link.onMessage`, re-run the current search when a full-detail read lands:

```ts
  if (m.type === "state") {
    const sharpened = m.kind === "full" && state.kind !== "full";
    dispatch({ type: "engine", kind: m.kind, preview: m.reading === "preview" ? { done: m.done, total: m.total } : null, problem: m.problem, message: m.message });
    if (sharpened && state.query) void search(state.query);
    return;
  }
```

In the results branch, do not jump while reading: replace `if (m.hits.length) void jump();` with `if (m.hits.length && !reader) void jump();`.

In the page message listener, stop a read on navigation: add `stopReading();` as the first line after the `if (!next || ...) return;` check.

Add Esc while reading, anywhere on the page:

```ts
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && reader) {
      e.stopPropagation();
      stopReading();
    }
  },
  true,
);
```

- [ ] **Step 6: Browser test**

```ts
// extension/e2e/full-read.spec.ts
import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the first search reads the video in full detail and puts the player back", async () => {
  const { context, extensionId } = await launchExtension();
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await setup.evaluate(() => chrome.runtime.sendMessage({ type: "forget-all" }));
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const host = page.locator("moments-bar");
  await expect(host).toHaveAttribute("data-kind", "preview", { timeout: 180_000 });
  await page.waitForFunction(() => !document.getElementById("movie_player")?.classList.contains("ad-showing"), null, { timeout: 120_000 });
  const before = await page.evaluate(() => document.querySelector("video")!.currentTime);
  await host.locator("input").fill("a woman with blonde hair");
  await host.locator("input").press("Enter");
  await expect(page.locator("moments-overlay")).toBeAttached({ timeout: 30_000 });
  await expect(host).toHaveAttribute("data-kind", "full", { timeout: 300_000 });
  await expect(page.locator("moments-overlay")).not.toBeAttached();
  await expect(host).not.toHaveAttribute("data-hits", "[]", { timeout: 60_000 });
  const after = await page.evaluate(() => document.querySelector("video")!.currentTime);
  expect(Math.abs(after - before)).toBeLessThan(250); // restored, then jumped to a match inside the video
  await context.close();
});
```

Run: `cd extension && npx vitest run && npx tsc --noEmit && npm run build && npx playwright test e2e/full-read.spec.ts`
Expected: all unit tests pass; browser test passes.

- [ ] **Step 7: Commit**

```bash
git add extension
git commit -m "feat(extension): automatic full-detail read through the viewer's player on the first search"
```

---

### Task 10: Settings popup, keyboard shortcut, idle unload

**Files:**
- Replace: `extension/popup.html`, `extension/src/popup/popup.ts`
- Modify: `extension/src/background.ts`, `extension/manifest.json`
- Test: `extension/e2e/popup.spec.ts`

**Interfaces:**
- Consumes: `readSettings`, `writeSettings`, `DEFAULT_BACKGROUND_READING` (Task 8); `CAP_BYTES` (Task 6); `count`, `megabytes` (`web/src/format.ts`); engine runtime messages `stats` and `forget-all` (Task 7).
- Produces: manifest command `focus-search` (Alt+M) sending `{ type: "focus" }` to the active YouTube tab; alarm `idle-check` every 5 minutes that closes the engine after two checks (10 minutes) with no YouTube watch tab.

- [ ] **Step 1: Popup**

```html
<!-- extension/popup.html -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moments</title>
<style>
  body { margin: 0; width: 300px; font: 400 13px/1.45 "Roboto", "Segoe UI", system-ui, sans-serif; color: #0f0f0f; background: #ffffff; }
  main { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  header { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
  .muted { color: #606060; }
  label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  input { margin: 2px 0 0; accent-color: #4b3fd6; }
  button { height: 32px; border: 1px solid #d3d0c8; border-radius: 8px; background: #ffffff; font: inherit; cursor: pointer; }
  button:hover { background: #f2f2f2; }
  @media (prefers-color-scheme: dark) {
    body { color: #f1f1f1; background: #212121; }
    .muted { color: #aaaaaa; }
    button { color: #f1f1f1; background: #303030; border-color: #4a4a4a; }
    button:hover { background: #3a3a3a; }
  }
</style>
</head>
<body>
<main>
  <header><img src="icons/32.png" width="22" height="22" alt="">Moments</header>
  <div id="model" class="muted">Checking the AI model</div>
  <div id="space" class="muted"></div>
  <label><input type="checkbox" id="background"><span>Read each video in the background<br><span class="muted">Search answers at once. Off: a video is read when you first search it.</span></span></label>
  <button type="button" id="forget">Forget saved videos</button>
  <div class="muted">Alt+M searches the video you are watching. Nothing leaves your computer.</div>
</main>
<script type="module" src="/src/popup/popup.ts"></script>
</body>
</html>
```

```ts
// extension/src/popup/popup.ts
import { count, megabytes } from "../../../web/src/format";
import { readSettings, writeSettings } from "../settings";
import { CAP_BYTES } from "../store-policy";

interface Stats {
  phase: "idle" | "loading" | "ready" | "error";
  device: "webgpu" | "wasm" | null;
  message: string;
  videos: number;
  bytes: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function stats(): Promise<Stats> {
  await chrome.runtime.sendMessage({ type: "engine:ensure" });
  return chrome.runtime.sendMessage({ type: "stats" });
}

function modelText(s: Stats): string {
  if (s.phase === "error") return `The AI model could not load: ${s.message}`;
  if (s.phase === "loading") return "The AI model is loading.";
  if (s.phase === "ready") return `The AI model is ready, running ${s.device === "webgpu" ? "on your GPU" : "on your CPU (slower)"}.`;
  return "The AI model loads when you open a YouTube video.";
}

async function render(): Promise<void> {
  try {
    const s = await stats();
    $("model").textContent = modelText(s);
    $("space").textContent = `Saved: ${count(s.videos, "video")}, ${megabytes(s.bytes)} of ${megabytes(CAP_BYTES)}`;
  } catch (err) {
    $("model").textContent = `Moments could not start: ${String(err)}`;
  }
}

const toggle = $<HTMLInputElement>("background");
void readSettings().then((s) => (toggle.checked = s.backgroundReading));
toggle.addEventListener("change", () => void writeSettings({ backgroundReading: toggle.checked }));
$("forget").addEventListener("click", async () => {
  const answer = await chrome.runtime.sendMessage({ type: "forget-all" });
  if (!answer?.ok) $("space").textContent = `Could not forget: ${answer?.message ?? "no answer"}`;
  await render();
});
void render();
```

- [ ] **Step 2: Keyboard command and idle unload**

Add to `extension/manifest.json`:

```json
  "commands": {
    "focus-search": { "suggested_key": { "default": "Alt+M" }, "description": "Search the YouTube video you are watching" }
  },
```

Append to `extension/src/background.ts`:

```ts
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "focus-search") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined && tab.url?.startsWith("https://www.youtube.com/watch")) {
    await chrome.tabs.sendMessage(tab.id, { type: "focus" }).catch((err: unknown) => console.warn("Moments: focus not delivered", err));
  }
});

// Free the model's memory after 10 minutes without a YouTube video tab (two checks 5 minutes apart).
const IDLE_ALARM = "idle-check";
chrome.runtime.onInstalled.addListener(() => void chrome.alarms.create(IDLE_ALARM, { periodInMinutes: 5 }));
chrome.runtime.onStartup.addListener(() => void chrome.alarms.create(IDLE_ALARM, { periodInMinutes: 5 }));
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== IDLE_ALARM) return;
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/watch*" });
  const { idleChecks = 0 } = await chrome.storage.session.get("idleChecks");
  const next = tabs.length ? 0 : (idleChecks as number) + 1;
  await chrome.storage.session.set({ idleChecks: next });
  if (next >= 2 && (await engineExists())) await chrome.offscreen.closeDocument();
});
```

- [ ] **Step 3: Browser test**

```ts
// extension/e2e/popup.spec.ts
import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the popup shows the model and saved space, forgets on request, and remembers the setting", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("#space")).toContainText("of 200 MB");
  await page.locator("#forget").click();
  await expect(page.locator("#space")).toContainText("Saved: 0 videos");
  const toggle = page.locator("#background");
  const was = await toggle.isChecked();
  await toggle.click();
  await page.reload();
  await expect(toggle).toBeChecked({ checked: !was });
  await toggle.click();
  await context.close();
});

test("the shortcut's message focuses the bar", async () => {
  const { context } = await launchExtension();
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(page.locator("moments-bar")).toBeAttached({ timeout: 30_000 });
  const [worker] = context.serviceWorkers();
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://www.youtube.com/watch*" });
    await chrome.tabs.sendMessage(tab.id!, { type: "focus" });
  });
  await expect.poll(() => page.evaluate(() => document.querySelector("moments-bar")?.shadowRoot?.activeElement?.tagName)).toBe("INPUT");
  await context.close();
});
```

Run: `cd extension && npx tsc --noEmit && npm run build && npx playwright test e2e/popup.spec.ts`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add extension
git commit -m "feat(extension): settings popup, Alt+M shortcut, model unloads after 10 idle minutes"
```

---

### Task 11: Acceptance (pre-registered), speed, stutter, the background-reading default

**Files:**
- Create: `extension/scripts/contact-sheet.mjs`, `extension/acceptance/videos.md`, `extension/acceptance/queries.json`, `extension/acceptance/acceptance.spec.ts`, `extension/playwright.acceptance.config.ts`
- Modify: `extension/src/settings.ts` (the default), `EVAL.md` (new section), `PREFLIGHT.md` (any defects), `docs/specs/2026-10-11-moments-extension-design.md` (only if the default flips)

- [ ] **Step 1: Contact-sheet tool**

```js
// extension/scripts/contact-sheet.mjs: renders a video's 320x180 preview frames with their times into one PNG, so
// answers can be written down before any search runs.  node scripts/contact-sheet.mjs <videoId> <out.png>
import { chromium } from "@playwright/test";

const [id, out] = process.argv.slice(2);
const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "accept-language": "en-US" } })).text();
const spec = JSON.parse(`"${/"spec":"(https:\/\/i\.ytimg\.com\/sb\/[^"]+)"/.exec(html)[1]}"`);
const length = Number(/"lengthSeconds":"(\d+)"/.exec(html)[1]);
const [base, ...levels] = spec.split("|");
const top = levels.length - 1;
const [w, h, count, cols, rows, interval, name, sigh] = levels[top].split("#");
const per = cols * rows;
const cells = [];
for (let k = 0; k < Number(count) && (k * interval) / 1000 <= length; k++) {
  const sheet = `${base.replace("$L", top).replace("$N", name.replace("$M", Math.floor(k / per)))}&sigh=${sigh}`;
  const cell = k % per;
  const t = (k * interval) / 1000;
  cells.push(`<figure><div style="width:${w}px;height:${h}px;background:url('${sheet}') -${(cell % cols) * w}px -${Math.floor(cell / cols) * h}px"></div><figcaption>${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}</figcaption></figure>`);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 6 * (Number(w) + 8), height: 800 } });
await page.setContent(`<style>body{margin:0;display:flex;flex-wrap:wrap;font:14px Arial}figure{margin:4px}figcaption{text-align:center}</style>${cells.join("")}`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${cells.length} frames, every ${interval / 1000} s -> ${out}`);
```

- [ ] **Step 2: Choose four videos and pre-register 20 searches**

Pick four public YouTube videos between 2 and 5 minutes long (their previews are 2 s apart, fine enough to write answers): a rocket launch, a game or sport clip, a cooking video, a talk with slides. Record ids and titles in `extension/acceptance/videos.md`. For each, run `node scripts/contact-sheet.mjs <id> acceptance/<id>.png`, look at the sheet, and write five searches with the second ranges where the answer is on screen. Save as:

```json
// extension/acceptance/queries.json (shape; fill in the four chosen videos)
{
  "tolerance_s": 2,
  "videos": [
    { "id": "<11-char id>", "kind": "launch", "queries": [{ "q": "<what is on screen>", "answer": [[12, 16]] }] }
  ]
}
```

Commit the sheets' ids, `videos.md` and `queries.json` BEFORE running any search (the commit is the evidence the answers came first):

```bash
git add extension/acceptance/videos.md extension/acceptance/queries.json extension/scripts/contact-sheet.mjs
git commit -m "test(extension): pre-register 20 acceptance searches on four YouTube videos"
```

- [ ] **Step 3: The acceptance test**

```ts
// extension/playwright.acceptance.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: "acceptance", timeout: 3_600_000, retries: 0, workers: 1 });
```

```ts
// extension/acceptance/acceptance.spec.ts
// Runs the pre-registered searches through the built extension: preview-only answers at engine level, then the
// full-detail answers through the bar as a viewer would. Also times every stage and measures playback stutter.
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { launchExtension } from "../e2e/helpers";

interface Plan {
  tolerance_s: number;
  videos: { id: string; kind: string; queries: { q: string; answer: [number, number][] }[] }[];
}
const plan = JSON.parse(readFileSync(new URL("./queries.json", import.meta.url), "utf8")) as Plan;
const near = (t: number, answer: [number, number][]) => answer.some(([a, b]) => t >= a - plan.tolerance_s && t <= b + plan.tolerance_s);

async function droppedShare(page: Page, seconds: number): Promise<number> {
  return page.evaluate(async (s) => {
    const v = document.querySelector("video")!;
    const a = v.getVideoPlaybackQuality();
    await new Promise((r) => setTimeout(r, s * 1000));
    const b = v.getVideoPlaybackQuality();
    return (b.droppedVideoFrames - a.droppedVideoFrames) / Math.max(1, b.totalVideoFrames - a.totalVideoFrames);
  }, seconds);
}

test("acceptance", async () => {
  const { context, extensionId } = await launchExtension();
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  await control.evaluate(() => chrome.runtime.sendMessage({ type: "forget-all" }));
  const rows: Record<string, unknown>[] = [];
  let firstFull = 0;
  let top5Full = 0;

  for (const video of plan.videos) {
    const page = await context.newPage();
    const t0 = Date.now();
    await page.goto(`https://www.youtube.com/watch?v=${video.id}`);
    const host = page.locator("moments-bar");
    await expect(host).toHaveAttribute("data-kind", "preview", { timeout: 600_000 });
    const previewSeconds = (Date.now() - t0) / 1000;

    // Preview-only answers, straight from the engine (no full read is triggered this way).
    const preview = await control.evaluate(async ({ id, queries }) => {
      const port = chrome.runtime.connect({ name: "moments" });
      const out: number[][] = [];
      for (const [i, q] of queries.entries()) {
        out.push(
          await new Promise<number[]>((resolve) => {
            port.onMessage.addListener(function on(m) {
              if (m.type === "results" && m.id === 1000 + i) {
                port.onMessage.removeListener(on);
                resolve(m.hits.map((h: { start: number }) => h.start));
              }
            });
            port.postMessage({ type: "search", id: 1000 + i, videoId: id, query: q.q });
          }),
        );
      }
      port.disconnect();
      return out;
    }, video);

    await page.waitForFunction(() => !document.getElementById("movie_player")?.classList.contains("ad-showing"), null, { timeout: 300_000 });
    const t1 = Date.now();
    const input = host.locator("input");
    await input.fill(video.queries[0].q);
    await input.press("Enter");
    await expect(host).toHaveAttribute("data-kind", "full", { timeout: 1_800_000 });
    const fullSeconds = (Date.now() - t1) / 1000;
    const durationS = await page.evaluate(() => document.querySelector("video")!.duration);

    for (const [i, q] of video.queries.entries()) {
      await input.fill(q.q);
      await input.press("Enter");
      await expect(host).toHaveAttribute("data-status", /^(?!Searching)/, { timeout: 60_000 });
      await page.waitForTimeout(300);
      const full = JSON.parse((await host.getAttribute("data-hits")) ?? "[]") as number[];
      const fullRank = full.findIndex((t) => near(t, q.answer)) + 1;
      const prevRank = preview[i].findIndex((t) => near(t, q.answer)) + 1;
      if (fullRank === 1) firstFull++;
      if (fullRank >= 1 && fullRank <= 5) top5Full++;
      rows.push({ video: video.id, kind: video.kind, q: q.q, previewRank: prevRank || null, fullRank: fullRank || null });
    }
    rows.push({ video: video.id, previewSeconds, fullSeconds, durationS, fullSecondsPerMinute: fullSeconds / (durationS / 60) });
    await page.close();
  }

  // Stutter: one tab plays; dropped frames without reading, then while another tab's video is read.
  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: false }));
  const watch = await context.newPage();
  await watch.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await watch.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > 1, null, { timeout: 120_000 });
  const quiet = await droppedShare(watch, 30);
  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: true }));
  const other = await context.newPage();
  await other.goto("https://www.youtube.com/watch?v=-idr3GEYf1Q");
  await watch.bringToFront();
  const busy = await droppedShare(watch, 30);

  const summary = { firstFull, top5Full, n: rows.filter((r) => "q" in r).length, droppedQuiet: quiet, droppedWhileReading: busy };
  writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ summary, rows }, null, 1));
  console.log(JSON.stringify(summary));
  await context.close();
});
```

- [ ] **Step 4: Run it**

Run: `cd extension && npm run build && npx playwright test -c playwright.acceptance.config.ts`
Expected: `acceptance/results.json` written; the summary printed.

- [ ] **Step 5: Apply the gates exactly as the spec wrote them**

- Accuracy: `top5Full >= 18` and `firstFull >= 14`. If either misses: STOP, report the numbers and the misses to Itay before any tuning.
- Speed: each `fullSecondsPerMinute` must keep a 10-minute video under 40 s (`< 4` s per minute of video); preview read times as in the spec. Record misses as defects.
- Background reading default: if `droppedWhileReading - droppedQuiet < 0.01`, keep `DEFAULT_BACKGROUND_READING = true`; otherwise set it to `false` in `extension/src/settings.ts` and change the spec's "Light" bullet to say background reading is off by default with the measured numbers.

- [ ] **Step 6: EVAL.md and commit**

Add a section `## Moments for YouTube (Chrome extension)` to `EVAL.md` with: the four videos, the per-query table (preview rank, full rank), the totals against the gate, the speed numbers, the stutter numbers and the resulting default. Defects found go in `PREFLIGHT.md`.

```bash
git add extension/acceptance extension/src/settings.ts EVAL.md PREFLIGHT.md docs/specs/2026-10-11-moments-extension-design.md
git commit -m "test(extension): acceptance on 20 pre-registered searches, speed and stutter measured"
```

---

### Task 12: Release package, privacy page, store listing, reviews

**Files:**
- Create: `extension/scripts/package.mjs`, `extension/scripts/screenshots.mjs`, `extension/store/listing.md`, `web/privacy.html`
- Modify: `web/vite.config.ts` (second page), `README.md` (extension section), `extension/package.json` (script `package`)

- [ ] **Step 1: Privacy page on the website**

```html
<!-- web/privacy.html -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moments privacy</title>
<style>
  body { margin: 0; background: #f7f6f3; color: #16161a; font: 16px/1.6 Geist, ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 48px 20px; }
  h1 { font-size: 32px; letter-spacing: -0.02em; } h2 { font-size: 20px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <h1>Moments privacy</h1>
  <p>Moments (the website and the Chrome extension "Moments: search YouTube by what you see") runs its AI model on your own computer. It has no servers that receive your data, no accounts, no analytics and no ads.</p>
  <h2>What the extension reads</h2>
  <p>On YouTube video pages it reads the video's id, length and YouTube's own preview images, and, when you search a video for the first time, the frames of the video in your player. It turns them into numbers on your computer.</p>
  <h2>What it stores</h2>
  <p>Those numbers, per video, in your browser (at most 200 MB, oldest dropped first), your background-reading setting, and the AI model files. "Forget saved videos" in the extension's menu deletes the numbers.</p>
  <h2>What leaves your computer</h2>
  <p>Nothing about you or your videos. The extension downloads the AI model once (from moments-video.vercel.app, or Hugging Face as a backup) and YouTube's preview images from YouTube. These are ordinary downloads that do not include anything you searched or watched.</p>
  <h2>Contact</h2>
  <p>Questions: open an issue at <a href="https://github.com/itayco2/Moments/issues">github.com/itayco2/Moments</a>.</p>
</main>
</body>
</html>
```

In `web/vite.config.ts` add to `build`:

```ts
  build: { target: "es2022", rolldownOptions: { input: { main: "index.html", privacy: "privacy.html" } } },
```

Run: `cd web && npx vitest run && VITE_SELF_HOSTED_MODEL=1 npm run build && ls dist/privacy.html`
Expected: tests pass; `dist/privacy.html` exists.

- [ ] **Step 2: Store package**

```js
// extension/scripts/package.mjs: zips dist/ for the Chrome Web Store.  node scripts/package.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const dist = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(dist, path).split("\\").join("/")] = readFileSync(path);
  }
};
walk(dist);
const out = `moments-youtube-${version}.zip`;
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`${Object.keys(files).length} files -> ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
```

Add to `extension/package.json` scripts: `"package": "npm run build && node scripts/package.mjs"`.

Run: `cd extension && npm run package`
Expected: `moments-youtube-1.0.0.zip` under 15 MB.

- [ ] **Step 3: Screenshots for the listing (1280x800)**

```js
// extension/scripts/screenshots.mjs: the bar with results and marks, and the full-detail overlay.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const profile = fileURLToPath(new URL("../.pw-profile", import.meta.url));
mkdirSync("store/screenshots", { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--autoplay-policy=no-user-gesture-required"],
});
const page = await context.newPage();
await page.goto("https://www.youtube.com/watch?v=-idr3GEYf1Q");
const host = page.locator("moments-bar");
await host.waitFor({ state: "attached", timeout: 60_000 });
await page.waitForFunction(() => document.querySelector("moments-bar")?.getAttribute("data-kind") !== "none", null, { timeout: 600_000 });
await host.locator("input").fill("a rocket on the launch pad");
await host.locator("input").press("Enter");
await page.waitForSelector("moments-overlay", { timeout: 60_000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: "store/screenshots/2-reading.png" });
await page.waitForFunction(() => document.querySelector("moments-bar")?.getAttribute("data-kind") === "full", null, { timeout: 1_800_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "store/screenshots/1-results.png" });
await context.close();
console.log("screenshots written");
```

Run: `cd extension && node scripts/screenshots.mjs`
Expected: two PNGs in `extension/store/screenshots/`. Check them by eye: no other extension UI, no personal data on screen.

- [ ] **Step 4: Listing text**

```markdown
<!-- extension/store/listing.md -->
# Chrome Web Store listing

Name: Moments: search YouTube by what you see
Summary (132 characters max): Type what you want to see and jump to that second of any YouTube video. The AI runs on your computer.
Category: Productivity
Language: English

Description:
Remember a moment but not the minute? Type it. "a rocket lifting off", "the goal from the air", "slides with a bar chart". Moments jumps your YouTube video to that second.

How it works: an AI model (Google's EmbeddingGemma 2) runs inside your browser. It reads the video's frames and turns them into numbers; your sentence becomes numbers the same way, and the closest moment wins. The first search of a video reads it in full detail, once; after that, search is instant.

Private by design: nothing about you or your videos leaves your computer. No account, no servers, no ads, free and open source (github.com/itayco2/Moments).

Keys: Enter jumps to the next match, Shift+Enter to the previous one, Esc clears. Alt+M searches the video you are watching.

Single purpose: search inside the YouTube video you are watching by describing what is on screen.

Permission justifications:
- youtube.com: show the search bar on video pages and read the video's frames when you search.
- i.ytimg.com: download YouTube's preview images of the video to read it quickly.
- moments-video.vercel.app, huggingface.co, hf.co: download the AI model once.
- offscreen: run the AI model once for all tabs.
- storage: remember your setting and each video's search data (200 MB at most).
- alarms: unload the AI model after 10 minutes without a YouTube video, to free memory.

Data use disclosures: collects no user data. Privacy policy: https://moments-video.vercel.app/privacy.html
```

- [ ] **Step 5: README section**

Add after the "Try it" paragraph in `README.md`:

```markdown
**Moments for YouTube (Chrome extension):** search any YouTube video by describing what is on screen, with the
model on your computer. Source in [`extension/`](extension), measured in [EVAL.md](EVAL.md). Build it with
`cd extension && npm install && npm run package`; the Chrome Web Store link is added here once Google's review
approves it.
```

- [ ] **Step 6: Reviews**

Dispatch two reviews of the `extension/` diff since Task 2 in parallel: the `code-reviewer` agent (quality, consistency with this plan) and the `security-reviewer` agent (permissions, page-message handling, `innerHTML` use, data URLs, CSP). Fix every CRITICAL and HIGH finding with a test where one applies; record defects in PREFLIGHT.

Run after fixes: `cd extension && npx tsc --noEmit && npx vitest run && npm run build && npx playwright test`
Expected: all unit and browser tests pass.

- [ ] **Step 7: Commit and push**

```bash
git add extension web/privacy.html web/vite.config.ts README.md PREFLIGHT.md
git commit -m "feat(extension): store package, privacy page, listing and screenshots"
git push origin main
```

- [ ] **Step 8: Hand over to Itay**

Itay opens a Chrome Web Store developer account (one-time $5, his Google login), uploads `extension/moments-youtube-1.0.0.zip`, pastes the text from `extension/store/listing.md`, adds the screenshots and the privacy URL, and submits. After approval: the store link goes into the README and onto the website as an "Add to Chrome" button, the feed video is re-recorded with the extension, then the post.

---

## Self-review notes

- Spec coverage: viewer experience (Tasks 8, 9, 10), two reading speeds (7, 9), hidden-player finding (spec only), architecture parts (2, 5, 7, 8, 10), shared code (1, 7), store rules (2, 12), targets and gates (11), errors table: no previews (7, 8), low-res (4), no WebGPU (2 gate, popup text 10), download failure (fallback in Task 1 config, error status 8), ads (8, 9), viewer acts during read (9), navigation during read (9), several tabs (7 queue and ports), layout fallback (8 mount), spec format change (4 validation), storage refused (7 library), untrusted messages (5, 7); open crash (3); tests and release (2 to 12).
- Names used across tasks: `parseSpec`, `bestLevel`, `tiles`, `Tile`, `videoInfo`, `VideoInfo`, `parsePageMessage`, `parseToEngine`, `ToEngine`, `FromEngine`, `ModelMessage`, `StateMessage`, `ResultsMessage`, `Hit`, `Frame`, `Kind`, `toFp16`, `CAP_BYTES`, `entryBytes`, `evict`, `loadVideo`, `saveVideo`, `usage`, `forgetAll`, `Library`, `mergePartial`, `readSheets`, `decodeFrames`, `EngineLink`, `Bar`, `reduce`, `statusLine`, `countText`, `drawMarks`, `clearMarks`, `fullRead`, `jpegCapture`, `Overlay`, `readSettings`, `writeSettings`, `DEFAULT_BACKGROUND_READING`, `launchExtension`, `NO_CDN`.
