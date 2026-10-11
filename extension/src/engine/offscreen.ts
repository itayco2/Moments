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
