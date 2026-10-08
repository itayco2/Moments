// The page: the NASA demo library, your own library, the search box, and the player.

import "./styles.css";
import { IMAGES_PER_BATCH } from "./config";
import { Embedder } from "./embedder";
import { clock, megabytes } from "./format";
import { grabFrames } from "./frames";
import {
  type DemoJson,
  type Example,
  type Library,
  type VideoInfo,
  displayName,
  emptyLibrary,
  fileKey,
  parseDemo,
  withSource,
  withVideo,
} from "./library";
import { type Hit, isWeakMatch, type Row, search } from "./search";
import { clearVideos, loadVideos, saveVideo } from "./store";
import { $, el, message, renderHits, setBar } from "./ui";

const DEMO_BASE = `${import.meta.env.BASE_URL}demo/`;
const DIM = 768;
const K = 6;
const LOOP_TAIL_S = 2;
const TYPE_DELAY_MS = 45;

type Mode = "demo" | "own";
let mode: Mode = "demo";
let demo: { library: Library; examples: Example[] } | null = null;
let own: Library = emptyLibrary("Your videos", DIM);
let current: { hit: Hit; info: VideoInfo } | null = null;
let embedder: Embedder | null = null;
let indexing = false;
let typing: number | undefined;

const video = $<HTMLVideoElement>("video");
const input = $<HTMLInputElement>("q");
const setModel = (text: string) => ($("model").textContent = text);
const setOwnStatus = (text: string) => ($("ownStatus").textContent = text);
const activeLibrary = (): Library | null => (mode === "demo" ? (demo?.library ?? null) : own);

// ---------- model ----------

function getEmbedder(): Embedder {
  if (!embedder) {
    embedder = new Embedder();
    embedder.onProgress = (loaded, total) =>
      setModel(`Search model: downloading ${megabytes(loaded)} of ${megabytes(total)} (once, then cached)`);
  }
  return embedder;
}

async function ensureModel(vision: boolean): Promise<Embedder> {
  const e = getEmbedder();
  if (e.device && (e.vision || !vision)) return e;
  setModel(vision ? "Loading the picture model (about 370 MB the first time)" : "Loading the search model");
  await e.load(vision);
  setModel(`Search model ready, running ${e.device === "webgpu" ? "on your GPU" : "on your CPU (slower)"}`);
  return e;
}

// ---------- search and playback ----------

async function runSearch(query: string, preset?: Float32Array): Promise<void> {
  query = query.trim();
  if (!query) return;
  const lib = activeLibrary();
  if (!lib) return showEmpty("The demo library is still loading.");
  if (!lib.rows.length) return showEmpty("Add some videos first: drop them in the box above.");
  $("timing").textContent = "searching";
  try {
    const e = preset ? null : await ensureModel(mode === "own");
    const t0 = performance.now();
    const vector = preset ?? (await e!.embedText(query));
    const hits = search(lib.rows, lib.vectors, lib.dim, vector, K);
    const ms = `${Math.max(1, Math.round(performance.now() - t0))} ms`;
    const weak = isWeakMatch(hits);
    $("timing").textContent = weak ? `weak match · ${ms}` : ms;
    $("timing").classList.toggle("weak", weak);
    const rows = renderHits($("results"), hits, lib.videos, (hit, row) => play(hit, lib.videos[hit.video], rows, row));
    if (hits.length) play(hits[0], lib.videos[hits[0].video], rows, rows[0]);
  } catch (err) {
    $("timing").textContent = "";
    showEmpty(`Search failed: ${message(err)}`);
  }
}

function showEmpty(text: string): void {
  $("results").replaceChildren(el("p", "empty", text));
}

function play(hit: Hit, info: VideoInfo | undefined, rows: HTMLElement[], row: HTMLElement): void {
  rows.forEach((r) => r.classList.toggle("active", r === row));
  if (!info) return;
  $("nowName").textContent = info.display;
  if (!info.src) {
    current = null;
    $("nowAt").textContent = "choose this file again above to play it";
    return;
  }
  current = { hit, info };
  $("nowAt").textContent = `${clock(hit.start)} of ${clock(info.duration)}`;
  const moment = $("moment");
  moment.hidden = $("head").hidden = false;
  moment.style.left = `${(hit.start / info.duration) * 100}%`;
  moment.style.width = `${(Math.max(hit.end - hit.start, 1) / info.duration) * 100}%`;
  const seek = () => {
    video.currentTime = hit.start;
    video.play().catch(() => undefined);
  };
  if (video.getAttribute("src") !== info.src) {
    video.setAttribute("src", info.src);
    video.addEventListener("loadedmetadata", seek, { once: true });
  } else seek();
}

video.addEventListener("timeupdate", () => {
  if (!current) return;
  $("head").style.left = `calc(${(video.currentTime / current.info.duration) * 100}% - 2px)`;
  const loopEnd = Math.max(current.hit.end, current.hit.start + 6) + LOOP_TAIL_S;
  if (video.currentTime > loopEnd) video.currentTime = current.hit.start;
});

function typeThenSearch(text: string, vector: Float32Array): void {
  clearInterval(typing);
  input.value = "";
  let i = 0;
  typing = window.setInterval(() => {
    input.value = text.slice(0, ++i);
    if (i >= text.length) {
      clearInterval(typing);
      void runSearch(text, vector);
    }
  }, TYPE_DELAY_MS);
}

// ---------- the two libraries ----------

async function loadDemo(): Promise<void> {
  const [json, bytes] = await Promise.all([
    fetch(`${DEMO_BASE}library.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText)))),
    fetch(`${DEMO_BASE}vectors.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)))),
  ]);
  demo = parseDemo(json as DemoJson, bytes, DEMO_BASE);
  renderChips();
  renderStats();
  setModel("Examples answer instantly. Your own words download the search model once (about 175 MB).");
}

function renderChips(): void {
  const box = $("chips");
  box.replaceChildren();
  if (mode !== "demo" || !demo) return;
  for (const ex of demo.examples) {
    const chip = el("button", "chip", ex.query);
    chip.type = "button";
    chip.addEventListener("click", () => typeThenSearch(ex.query, ex.vector));
    box.append(chip);
  }
}

function renderStats(): void {
  const lib = activeLibrary();
  if (!lib) return;
  const videos = Object.values(lib.videos);
  const seconds = videos.reduce((sum, v) => sum + v.duration, 0);
  const what = mode === "demo" ? "of NASA footage" : "of your video";
  $("stats").textContent = videos.length
    ? `${clock(seconds)} ${what} · ${videos.length} videos · ${lib.rows.length.toLocaleString()} moments`
    : "";
}

async function restoreOwn(): Promise<void> {
  try {
    for (const saved of await loadVideos()) {
      const rows: Row[] = saved.times.map((t, i) => ({
        video: saved.key,
        ...t,
        thumb: URL.createObjectURL(saved.thumbs[i]),
      }));
      const vectors = rows.map((_, i) => saved.vectors.slice(i * saved.dim, (i + 1) * saved.dim));
      own = withVideo(own, { key: saved.key, display: saved.display, duration: saved.duration, src: null }, rows, vectors);
    }
  } catch (err) {
    setOwnStatus(`Your saved library could not be read: ${message(err)}`);
  }
  updateOwnPanel();
}

function updateOwnPanel(): void {
  const n = Object.keys(own.videos).length;
  $("clear").hidden = n === 0;
  if (!indexing) setOwnStatus(n ? `${n} videos indexed. Type to search them.` : "");
  if (mode === "own") renderStats();
}

async function addFiles(files: File[]): Promise<void> {
  if (indexing || !files.length) return;
  indexing = true;
  try {
    const e = await ensureModel(true);
    for (const [n, file] of files.entries()) {
      const key = fileKey(file);
      const url = URL.createObjectURL(file);
      if (own.videos[key]) own = withSource(own, key, url);
      else await indexFile(e, file, key, url, `${n + 1} of ${files.length}`);
    }
  } catch (err) {
    setOwnStatus(`Could not index: ${message(err)}`);
  } finally {
    indexing = false;
    $("indexBar").hidden = true;
    updateOwnPanel();
  }
}

async function indexFile(e: Embedder, file: File, key: string, url: string, which: string): Promise<void> {
  const name = displayName(file.name);
  const rows: Row[] = [];
  const vectors: Float32Array[] = [];
  const thumbs: Blob[] = [];
  let pending: { t: number; image: ImageData; thumb: Blob }[] = [];
  let duration = 0;
  const bar = $("indexBar");
  bar.hidden = false;
  const t0 = performance.now();
  // The model works on one batch while the next batch's frames are grabbed: seeking is the slow half.
  let inflight: Promise<void> | null = null;
  let grabbed = 0;
  const embedBatch = async (batch: typeof pending) => {
    const vs = await e.embedImages(batch.map((p) => p.image));
    batch.forEach((p, i) => {
      rows.push({ video: key, start: p.t, end: p.t + 1, thumb: URL.createObjectURL(p.thumb) });
      vectors.push(vs[i]);
      thumbs.push(p.thumb);
    });
  };
  const schedule = async (batch: typeof pending) => {
    if (inflight) await inflight;
    inflight = embedBatch(batch);
  };
  for await (const g of grabFrames(file)) {
    duration = g.duration;
    pending.push(g);
    grabbed++;
    if (pending.length === IMAGES_PER_BATCH) {
      await schedule(pending);
      pending = [];
    }
    setBar(bar, grabbed / g.total);
    const rate = grabbed / ((performance.now() - t0) / 1000);
    setOwnStatus(`Indexing ${name} (${which}): ${grabbed} of ${g.total} frames, ${rate.toFixed(1)} per second`);
  }
  if (pending.length) await schedule(pending);
  if (inflight) await inflight;
  own = withVideo(own, { key, display: name, duration, src: url }, rows, vectors);
  const flat = new Float32Array(vectors.length * DIM);
  vectors.forEach((v, i) => flat.set(v, i * DIM));
  const times = rows.map((r) => ({ start: r.start, end: r.end }));
  await saveVideo({ key, display: name, duration, dim: DIM, times, vectors: flat, thumbs }).catch((err) =>
    setOwnStatus(`Indexed ${name}, but it could not be saved for next time: ${message(err)}`),
  );
}

// ---------- wiring ----------

// Each tab starts clean: no query, no playing video from the other library.
function resetPlayer(): void {
  clearInterval(typing);
  current = null;
  input.value = "";
  $("timing").textContent = "";
  $("timing").classList.remove("weak");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("nowName").textContent = "Nothing playing yet";
  $("nowAt").textContent = "";
  $("moment").hidden = $("head").hidden = true;
}

function setMode(next: Mode): void {
  mode = next;
  $("tabDemo").classList.toggle("on", mode === "demo");
  $("tabOwn").classList.toggle("on", mode === "own");
  $("own").hidden = mode !== "own";
  resetPlayer();
  showEmpty(mode === "demo" ? "Results show up here." : "Search your videos once they are indexed.");
  renderChips();
  renderStats();
  const e = embedder;
  if (e?.device && (mode === "demo" || e.vision)) {
    setModel(`Search model ready, running ${e.device === "webgpu" ? "on your GPU" : "on your CPU (slower)"}`);
  } else if (mode === "demo") {
    setModel("Examples answer instantly. Your own words download the search model once (about 175 MB).");
  } else {
    setModel("Your videos are indexed in this browser. The first time downloads the picture model (about 370 MB).");
  }
  if (mode === "own") updateOwnPanel();
}

$("tabDemo").addEventListener("click", () => setMode("demo"));
$("tabOwn").addEventListener("click", () => setMode("own"));
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void runSearch(input.value);
});
// Start the one-time model download when someone shows intent to type, not on every page view.
input.addEventListener("focus", () => void ensureModel(mode === "own").catch((err) => setModel(message(err))), {
  once: true,
});

const drop = $("drop");
const files = $<HTMLInputElement>("files");
files.addEventListener("change", () => void addFiles(Array.from(files.files ?? [])));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  void addFiles(Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("video/")));
});
$("clear").addEventListener("click", async () => {
  await clearVideos().catch(() => undefined);
  own = emptyLibrary("Your videos", DIM);
  showEmpty("Search your videos once they are indexed.");
  updateOwnPanel();
});

loadDemo().catch((err) => showEmpty(`The demo library could not load: ${message(err)}`));
void restoreOwn();
