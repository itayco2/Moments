// The same search as moments/search.py: score every moment, then keep the best non-adjacent ones.

export interface Row {
  video: string;
  start: number;
  end: number;
  thumb: string;
}

export interface Hit extends Row {
  score: number;
}

// Moments within this many seconds of a kept result belong to it, and the kept span grows as they are
// absorbed, so one long shot becomes one result instead of filling the list (PREFLIGHT PF06).
export const MERGE_GAP_S = 4;

export function dotAll(vectors: Float32Array, dim: number, query: Float32Array): Float32Array {
  if (query.length !== dim) throw new Error(`query has ${query.length} dims, the library has ${dim}`);
  const n = vectors.length / dim;
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * dim;
    for (let d = 0; d < dim; d++) s += vectors[base + d] * query[d];
    scores[i] = s;
  }
  return scores;
}

export function search(rows: Row[], vectors: Float32Array, dim: number, query: Float32Array, k: number): Hit[] {
  if (rows.length * dim !== vectors.length) {
    throw new Error(`${rows.length} rows but ${vectors.length / dim} vectors`);
  }
  const scores = dotAll(vectors, dim, query);
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
  const hits: Hit[] = [];
  const spans: { video: string; lo: number; hi: number }[] = [];
  for (const i of order) {
    const row = rows[i];
    const near = spans.find(
      (s) => s.video === row.video && row.start < s.hi + MERGE_GAP_S && s.lo < row.end + MERGE_GAP_S,
    );
    if (near) {
      near.lo = Math.min(near.lo, row.start);
      near.hi = Math.max(near.hi, row.end);
      continue;
    }
    hits.push({ ...row, score: scores[i] });
    spans.push({ video: row.video, lo: row.start, hi: row.end });
    if (hits.length === k) break;
  }
  return hits;
}

export function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) throw new Error("cannot normalize a zero vector");
  return v.map((x) => x / norm);
}
