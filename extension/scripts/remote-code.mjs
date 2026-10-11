// The Chrome Web Store allows no remote code. These helpers keep script CDN addresses out of dist/: the build
// rewrites the one transformers.js carries, and the build and the store zip both refuse a dist/ that has any left.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CDN_HOSTS = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs/;
const SCRIPT = /\.(m?js|html|json)$/;
// transformers.js points the ONNX runtime at jsDelivr by default, before the worker points it at the bundled copy
// (web/src/worker.ts); the default is rewritten to that same bundled path.
const ORT_CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{[^}`]+\}\/dist\//g;

function scripts(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return scripts(path);
    return SCRIPT.test(name) ? [path] : [];
  });
}

// Rewrites the runtime's CDN default to `bundled` in every script under dir. Returns how many were rewritten.
export function rewriteRuntimeCdn(dir, bundled) {
  let rewritten = 0;
  for (const path of scripts(dir)) {
    const text = readFileSync(path, "utf8");
    const next = text.replace(ORT_CDN, () => {
      rewritten++;
      return bundled;
    });
    if (next !== text) writeFileSync(path, next);
  }
  return rewritten;
}

// Throws, naming each file and what it contains, when any script under dir still names a script CDN.
export function assertNoRemoteCode(dir) {
  const found = scripts(dir).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    const at = text.search(CDN_HOSTS);
    return at < 0 ? [] : [`${path}: ...${text.slice(Math.max(0, at - 60), at + 80)}...`];
  });
  if (found.length) throw new Error(`remote code addresses in the extension:\n${found.join("\n")}`);
}
