// The tab's line to the engine. Wakes the engine first. When the line drops it says so (the tab clears what was
// waiting on it), and connects again when the tab asks, a few times before it reports that it could not.
import type { FromEngine, ToEngine } from "../protocol";

const RECONNECT_TRIES = 5;
const RECONNECT_DELAY_MS = 200; // times the attempt number
// A line that lasted this long was healthy: the next drop starts a fresh set of tries. A line that keeps dropping
// sooner (an engine that crashes while loading) runs out of tries instead of reconnecting forever.
const STABLE_MS = 30_000;

export class EngineLink {
  private port: chrome.runtime.Port | null = null;
  private connecting: Promise<chrome.runtime.Port> | null = null;
  private retries = 0;
  private readonly listeners = new Set<(m: FromEngine) => void>();
  private readonly reconnected = new Set<() => void>();
  private readonly dropped = new Set<() => void>();
  private readonly failed = new Set<(err: unknown) => void>();

  onMessage(fn: (m: FromEngine) => void): void {
    this.listeners.add(fn);
  }

  // A line made again by reconnect(), not the first one: the tab tells the engine about its video once more.
  onConnect(fn: () => void): void {
    this.reconnected.add(fn);
  }

  onDisconnect(fn: () => void): void {
    this.dropped.add(fn);
  }

  onError(fn: (err: unknown) => void): void {
    this.failed.add(fn);
  }

  async send(m: ToEngine): Promise<void> {
    (await this.connect()).postMessage(m);
  }

  reconnect(): void {
    if (this.retries >= RECONNECT_TRIES) {
      this.failed.forEach((fn) => fn(new Error("the Moments engine keeps stopping")));
      return;
    }
    this.retries++;
    setTimeout(() => {
      this.connect().then(
        () => this.reconnected.forEach((fn) => fn()),
        (err: unknown) => this.failed.forEach((fn) => fn(err)),
      );
    }, RECONNECT_DELAY_MS * this.retries);
  }

  // The viewer pressed Try again: a fresh set of tries.
  resetRetries(): void {
    this.retries = 0;
  }

  private connect(): Promise<chrome.runtime.Port> {
    if (this.port) return Promise.resolve(this.port);
    this.connecting ??= (async () => {
      const answer = await chrome.runtime.sendMessage({ type: "engine:ensure" });
      if (!answer?.ok) throw new Error(answer?.message ?? "the Moments engine did not start");
      const port = chrome.runtime.connect({ name: "moments" });
      const opened = Date.now();
      port.onMessage.addListener((m: FromEngine) => this.listeners.forEach((fn) => fn(m)));
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError; // read it, so Chrome does not report it as unchecked
        if (this.port === port) this.port = null;
        if (Date.now() - opened >= STABLE_MS) this.retries = 0;
        this.dropped.forEach((fn) => fn());
      });
      this.port = port;
      return port;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
}
