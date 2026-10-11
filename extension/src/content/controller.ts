// What the bar does on a YouTube tab: what it tells the engine, when it reads a video in full detail, where it
// jumps. It reaches the page and the engine only through ControllerDeps, so it is tested without a browser.
//
// YouTube plays ads and the next video in the viewer's one <video>, so every read and every jump first waits for
// the player to hold this video (no ad, YouTube's length for it) and checks again after every wait (PF27, PF28).
import { frameTimes } from "../../../web/src/frames";
import type { FromEngine, Kind, ModelMessage, StateMessage, ToEngine, VideoInfo } from "../protocol";
import type { Settings } from "../settings";
import { type Action, type BarState, initialState, type Notice, reduce } from "./bar-state";
import { fullRead, type ReadOutcome, type Seekable } from "./full-read";

export interface PlayerVideo extends Seekable {
  readonly duration: number;
  readonly src: string;
}

export interface EngineLine {
  send(m: ToEngine): Promise<void>;
  reconnect(): void;
  resetRetries(): void;
}

export interface ControllerDeps {
  link: EngineLine;
  video(): PlayerVideo | null;
  isAd(): boolean;
  capture(video: PlayerVideo): () => string | null;
  render(s: BarState, elapsedS: number, duration: number): void;
  readSettings(): Promise<Settings>;
  extensionAlive(): boolean; // false once the extension was updated or removed under this page
  onWatchPage(): boolean;
  now?(): number;
  pollMs?: number;
  seekTimeoutMs?: number;
}

type Stop = "viewer" | "navigation" | "engine";
interface Reading {
  videoId: string;
  abort: AbortController;
  why: Stop | null;
  ended: Promise<void>;
}

export const UPDATED = "Moments was updated: reload this page to keep using it.";
export const RECONNECTING = "Lost the line to Moments. Reconnecting.";
const LENGTH_TOLERANCE_S = 2; // YouTube's length is whole seconds; the player's has a fraction
const LENGTH_CHECKS = 10; // about 5 s for the video to load after an ad before a read gives up
const POLL_MS = 500;
const MAX_REASON_CHARS = 160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reason = (err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 3)}...` : text;
};

export class Controller {
  state: BarState = initialState;
  private info: VideoInfo | null = null;
  private navigating = false;
  private searchId = 0;
  private quietSearch = -1; // the search sent again after a read the viewer stopped: show its answer, do not jump
  private viewerStopped: string | null = null; // the video whose read the viewer stopped last
  private reading: Reading | null = null;
  private readonly readOnce = new Set<string>(); // videos this tab does not read again by itself (I1)
  private lostQuery: string | null = null;
  private modelStarted = 0;

  constructor(private readonly d: ControllerDeps) {}

  get isReading(): boolean {
    return this.reading !== null;
  }

  // The page reader saw a video. It posts the same video several times; only a new one counts.
  video(next: VideoInfo): void {
    if (next.videoId === this.info?.videoId) return;
    this.navigating = false;
    this.stop("navigation");
    this.info = next;
    this.searchId++;
    this.lostQuery = null;
    this.dispatch({ type: "video", videoId: next.videoId, live: next.live });
    void this.open();
  }

  // YouTube started moving to another page: whatever the player holds from now on is not this video.
  navigateStart(): void {
    this.navigating = true;
    this.stop("navigation");
  }

  navigateFinish(): void {
    this.navigating = false;
  }

  search(query: string): Promise<void> {
    this.viewerStopped = null;
    return this.ask(query, false);
  }

  private async ask(query: string, quiet: boolean): Promise<void> {
    const info = this.info;
    if (!info || info.live) return;
    const id = ++this.searchId;
    if (quiet) this.quietSearch = id;
    this.dispatch({ type: "searching", query });
    try {
      await this.d.link.send({ type: "search", id, videoId: info.videoId, query });
    } catch (err) {
      this.fail(err);
    }
  }

  step(by: 1 | -1): void {
    const ended = this.reading?.ended ?? Promise.resolve();
    this.stop("viewer");
    this.dispatch({ type: "step", by });
    void ended.then(() => this.jump()); // after the read has put the player back
  }

  clear(): void {
    this.dispatch({ type: "clear" });
  }

  skip(): void {
    this.stop("viewer");
  }

  // Esc anywhere on the page stops a read. True when there was one to stop.
  escape(): boolean {
    if (!this.reading) return false;
    this.stop("viewer");
    return true;
  }

  async retry(): Promise<void> {
    this.d.link.resetRetries();
    this.dispatch({ type: "retry" });
    await this.open();
    if (this.state.query && !this.state.notice) await this.search(this.state.query);
  }

  message(m: FromEngine): void {
    if (m.type === "model") return this.model(m);
    if (!this.info || m.videoId !== this.info.videoId) return;
    if (m.type === "state") return this.engineState(m);
    if (m.id !== this.searchId) return;
    this.dispatch({ type: "results", query: this.state.query, hits: m.hits, weak: m.weak, kind: m.kind, readUntil: m.readUntil });
    if (m.failed) return;
    if (this.shouldRead(m.kind)) void this.readInFull(m.kind === "partial" ? m.readUntil : null);
    else if (m.hits.length && !this.reading && m.id !== this.quietSearch) void this.jump();
  }

  // A new line to the engine after the old one dropped: tell it about this video again, and resend a lost search.
  connected(): void {
    void this.open();
    const lost = this.lostQuery;
    this.lostQuery = null;
    if (lost && lost === this.state.query) void this.search(lost);
  }

  disconnected(): void {
    this.stop("engine");
    if (!this.d.extensionAlive()) return this.notify({ kind: "updated", text: UPDATED });
    if (this.state.searching) this.lostQuery = this.state.query;
    // The engine also goes away on purpose, 10 minutes after the last video tab: off a video, wait for the next send.
    if (!this.info || !this.d.onWatchPage()) return;
    this.notify({ kind: "reconnecting", text: RECONNECTING });
    this.d.link.reconnect();
  }

  // The line could not be made again.
  linkFailed(err: unknown): void {
    this.fail(err);
  }

  private model(m: ModelMessage): void {
    if (m.phase === "loading" && !this.modelStarted) this.modelStarted = this.now();
    this.dispatch({ type: "model", phase: m.phase, loaded: m.loaded, total: m.total, message: m.message, device: m.device });
    if (m.phase === "error") this.stop("engine"); // frames sent now could only fail
  }

  private engineState(m: StateMessage): void {
    const moved = (m.kind === "full" || m.kind === "partial") && (m.kind !== this.state.kind || m.readUntil !== this.state.readUntil);
    const preview = m.reading === "preview" ? { done: m.done, total: m.total } : null;
    this.dispatch({ type: "engine", kind: m.kind, readUntil: m.readUntil, preview, problem: m.problem, message: m.message });
    // A full-detail read was saved: the same search again gives sharper answers. After the viewer stopped the read
    // the player stays where it was put back.
    if (!moved || !this.state.query || this.reading) return;
    const quiet = this.viewerStopped === m.videoId;
    this.viewerStopped = null;
    void this.ask(this.state.query, quiet);
  }

  private shouldRead(kind: Kind): boolean {
    const info = this.info;
    if (!info || info.live || kind === "full" || this.reading || this.navigating) return false;
    return !this.readOnce.has(info.videoId) && this.state.model.phase !== "error";
  }

  private readInFull(after: number | null): void {
    const info = this.info;
    if (!info) return;
    const read: Reading = { videoId: info.videoId, abort: new AbortController(), why: null, ended: Promise.resolve() };
    this.reading = read;
    read.ended = this.runRead(read, info, after);
  }

  private async runRead(read: Reading, info: VideoInfo, after: number | null): Promise<void> {
    let started = false;
    let outcome: ReadOutcome = { complete: false, sent: 0, blank: 0 };
    try {
      const v = await this.waitForPlayer(read.videoId, "read", () => read.abort.signal.aborted);
      if (!v) return;
      const all = frameTimes(info.duration); // YouTube's length for the video, never the player's (an ad's)
      const times = after === null ? all : all.filter((t) => t > after);
      await this.d.link.send({ type: "full-start", videoId: read.videoId, after });
      started = true;
      outcome = await this.stepThrough(read, v, times, all.length);
    } catch (err) {
      console.warn("Moments: the full-detail read stopped", err);
    } finally {
      await this.endRead(read, started, outcome);
    }
  }

  private async stepThrough(read: Reading, v: PlayerVideo, times: number[], total: number): Promise<ReadOutcome> {
    const src = v.src;
    const before = total - times.length; // read earlier, when this continues a partial read
    const onPlay = () => this.stop("viewer"); // the viewer pressed play: their video wins
    v.addEventListener("play", onPlay);
    try {
      return await fullRead({
        video: v,
        times,
        capture: this.d.capture(v),
        isAd: () => this.d.isAd(),
        isCurrent: () => this.isCurrent(read.videoId, v, src),
        send: (frames) => void this.d.link.send({ type: "full-frames", videoId: read.videoId, frames }).catch((err: unknown) => console.warn("Moments: frames not sent", err)),
        progress: (done) => this.dispatch({ type: "full", progress: { done: before + done, total } }),
        signal: read.abort.signal,
        seekTimeoutMs: this.d.seekTimeoutMs,
        adPollMs: this.d.pollMs,
      });
    } finally {
      v.removeEventListener("play", onPlay);
    }
  }

  // Every read that started is closed with the engine for the video it read, also after a switch of video: the
  // engine saves what arrived, as partial unless the read was whole (I3).
  private async endRead(read: Reading, started: boolean, outcome: ReadOutcome): Promise<void> {
    if (this.reading === read) this.reading = null;
    if (this.state.videoId === read.videoId) this.dispatch({ type: "full", progress: null });
    if (outcome.blank) console.warn(`Moments: ${outcome.blank} frames had no picture and were skipped`);
    // Once per video in this tab: after a read that ran, and after the viewer stopped one (Skip sticks). A read
    // stopped by a switch of video or by the engine can run again.
    if (read.why === "viewer" || (started && read.why === null)) this.readOnce.add(read.videoId);
    if (read.why === "viewer") this.viewerStopped = read.videoId;
    if (started) {
      await this.d.link
        .send({ type: "full-end", videoId: read.videoId, complete: outcome.complete, sent: outcome.sent })
        .catch((err: unknown) => console.warn("Moments: end of read not sent", err));
    } else if (read.why === null && this.state.videoId === read.videoId && this.state.hits.length) {
      void this.jump(); // the player never settled: answer from what is known
    }
  }

  private isCurrent(videoId: string, v: PlayerVideo, src: string): boolean {
    const info = this.info;
    if (this.navigating || !info || info.videoId !== videoId || this.d.video() !== v) return false;
    return v.src === src || this.lengthMatches(v, info);
  }

  private lengthMatches(v: PlayerVideo, info: VideoInfo): boolean {
    return info.duration > 0 && Math.abs(v.duration - info.duration) <= LENGTH_TOLERANCE_S;
  }

  // The player once it holds this video. An ad plays first in the same <video> ("Reads after the ad", "Jumps after
  // the ad") and the video can take a moment to load after it. Null when the wait was cancelled, YouTube moved to
  // another video, or the player never showed this video's length (a read is then refused, not guessed).
  private async waitForPlayer(videoId: string, purpose: "jump" | "read", cancelled: () => boolean): Promise<PlayerVideo | null> {
    try {
      for (let checks = 0; ; await sleep(this.d.pollMs ?? POLL_MS)) {
        const info = this.info;
        if (cancelled() || this.navigating || info?.videoId !== videoId) return null;
        if (this.d.isAd()) {
          if (this.state.waitingForAd !== purpose) this.dispatch({ type: "ad", waiting: purpose });
          continue;
        }
        const v = this.d.video();
        const unknownLength = !(info.duration > 0) && purpose === "jump";
        if (v && (unknownLength || this.lengthMatches(v, info))) return v;
        if (++checks > LENGTH_CHECKS) {
          console.warn("Moments: the player does not hold this video's length", v?.duration, info.duration);
          return null;
        }
      }
    } finally {
      if (this.state.waitingForAd === purpose) this.dispatch({ type: "ad", waiting: null });
    }
  }

  // Seeks to the current match. The match and the video are read after any wait for an ad, never before (C1).
  private async jump(): Promise<void> {
    const videoId = this.info?.videoId;
    if (!videoId) return;
    const v = await this.waitForPlayer(videoId, "jump", () => this.reading !== null);
    const hit = this.state.hits[this.state.current];
    if (!v || !hit || this.reading) return;
    v.currentTime = hit.start;
    void v.play().catch(() => undefined);
  }

  private async open(): Promise<void> {
    const info = this.info;
    if (!info) return;
    try {
      const { backgroundReading } = await this.d.readSettings();
      await this.d.link.send({ type: "open", videoId: info.videoId, duration: info.duration, spec: info.spec, autoRead: backgroundReading && !info.live });
    } catch (err) {
      this.fail(err);
    }
  }

  private stop(why: Stop): void {
    const read = this.reading;
    if (!read) return;
    read.why ??= why;
    read.abort.abort();
  }

  private fail(err: unknown): void {
    console.warn("Moments:", err);
    if (!this.d.extensionAlive()) return this.notify({ kind: "updated", text: UPDATED });
    this.notify({ kind: "failed", text: `Moments could not reach its engine: ${reason(err)}` });
  }

  private notify(notice: Notice): void {
    this.dispatch({ type: "failed", notice });
  }

  private now(): number {
    return this.d.now?.() ?? performance.now();
  }

  private dispatch(a: Action): void {
    this.state = reduce(this.state, a);
    const known = this.info?.duration || this.d.video()?.duration || 0;
    this.d.render(this.state, (this.now() - this.modelStarted) / 1000, Number.isFinite(known) ? known : 0);
  }
}
