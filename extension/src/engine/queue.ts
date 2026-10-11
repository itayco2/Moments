// Preview reads waiting for the one model: newest request first, bounded, one read per video however many tabs
// asked for it. Generic over the port type so it can be tested without a browser.
export const MAX_QUEUED_READS = 32;

export interface ReadRequest {
  videoId: string;
  duration: number;
  spec: string;
}
export interface ReadJob<P> extends ReadRequest {
  ports: Set<P>;
}

export class ReadQueue<P> {
  private waiting: ReadJob<P>[] = [];
  private active: ReadJob<P> | null = null;

  // A video that is being read or already waits just gains this port. Returns the job pushed out to stay within the cap.
  add(request: ReadRequest, port: P): ReadJob<P> | null {
    if (this.active?.videoId === request.videoId) {
      this.active.ports.add(port);
      return null;
    }
    const queued = this.waiting.findIndex((j) => j.videoId === request.videoId);
    const job = queued >= 0 ? this.waiting.splice(queued, 1)[0] : { ...request, ports: new Set<P>() };
    job.ports.add(port);
    this.waiting.push(job);
    return this.waiting.length > MAX_QUEUED_READS ? (this.waiting.shift() ?? null) : null;
  }

  // The most recently asked-for video becomes the running one.
  next(): ReadJob<P> | null {
    this.active = this.waiting.pop() ?? null;
    return this.active;
  }

  finish(): void {
    this.active = null;
  }
}
