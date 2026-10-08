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
