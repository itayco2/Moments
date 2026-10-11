// How much a saved video costs and which videos go when the cap is reached. Pure.
export const CAP_BYTES = 200_000_000;

export interface StoredMeta {
  videoId: string;
  bytes: number;
  lastOpened: number;
}

// fp16 vector plus a 4-byte time per moment.
export const entryBytes = (frames: number, dim: number): number => frames * (dim * 2 + 4);

export function evict(entries: StoredMeta[], cap = CAP_BYTES): string[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => a.lastOpened - b.lastOpened)) {
    if (total <= cap) break;
    out.push(e.videoId);
    total -= e.bytes;
  }
  return out;
}
