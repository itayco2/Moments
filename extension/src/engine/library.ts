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
