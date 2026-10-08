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

// A moment grows from its best window through time-adjacent neighbours (gap <= MERGE_GAP_S) whose score stays
// within RUN_MARGIN_FRACTION of the way from the peak down to the median score; the moment and HIDE_S around it
// are then hidden from later results (PF06, PF10, PF11). Same rule and values as moments/search.py, where the
// values were chosen by scripts/sweep_merge.py.
export const MERGE_GAP_S = 4;
export const RUN_MARGIN_FRACTION = 0.4;
export const HIDE_S = 16;

export function median(values: Float32Array): number {
  const sorted = Float32Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const neighbourCache = new WeakMap<Row[], { prev: Int32Array; next: Int32Array }>();

// Previous and next row of the same video in time order (-1 at the ends), computed once per library.
export function neighbours(rows: Row[]): { prev: Int32Array; next: Int32Array } {
  const cached = neighbourCache.get(rows);
  if (cached) return cached;
  const order = Array.from(rows.keys()).sort((a, b) =>
    rows[a].video === rows[b].video ? rows[a].start - rows[b].start : rows[a].video < rows[b].video ? -1 : 1,
  );
  const prev = new Int32Array(rows.length).fill(-1);
  const next = new Int32Array(rows.length).fill(-1);
  for (let j = 1; j < order.length; j++) {
    const [a, b] = [order[j - 1], order[j]];
    if (rows[a].video === rows[b].video) {
      next[a] = b;
      prev[b] = a;
    }
  }
  const result = { prev, next };
  neighbourCache.set(rows, result);
  return result;
}

const adjacent = (rows: Row[], a: number, b: number) => rows[b].start - rows[a].end <= MERGE_GAP_S;

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
  const { prev, next } = neighbours(rows);
  const mid = median(scores);
  const hidden = new Uint8Array(rows.length);
  const hits: Hit[] = [];
  for (const i of Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a])) {
    if (hidden[i]) continue;
    hits.push({ ...rows[i], score: scores[i] });
    if (hits.length === k) break;
    const floor = scores[i] - RUN_MARGIN_FRACTION * (scores[i] - mid);
    let lo = i;
    let hi = i;
    while (prev[lo] >= 0 && adjacent(rows, prev[lo], lo) && scores[prev[lo]] >= floor) lo = prev[lo];
    while (next[hi] >= 0 && adjacent(rows, hi, next[hi]) && scores[next[hi]] >= floor) hi = next[hi];
    const start = rows[lo].start;
    const end = rows[hi].end;
    for (let j = lo; j >= 0 && rows[j].end > start - HIDE_S; j = prev[j]) hidden[j] = 1;
    for (let j = lo; j >= 0 && rows[j].start < end + HIDE_S; j = next[j]) hidden[j] = 1;
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
