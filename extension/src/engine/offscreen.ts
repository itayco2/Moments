// The engine: one model for the whole browser. Talks to content scripts over "moments" ports and to the popup
// over runtime messages.
import { IMAGES_PER_BATCH } from "../../../web/src/config";
import { Embedder } from "../../../web/src/embedder";
import { type FromEngine, parseToEngine, type StateMessage, type ToEngine } from "../protocol";
import { bestLevel, parseSpec } from "../storyboard";
import { Drainer, inOrder } from "./drain";
import { type Entry, Library } from "./library";
import { ModelHost } from "./model";
import { type ReadJob, ReadQueue } from "./queue";
import { failureReplies, knownState, NOTHING } from "./replies";
import { decodeFrames, previewTiles, readSheets } from "./sheets";
import { forgetAll, usage } from "./store";

type Port = chrome.runtime.Port;
type OpenMessage = Extract<ToEngine, { type: "open" }>;

const ports = new Set<Port>();
const library = new Library();
const queue = new ReadQueue<Port>();

const send = (port: Port, m: FromEngine) => {
  try {
    port.postMessage(m);
  } catch {
    ports.delete(port); // the tab went away
  }
};
const broadcast = (m: FromEngine) => ports.forEach((p) => send(p, m));
const blank = (videoId: string, patch: Partial<StateMessage> = {}): StateMessage => ({
  type: "state",
  videoId,
  kind: "none",
  readUntil: 0,
  viewerStopped: false,
  reading: null,
  done: 0,
  total: 0,
  problem: null,
  message: "",
  ...patch,
});
const described = (videoId: string, e: Entry | null): StateMessage => (e ? knownState(videoId, e) : blank(videoId));

const model = new ModelHost(() => new Embedder(), broadcast);
// Without WebGPU the model runs on the CPU: much slower, so videos are read only when the viewer searches them.
const onCpu = () => model.state.device === "wasm";

const reads = new Drainer(queue, {
  alive: (p) => ports.has(p),
  read: readJob,
  failed: (job, err) => {
    console.warn("Moments: preview read failed", job.videoId, err);
    job.ports.forEach((p) => send(p, blank(job.videoId, { problem: "error", message: String(err) })));
  },
});

async function readJob(job: ReadJob<Port>): Promise<void> {
  const known = await library.get(job.videoId);
  if (known) {
    job.ports.forEach((p) => send(p, knownState(job.videoId, known))); // it was read while this job waited
    return;
  }
  await previewRead(job);
}

// Every tab that asked for this video hears about the read, including tabs that joined while it was running.
async function previewRead(job: ReadJob<Port>): Promise<void> {
  const { videoId, duration, spec } = job;
  const tell = (s: StateMessage) => job.ports.forEach((port) => send(port, s));
  const sb = parseSpec(spec);
  const level = sb && sb.videoId === videoId ? bestLevel(sb) : null;
  const list = sb && level ? previewTiles(sb, level, duration) : null;
  if (!list) {
    tell(blank(videoId, { problem: "no-previews" }));
    return;
  }
  const stamp = library.stamp;
  await model.ensure();
  if (onCpu()) {
    tell(blank(videoId));
    return;
  }
  const times: number[] = [];
  const vectors: Float32Array[] = [];
  for await (const batch of readSheets(list, IMAGES_PER_BATCH)) {
    vectors.push(...(await model.use((e) => e.embedImages(batch.images))));
    times.push(...batch.times);
    tell(blank(videoId, { reading: "preview", done: times.length, total: list.length }));
  }
  tell(described(videoId, await library.putPreview(videoId, stamp, times, vectors)));
}

const TOO_MANY_WAITING = "Too many videos are waiting to be read. Open this one again in a moment.";

async function openVideo(port: Port, m: OpenMessage): Promise<void> {
  // A tab opening a video, or its Try again, retries a model that failed.
  void model.retry().catch(() => undefined);
  const known = await library.open(m.videoId);
  if (known) {
    send(port, knownState(m.videoId, known));
    return;
  }
  send(port, blank(m.videoId, { problem: m.spec ? null : "no-previews" }));
  if (!m.autoRead || !m.spec || onCpu()) return;
  const dropped = queue.add({ videoId: m.videoId, duration: m.duration, spec: m.spec }, port);
  dropped?.ports.forEach((p) => send(p, blank(dropped.videoId, { problem: "error", message: TOO_MANY_WAITING })));
  void reads.drain();
}

async function handle(port: Port, m: ToEngine): Promise<void> {
  switch (m.type) {
    case "open":
      return openVideo(port, m);
    case "search": {
      const query = await model.use((e) => e.embedText(m.query));
      const found = await library.get(m.videoId);
      const answer = found ? library.find(found, query) : { hits: [], weak: false };
      send(port, { type: "results", id: m.id, videoId: m.videoId, kind: found?.kind ?? "none", readUntil: found?.readUntil ?? 0, viewerStopped: found?.viewerStopped ?? false, ...answer, failed: false });
      return;
    }
    case "full-start":
      library.startFull(m.videoId, port, m.after);
      return;
    case "full-frames": {
      if (!ports.has(port) || !library.isReading(m.videoId, port)) return; // no read of this tab's is open: stale frames
      const images = await decodeFrames(m.frames);
      const vectors = await model.use((e) => e.embedImages(images));
      library.addFull(m.videoId, port, m.frames.map((f) => f.t), vectors);
      return;
    }
    case "full-end":
      send(port, described(m.videoId, await library.finishFull(m.videoId, port, { complete: m.complete, sent: m.sent, byViewer: m.byViewer })));
      return;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "moments") return;
  ports.add(port);
  send(port, model.state);
  // Messages from one tab run in order: frames must be embedded before the read is finished. A message that fails is
  // answered with the failure (a search under its id), and the next one runs.
  const run = inOrder();
  port.onMessage.addListener((raw: unknown) => {
    const m = parseToEngine(raw);
    if (!m) {
      console.warn("Moments: ignored a malformed message");
      return;
    }
    void run(
      () => handle(port, m),
      async (err: unknown) => {
        console.warn("Moments: engine error", err);
        const known = (await library.get(m.videoId).catch(() => null)) ?? NOTHING;
        failureReplies(m, known, err).forEach((reply) => send(port, reply));
      },
    );
  });
  // Frames already sent are handled first; whatever is left of an unfinished full-detail read is a stale fragment.
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    void run(
      async () => library.dropPending(port),
      () => undefined,
    );
  });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only the popup, an extension page and not a tab, may read the stats or forget everything.
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (msg?.type === "stats") {
    const answer = async () =>
      reply({ phase: model.state.phase, device: model.state.device, message: model.state.message, ...(await usage().catch(() => ({ videos: 0, bytes: 0 }))) });
    (msg.load ? model.ensure().then(() => undefined, () => undefined) : Promise.resolve()).then(answer);
    return true;
  }
  if (msg?.type === "forget-all") {
    library.clear(); // reads still running save nothing (library.ts, stamp)
    forgetAll().then(
      () => reply({ ok: true }),
      (err: unknown) => reply({ ok: false, message: String(err) }),
    );
    return true;
  }
  return false;
});

// Last of all, once every listener above exists: Chrome can refuse a message or port that arrives before the module
// has finished evaluating, so the service worker waits for this before it says the engine is there.
chrome.runtime.sendMessage({ type: "engine:ready" }).catch(() => undefined);
