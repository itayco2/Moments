// Pure helpers for fetch-model.mjs, kept apart so the tests can check them without a download.
import { createHash } from "node:crypto";

// Inclusive byte ranges [start, end] that cover a file of `size` bytes in `chunk`-sized pieces.
export function ranges(size, chunk) {
  const out = [];
  for (let start = 0; start < size; start += chunk) out.push([start, Math.min(start + chunk, size) - 1]);
  return out;
}

// Git's hash of a file's content: what Hugging Face reports as `oid` for files not stored in LFS.
export function gitBlobSha1(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

// Large files carry a SHA-256 (`lfs.oid`); small ones only their git hash.
export function expectedHash(entry) {
  return entry.lfs ? { kind: "sha256", hex: entry.lfs.oid } : { kind: "git", hex: entry.oid };
}
