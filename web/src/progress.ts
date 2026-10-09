// Combines transformers.js per-file download events into one "loaded of total" for the progress bar.

export interface FileProgress {
  file: string;
  loaded: number;
  total: number;
}

export class DownloadTally {
  private files = new Map<string, { loaded: number; total: number }>();

  update(p: FileProgress): void {
    const known = this.files.get(p.file);
    const total = Math.max(p.total, known?.total ?? 0);
    this.files.set(p.file, { loaded: Math.min(Math.max(p.loaded, known?.loaded ?? 0), total), total });
  }

  done(file: string): void {
    const known = this.files.get(file);
    if (known) this.files.set(file, { loaded: known.total, total: known.total });
  }

  get loaded(): number {
    let sum = 0;
    for (const f of this.files.values()) sum += f.loaded;
    return sum;
  }

  get total(): number {
    let sum = 0;
    for (const f of this.files.values()) sum += f.total;
    return sum;
  }

  get fraction(): number {
    return this.total ? this.loaded / this.total : 0;
  }
}

const MIN_ELAPSED_FOR_RATE_S = 2;

// One line for the download: what it is, how far, how fast, and how long is left. At 100% the bytes are in but
// the model still has to be set up on the GPU, which takes a while and used to look like a stalled download.
export function downloadStatus(loaded: number, total: number, elapsedS: number): string {
  if (total <= 0) return "Starting the AI model download";
  if (loaded >= total) return "Preparing the AI model on your GPU";
  const mb = (bytes: number) => Math.round(bytes / 1e6);
  const line = `Downloading the AI model to this browser, once: ${mb(loaded)} of ${mb(total)} MB`;
  if (elapsedS < MIN_ELAPSED_FOR_RATE_S || loaded <= 0) return line;
  const rate = loaded / elapsedS;
  const left = (total - loaded) / rate;
  const seconds = Math.ceil(left / 5) * 5;
  const eta = seconds < 60 ? `${seconds} s` : `${Math.ceil(left / 60)} min`;
  return `${line}, ${(rate / 1e6).toFixed(1)} MB/s, about ${eta} left`;
}
