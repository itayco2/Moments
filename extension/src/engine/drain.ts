// Running the engine's work so one failure never blocks what comes after it: the preview-read queue and the
// per-tab message order. Generic, so it is tested without a browser.
import type { ReadJob, ReadQueue } from "./queue";

export interface DrainDeps<P> {
  alive(port: P): boolean;
  read(job: ReadJob<P>): Promise<void>;
  failed(job: ReadJob<P>, err: unknown): void;
}

// One preview read at a time. A read that fails or times out (the model's calls have deadlines, PF26) is reported
// and the next one starts; the engine is never left "reading" with nothing running.
export class Drainer<P> {
  private reading = false;

  constructor(
    private readonly queue: ReadQueue<P>,
    private readonly deps: DrainDeps<P>,
  ) {}

  get busy(): boolean {
    return this.reading;
  }

  async drain(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      for (let job = this.queue.next(); job; job = this.queue.next()) {
        if (![...job.ports].some((p) => this.deps.alive(p))) continue; // every tab that asked has gone
        await this.deps.read(job).catch((err: unknown) => this.deps.failed(job, err));
      }
    } finally {
      this.queue.finish();
      this.reading = false;
    }
  }
}

type Task = () => Promise<void>;
type OnFailure = (err: unknown) => void | Promise<void>;

// Runs tasks one after another, in the order given: a tab's frames must be embedded before its read is finished.
// A task that fails is reported and the next one still runs, also when the report itself fails.
export function inOrder(): (task: Task, failed: OnFailure) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  return (task, failed) => {
    chain = chain
      .then(task)
      .catch(failed)
      .catch((err: unknown) => console.warn("Moments: could not report a failure", err));
    return chain;
  };
}
