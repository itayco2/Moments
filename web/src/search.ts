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

// A moment is a run of consecutive matching windows: neighbours closer than this gap join one run, so a
// long shot shows up once (PREFLIGHT PF06, PF10). Same values as moments/search.py.
export const MERGE_GAP_S = 4;
export const CANDIDATE_POOL = 400;

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
  const pool = Array.from(scores.keys())
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, Math.max(CANDIDATE_POOL, k));
  // Walk the candidates in time order and cut a new run wherever the gap to the previous one is too big.
  const byTime = [...pool].sort((a, b) =>
    rows[a].video === rows[b].video ? rows[a].start - rows[b].start : rows[a].video < rows[b].video ? -1 : 1,
  );
  const runs: number[][] = [];
  let runEnd = 0;
  for (const i of byTime) {
    const last = runs.at(-1);
    if (last && rows[last.at(-1)!].video === rows[i].video && rows[i].start - runEnd <= MERGE_GAP_S) {
      last.push(i);
      runEnd = Math.max(runEnd, rows[i].end);
    } else {
      runs.push([i]);
      runEnd = rows[i].end;
    }
  }
  return runs
    .map((run) => run.reduce((best, j) => (scores[j] > scores[best] ? j : best)))
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, k)
    .map((i) => ({ ...rows[i], score: scores[i] }));
}

export function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) throw new Error("cannot normalize a zero vector");
  return v.map((x) => x / norm);
}
