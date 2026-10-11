// The tab's line to the engine. Wakes the engine first; reconnects if Chrome unloaded it.
import type { FromEngine, ToEngine } from "../protocol";

// A port that closes before the engine's first message (its model state) never reached a listening engine:
// connect again a few times and let the connect hook send `open` once more.
const RECONNECT_TRIES = 5;
const RECONNECT_DELAY_MS = 200;

export class EngineLink {
  private port: chrome.runtime.Port | null = null;
  private connecting: Promise<chrome.runtime.Port> | null = null;
  private retries = 0;
  private readonly listeners = new Set<(m: FromEngine) => void>();
  private readonly connected = new Set<() => void>();

  onMessage(fn: (m: FromEngine) => void): void {
    this.listeners.add(fn);
  }

  onConnect(fn: () => void): void {
    this.connected.add(fn);
  }

  async send(m: ToEngine): Promise<void> {
    (await this.connect()).postMessage(m);
  }

  private connect(): Promise<chrome.runtime.Port> {
    if (this.port) return Promise.resolve(this.port);
    this.connecting ??= (async () => {
      const answer = await chrome.runtime.sendMessage({ type: "engine:ensure" });
      if (!answer?.ok) throw new Error(answer?.message ?? "the Moments engine did not start");
      const port = chrome.runtime.connect({ name: "moments" });
      let heard = false;
      port.onMessage.addListener((m: FromEngine) => {
        heard = true;
        this.retries = 0;
        this.listeners.forEach((fn) => fn(m));
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError; // read it, so Chrome does not report it as unchecked
        if (this.port === port) this.port = null;
        if (!heard) this.reconnectSoon();
      });
      this.port = port;
      queueMicrotask(() => this.connected.forEach((fn) => fn()));
      return port;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private reconnectSoon(): void {
    if (this.retries >= RECONNECT_TRIES) return;
    this.retries++;
    setTimeout(() => void this.connect().catch((err: unknown) => console.warn("Moments: could not reach the engine", err)), RECONNECT_DELAY_MS);
  }
}
