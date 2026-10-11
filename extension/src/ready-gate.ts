// Lets the service worker wait until the engine page says it is listening. An announcement that arrives before
// anyone waits is remembered until the next page is created.
export class ReadyGate {
  private ready = false;
  private waiting = new Set<() => void>();

  constructor(
    private readonly timeoutMs: number,
    private readonly what: string,
  ) {}

  // A new page is about to be created: forget that the old one announced itself.
  reset(): void {
    this.ready = false;
  }

  announce(): void {
    this.ready = true;
    for (const wake of this.waiting) wake();
    this.waiting.clear();
  }

  wait(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiting.delete(wake);
        reject(new Error(`${this.what} did not announce itself within ${this.timeoutMs / 1000} s`));
      }, this.timeoutMs);
      this.waiting.add(wake);
    });
  }
}
