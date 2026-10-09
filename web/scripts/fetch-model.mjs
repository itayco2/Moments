// Download the model files the live site serves itself, at the pinned Hugging Face revision, and check every
// byte against Hugging Face's own hashes. Vercel's build runs this (vercel.json), so the 400 MB never enter git.
// Large files come down in parallel byte ranges: Hugging Face's CDN caps each connection (PREFLIGHT PF20).
//   node scripts/fetch-model.mjs public/models
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expectedHash, gitBlobSha1, ranges } from "./model-files.mjs";

const CHUNK = 16 * 1024 * 1024;
const PARALLEL = 8;
const RETRIES = 3;

const model = JSON.parse(await readFile(new URL("../src/model.json", import.meta.url), "utf8"));
const out = join(process.argv[2] ?? "public/models", model.revision.slice(0, 7), model.id);
const base = `https://huggingface.co/${model.id}/resolve/${model.revision}/`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function hashOf(path, kind) {
  if (kind === "git") return gitBlobSha1(await readFile(path));
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function fetchRange(url, [start, end]) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status} for bytes ${start}-${end}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length !== end - start + 1) throw new Error(`got ${bytes.length} bytes for ${start}-${end}`);
      return bytes;
    } catch (err) {
      if (attempt >= RETRIES) throw err;
    }
  }
}

async function download(file, size, target) {
  const tmp = `${target}.part`;
  const handle = await open(tmp, "w");
  try {
    const queue = ranges(size, CHUNK);
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) await handle.write(await fetchRange(base + file, r), 0, r[1] - r[0] + 1, r[0]);
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  } finally {
    await handle.close();
  }
  await rename(tmp, target);
}

const tree = await getJson(`https://huggingface.co/api/models/${model.id}/tree/${model.revision}?recursive=true`);
const byPath = new Map(tree.map((entry) => [entry.path, entry]));
const t0 = Date.now();
let bytes = 0;
for (const { path: file, size: listed } of model.files) {
  const entry = byPath.get(file);
  if (!entry) throw new Error(`${file} is not in ${model.id} at ${model.revision}`);
  const size = entry.lfs?.size ?? entry.size;
  // The page relies on these sizes (fetch-length.ts), so model.json must match Hugging Face exactly.
  if (size !== listed) throw new Error(`${file}: model.json says ${listed} bytes, Hugging Face has ${size}`);
  const want = expectedHash(entry);
  const target = join(out, file);
  await mkdir(dirname(target), { recursive: true });
  const present = await stat(target).then((s) => s.size === size, () => false);
  if (present && (await hashOf(target, want.kind)) === want.hex) continue;
  await download(file, size, target);
  const got = await hashOf(target, want.kind);
  if (got !== want.hex) {
    await rm(target);
    throw new Error(`${file}: ${want.kind} ${got} does not match Hugging Face's ${want.hex}`);
  }
  bytes += size;
  console.log(`${file}: ${(size / 1e6).toFixed(1)} MB, ${want.kind} verified`);
}
const seconds = (Date.now() - t0) / 1000;
console.log(`model ready in ${out}: ${(bytes / 1e6).toFixed(0)} MB downloaded in ${seconds.toFixed(0)} s`);
