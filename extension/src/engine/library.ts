// Each video's vectors in memory (the most recently used ones), saved to IndexedDB, merged after a full-detail
// read, and searched with the website's rule (web/src/search.ts, frame-counted hide window from PF21).
import { fp16ToFloat32 } from "../../../web/src/format";
import { type Row, search } from "../../../web/src/search";
import { toFp16 } from "../fp16";
import type { Hit } from "../protocol";
import { loadVideo, type SavedVideo, saveVideo, touchVideo } from "./store";

export interface Part {
  times: number[];
  vectors: Float32Array;
}
export type SavedKind = "preview" | "partial" | "full";
export interface Entry extends Part {
  kind: SavedKind;
  // Full detail covers 0:00 up to this time (0 for previews). In a partial entry, the frames after it are previews.
  readUntil: number;
  // A partial read the viewer stopped on purpose: never continued by itself (false for every other kind).
  viewerStopped: boolean;
  dim: number;
  rows: Row[];
}

export const DIM = 768;
// "No clear match" below this top score. The website's 0.74 was set on its NASA library; right answers on YouTube
// frames score lower, so the extension has its own line, set from the acceptance searches (EVAL.md).
export const WEAK_MATCH_YOUTUBE = 0.74;
export const isWeakYouTubeMatch = (topScore: number | undefined): boolean => topScore !== undefined && topScore < WEAK_MATCH_YOUTUBE;
// Vectors held in memory: about 100 MB for 50 hour-long videos read in full detail. Older ones reload from storage.
export const MAX_IN_MEMORY = 50;
const RESULTS = 6;
const EMPTY: Part = { times: [], vectors: new Float32Array(0) };

export function flatten(vectors: Float32Array[], dim: number): Float32Array {
  const out = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => out.set(v, i * dim));
  return out;
}

// The frames whose time passes `keep`, in order.
export function slicePart(part: Part, keep: (t: number) => boolean, dim: number): Part {
  const picked = part.times.flatMap((t, i) => (keep(t) ? [i] : []));
  const vectors = new Float32Array(picked.length * dim);
  picked.forEach((i, k) => vectors.set(part.vectors.subarray(i * dim, (i + 1) * dim), k * dim));
  return { times: picked.map((i) => part.times[i]), vectors };
}

function concat(a: Part, b: Part, dim: number): Part {
  const vectors = new Float32Array((a.times.length + b.times.length) * dim);
  vectors.set(a.vectors.subarray(0, a.times.length * dim));
  vectors.set(b.vectors.subarray(0, b.times.length * dim), a.times.length * dim);
  return { times: [...a.times, ...b.times], vectors };
}

// A full-detail read runs from the start; if it stopped early, the preview covers the rest of the video.
export function mergePartial(full: Part, preview: Part | null, dim: number): Part {
  if (!preview || full.times.length === 0) return full;
  const last = full.times[full.times.length - 1];
  return concat(full, slicePart(preview, (t) => t > last, dim), dim);
}

export interface FinishedRead {
  after: number | null; // null: read from 0:00; a time: continued a partial read that had reached it
  part: Part; // the frames that arrived, in order
  complete: boolean; // the tab went through every planned frame
  sent: number; // how many frames the tab sent
  byViewer: boolean; // the viewer stopped it (Skip, Esc, a player key, play)
}
export interface Merged {
  kind: "partial" | "full";
  readUntil: number;
  viewerStopped: boolean;
  part: Part;
}

// What a finished full-detail read leaves saved, or null when it adds nothing to what is saved. "full" only for a
// read that went through to the end and arrived whole, from 0:00 or joined to the partial read it continued. A
// partial result remembers whether the viewer stopped it; lost frames or any other stop count as not.
export function mergeRead(existing: Entry | null, read: FinishedRead, dim: number): Merged | null {
  if (existing?.kind === "full") return null; // a full read is never replaced
  let base = EMPTY; // full detail from 0:00 that this read continues
  let rest: Part | null = existing; // preview frames for what no full-detail read reached
  if (existing?.kind === "partial") {
    base = read.after === null ? EMPTY : slicePart(existing, (t) => t <= existing.readUntil, dim);
    rest = slicePart(existing, (t) => t > existing.readUntil, dim);
  }
  // The read it continues is gone (Forget all, the storage cap) or shorter than when it started: it cannot be joined.
  if (read.after !== null && (existing?.kind !== "partial" || existing.readUntil < read.after)) return null;
  const last = base.times.at(-1) ?? -1;
  const combined = concat(base, slicePart(read.part, (t) => t > last, dim), dim);
  if (combined.times.length === 0) return null;
  const readUntil = combined.times[combined.times.length - 1];
  if (read.complete && read.part.times.length === read.sent) return { kind: "full", readUntil, viewerStopped: false, part: combined };
  if (existing?.kind === "partial" && existing.readUntil >= readUntil) return null; // the saved one reaches further
  return { kind: "partial", readUntil, viewerStopped: read.byViewer, part: mergePartial(combined, rest, dim) };
}

// Whether a preview read would add anything: nothing saved yet, or a partial read with nothing after readUntil
// (background reading off, or no previews when it stopped), which would leave the rest of the video unsearchable.
export function needsPreviews(e: Entry | null): boolean {
  return e === null || (e.kind === "partial" && !e.times.some((t) => t > e.readUntil));
}

function entry(kind: SavedKind, readUntil: number, part: Part, dim: number, viewerStopped = false): Entry {
  return { kind, readUntil, viewerStopped: kind === "partial" && viewerStopped, dim, ...part, rows: part.times.map((t) => ({ video: "this", start: t, end: t + 1, thumb: "" })) };
}

// Older builds saved only "preview" and "full", without readUntil. A partial record without it cannot be continued,
// so it is read as previews and the next search reads the video again. A partial record without viewerStopped
// counts as stopped by something else, so it is continued.
export function fromSaved(saved: SavedVideo): Entry {
  const part = { times: Array.from(saved.times), vectors: fp16ToFloat32(saved.vectors) };
  const last = part.times.at(-1) ?? 0;
  if (saved.kind === "full") return entry("full", last, part, saved.dim);
  if (saved.kind === "partial" && typeof saved.readUntil === "number" && saved.readUntil >= 0) {
    return entry("partial", saved.readUntil, part, saved.dim, saved.viewerStopped === true);
  }
  return entry("preview", 0, part, saved.dim);
}

// A full-detail read that one tab is sending. It waits here until that tab finishes it or goes away.
interface Pending {
  after: number | null;
  stamp: number;
  times: number[];
  vectors: Float32Array[];
}

export class Library {
  private entries = new Map<string, Entry>(); // least recently used first
  private pending = new Map<object, Map<string, Pending>>(); // by tab, then video
  private generation = 0;
  private writing: Promise<unknown> = Promise.resolve();

  // Changes when everything is forgotten: a read that began before must not bring its video back.
  get stamp(): number {
    return this.generation;
  }

  async get(videoId: string): Promise<Entry | null> {
    const cached = this.entries.get(videoId);
    if (cached) {
      this.remember(videoId, cached);
      return cached;
    }
    const stamp = this.generation;
    const saved = await loadVideo(videoId).catch((err: unknown) => {
      console.warn("Moments: could not read the saved video", videoId, err);
      return undefined;
    });
    if (!saved || stamp !== this.generation) return null;
    const loaded = fromSaved(saved);
    this.remember(videoId, loaded);
    return loaded;
  }

  // A tab opened this video. A saved video is already marked by loading it; one served from memory is marked here, or
  // the storage cap would evict a video that is opened every day.
  async open(videoId: string): Promise<Entry | null> {
    if (!this.entries.has(videoId)) return this.get(videoId);
    await touchVideo(videoId).catch((err: unknown) => console.warn("Moments: could not mark the video as opened", videoId, err));
    return this.get(videoId);
  }

  // A preview read never replaces a full-detail read; after a partial one it fills in the rest of the video.
  putPreview(videoId: string, stamp: number, times: number[], vectors: Float32Array[]): Promise<Entry | null> {
    return this.serial(async () => {
      const existing = await this.get(videoId);
      const preview = { times, vectors: flatten(vectors, DIM) };
      if (existing?.kind === "full") return existing;
      if (existing?.kind === "partial") {
        const read = slicePart(existing, (t) => t <= existing.readUntil, DIM);
        return this.store(videoId, stamp, entry("partial", existing.readUntil, mergePartial(read, preview, DIM), DIM, existing.viewerStopped));
      }
      return this.store(videoId, stamp, entry("preview", 0, preview, DIM));
    });
  }

  // A tab starts a full-detail read of a video; whatever it had pending for that video is dropped.
  startFull(videoId: string, owner: object, after: number | null): void {
    const reads = this.pending.get(owner) ?? new Map<string, Pending>();
    reads.set(videoId, { after, stamp: this.generation, times: [], vectors: [] });
    this.pending.set(owner, reads);
  }

  isReading(videoId: string, owner: object): boolean {
    return this.pending.get(owner)?.has(videoId) ?? false;
  }

  // Frames join only a read their own tab started.
  addFull(videoId: string, owner: object, times: number[], vectors: Float32Array[]): boolean {
    const p = this.pending.get(owner)?.get(videoId);
    if (!p) return false;
    p.times.push(...times);
    p.vectors.push(...vectors);
    return true;
  }

  // The tab went away: what it sent of unfinished reads is a stale fragment.
  dropPending(owner: object): void {
    this.pending.delete(owner);
  }

  // Ends a tab's read and saves what it adds. Returns what is known about the video afterwards.
  finishFull(videoId: string, owner: object, end: { complete: boolean; sent: number; byViewer: boolean }): Promise<Entry | null> {
    const reads = this.pending.get(owner);
    const p = reads?.get(videoId);
    reads?.delete(videoId);
    if (reads?.size === 0) this.pending.delete(owner);
    if (!p || p.stamp !== this.generation) return this.get(videoId);
    return this.serial(async () => {
      const existing = await this.get(videoId);
      const read = { after: p.after, part: { times: p.times, vectors: flatten(p.vectors, DIM) }, ...end };
      const merged = mergeRead(existing, read, DIM);
      if (!merged) return existing;
      return this.store(videoId, p.stamp, entry(merged.kind, merged.readUntil, merged.part, DIM, merged.viewerStopped));
    });
  }

  find(e: Entry, query: Float32Array): { hits: Hit[]; weak: boolean } {
    const found = search(e.rows, e.vectors, e.dim, query, RESULTS);
    return { hits: found.map((h) => ({ start: h.start, end: h.end, score: h.score })), weak: isWeakYouTubeMatch(found[0]?.score) };
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }

  // Saves run one at a time, so each merge sees the one before it (two tabs can finish reads of one video together).
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writing.then(task, task);
    this.writing = run.catch(() => undefined);
    return run;
  }

  private remember(videoId: string, e: Entry): void {
    this.entries.delete(videoId);
    this.entries.set(videoId, e);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= MAX_IN_MEMORY) break;
      this.entries.delete(oldest);
    }
  }

  // Nothing is saved for a read that began before everything was forgotten.
  private async store(videoId: string, stamp: number, e: Entry): Promise<Entry | null> {
    if (stamp !== this.generation) return null;
    this.remember(videoId, e);
    const saved: SavedVideo = { videoId, kind: e.kind, readUntil: e.readUntil, viewerStopped: e.viewerStopped, dim: e.dim, times: Float32Array.from(e.times), vectors: toFp16(e.vectors) };
    await saveVideo(saved).catch((err: unknown) =>
      console.warn("Moments: storage refused, keeping this video for the session only", videoId, err),
    );
    return e;
  }
}
