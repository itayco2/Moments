import { describe, expect, it, vi } from "vitest";
import { canRetry } from "../src/content/bar-state";
import { Controller, type ControllerDeps, type PlayerVideo, RECONNECTING, UPDATED } from "../src/content/controller";
import type { Frame, Kind, ToEngine, VideoInfo } from "../src/protocol";

// The viewer's player: seeks finish at once; a test can act during a seek (navigate, Skip, an ad).
class FakeVideo extends EventTarget implements PlayerVideo {
  paused = false;
  src = "blob:https://www.youtube.com/main";
  seeks: number[] = [];
  plays = 0;
  pauses = 0;
  onSeek: (t: number) => void = () => {};
  private t = 30;
  constructor(public duration: number) {
    super();
  }
  get currentTime(): number {
    return this.t;
  }
  set currentTime(v: number) {
    this.seeks.push(v);
    this.t = v;
    this.onSeek(v);
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  pause(): void {
    this.pauses++;
    this.paused = true;
  }
  async play(): Promise<void> {
    this.plays++;
    this.paused = false;
  }
}

const INFO: VideoInfo = { videoId: "dQw4w9WgXcQ", duration: 40, spec: null, live: false }; // read every second: 40 frames
const OTHER: VideoInfo = { videoId: "aaaaaaaaaaa", duration: 300, spec: null, live: false };
const HITS = [
  { start: 12, end: 13, score: 0.8 },
  { start: 33, end: 34, score: 0.79 },
];
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<ControllerDeps> = {}) {
  const sent: ToEngine[] = [];
  const page = { video: new FakeVideo(40.3), ad: false, alive: true, watch: true, failed: false };
  const reload = vi.fn();
  const link = { send: vi.fn(async (m: ToEngine) => void sent.push(m)), reconnect: vi.fn(), resetRetries: vi.fn() };
  const c = new Controller({
    link,
    video: () => page.video,
    isAd: () => page.ad,
    capture: (v) => () => `data:image/jpeg;base64,${v.currentTime}`,
    render: () => undefined,
    readSettings: async () => ({ backgroundReading: true }),
    extensionAlive: () => page.alive,
    playerFailed: () => page.failed,
    reload,
    onWatchPage: () => page.watch,
    now: () => 0,
    pollMs: 1,
    seekTimeoutMs: 5,
    ...over,
  });
  const of = <T extends ToEngine["type"]>(type: T) => sent.filter((m): m is Extract<ToEngine, { type: T }> => m.type === type);
  // The engine answers the latest search.
  const answer = (kind: Kind, over: { readUntil?: number; viewerStopped?: boolean; hits?: typeof HITS; videoId?: string; failed?: boolean } = {}) => {
    const search = of("search").at(-1)!;
    c.message({ type: "results", id: search.id, videoId: over.videoId ?? search.videoId, kind, readUntil: over.readUntil ?? 0, viewerStopped: over.viewerStopped ?? false, hits: over.hits ?? HITS, weak: false, failed: over.failed ?? false });
  };
  const frameTimesSent = () => of("full-frames").flatMap((m) => m.frames.map((f: Frame) => f.t));
  const ended = () => vi.waitFor(() => expect(of("full-end")).not.toHaveLength(0));
  return { c, sent, page, link, reload, of, answer, frameTimesSent, ended };
}

async function startOn(t: ReturnType<typeof setup>, info = INFO) {
  t.c.video(info);
  await settle();
  await t.c.search("a dog jumping");
}

describe("Controller: the first search reads the video in full detail", () => {
  it("reads every frame of YouTube's length, closes the read whole and puts the player back", async () => {
    const t = setup();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-start")).toEqual([{ type: "full-start", videoId: INFO.videoId, after: null }]);
    expect(t.frameTimesSent()).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(t.of("full-end")).toEqual([{ type: "full-end", videoId: INFO.videoId, complete: true, sent: 40, byViewer: false }]);
    expect(t.page.video.seeks.at(-1)).toBe(30);
  });

  it("a first search with nothing read yet stays Searching through the read, never Nothing found (PF36)", async () => {
    const t = setup();
    await startOn(t);
    t.answer("none", { hits: [] });
    expect(t.c.state.searching).toBe(true);
    await t.ended();
    expect(t.c.state).toMatchObject({ searching: true, hits: [] }); // until the saved read is searched again
  });

  it("a read that never started lets the empty answer stand", async () => {
    const t = setup();
    t.page.video = new FakeVideo(9999); // the player does not hold YouTube's length: the read refuses to start
    await startOn(t);
    t.answer("none", { hits: [] });
    await vi.waitFor(() => expect(t.c.state.searching).toBe(false));
    expect(t.of("full-start")).toHaveLength(0);
  });

  it("does not read a video the engine holds in full (M1: the answer's kind, not the bar's)", async () => {
    const t = setup();
    await startOn(t);
    t.answer("full");
    await vi.waitFor(() => expect(t.page.video.seeks).toEqual([12]));
    expect(t.of("full-start")).toEqual([]);
  });

  it("continues a partial read from where it reached, never from 0:00 (I1)", async () => {
    const t = setup();
    await startOn(t);
    t.answer("partial", { readUntil: 19 });
    await t.ended();
    expect(t.of("full-start")[0]).toMatchObject({ after: 19 });
    expect(t.frameTimesSent()).toEqual(Array.from({ length: 20 }, (_, i) => 20 + i));
    expect(t.of("full-end")[0]).toMatchObject({ complete: true, sent: 20 });
  });

  it("does not read a live stream, and sends no search for it (M7)", async () => {
    const t = setup();
    await startOn(t, { ...INFO, live: true });
    expect(t.of("search")).toEqual([]);
    expect(t.of("open")[0]).toMatchObject({ autoRead: false });
  });

  it("tells the engine about a video once, however often the page reader posts it (M8)", async () => {
    const t = setup();
    t.c.video(INFO);
    t.c.video(INFO);
    await settle();
    expect(t.of("open")).toHaveLength(1);
  });
});

describe("Controller: Skip sticks (I1)", () => {
  it("keeps what was read, does not read again on the next searches, and leaves the player where it was put back", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 5 && t.c.skip();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")[0]).toMatchObject({ complete: false, sent: 5, byViewer: true });
    expect(t.page.video.seeks.at(-1)).toBe(30);

    // The engine saved it as partial, stopped by the viewer; the bar asks again, quietly.
    t.c.message({ type: "state", videoId: INFO.videoId, kind: "partial", readUntil: 4, viewerStopped: true, reading: null, done: 9, total: 9, problem: null, message: "" });
    expect(t.of("search")).toHaveLength(2);
    t.answer("partial", { readUntil: 4, viewerStopped: true });
    await settle();
    expect(t.page.video.seeks.at(-1)).toBe(30); // no jump after the viewer stopped the read

    await t.c.search("a cat");
    t.answer("partial", { readUntil: 4, viewerStopped: true });
    await vi.waitFor(() => expect(t.page.video.seeks.at(-1)).toBe(12)); // the viewer's own search jumps
    expect(t.of("full-start")).toHaveLength(1);
  });

  it("a step during the read stops it and jumps once the player is put back", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 3 && t.c.step(1);
    await startOn(t);
    t.answer("preview");
    await t.ended();
    await vi.waitFor(() => expect(t.page.video.seeks.at(-1)).toBe(HITS[1].start));
    expect(t.page.video.seeks.slice(-2)).toEqual([30, HITS[1].start]);
  });
});

describe("Controller: switching videos mid-read (C1)", () => {
  it("stops, grabs nothing more, closes the read for the old video and never restores onto the new one", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => {
      if (s !== 10) return;
      t.c.navigateStart(); // YouTube moves on (autoplay, a click) while this seek runs
      t.page.video.src = "blob:https://www.youtube.com/next";
      t.page.video.duration = 300;
    };
    await startOn(t);
    t.answer("preview");
    await t.ended();

    expect(t.frameTimesSent()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(t.of("full-end")).toEqual([{ type: "full-end", videoId: INFO.videoId, complete: false, sent: 10, byViewer: false }]);
    expect(t.page.video.seeks.at(-1)).toBe(10); // the old second is not put onto the new video
    expect(t.page.video.plays).toBe(0);
  });

  it("closes the read for the old video when the next one is posted first", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 6 && t.c.video(OTHER);
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")).toEqual([{ type: "full-end", videoId: INFO.videoId, complete: false, sent: 6, byViewer: false }]);
    expect(t.c.state).toMatchObject({ videoId: OTHER.videoId, full: null });
  });

  it("reads the video again on a later search when the viewer comes back to it", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 6 && t.c.navigateStart();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    t.c.video(OTHER);
    t.c.video(INFO);
    await settle();
    t.page.video.onSeek = () => undefined;
    await t.c.search("a dog jumping");
    t.answer("partial", { readUntil: 5 });
    await vi.waitFor(() => expect(t.of("full-start")).toHaveLength(2));
    expect(t.of("full-start")[1]).toMatchObject({ after: 5 });
  });
});

describe("Controller: ads (C2)", () => {
  it("never touches the ad, says it reads after the ad, then reads with YouTube's length", async () => {
    const t = setup();
    t.page.ad = true;
    t.page.video.duration = 15; // the ad's length, in the same <video>
    await startOn(t);
    t.answer("preview");
    await new Promise((r) => setTimeout(r, 20));
    expect(t.c.state.waitingForAd).toBe("read");
    expect(t.page.video.seeks).toEqual([]);
    expect(t.page.video.pauses).toBe(0);

    t.page.ad = false;
    t.page.video.duration = 41.5;
    await t.ended();
    expect(t.c.state.waitingForAd).toBeNull();
    expect(t.frameTimesSent()).toHaveLength(40);
    expect(t.of("full-end")[0]).toMatchObject({ complete: true });
  });

  it("refuses to read when the player does not hold the video's length (more than 2 s off)", async () => {
    const t = setup();
    t.page.video.duration = 15; // an ad YouTube did not mark
    await startOn(t);
    t.answer("preview", { hits: [] });
    await vi.waitFor(() => expect(t.c.isReading).toBe(false));
    expect(t.of("full-start")).toEqual([]);
    expect(t.page.video.pauses).toBe(0);
    expect(t.page.video.seeks).toEqual([]);
  });

  it("jumps after the ad to the match that is current then", async () => {
    const t = setup();
    t.page.ad = true;
    await startOn(t);
    t.answer("full");
    await new Promise((r) => setTimeout(r, 10));
    expect(t.c.state.waitingForAd).toBe("jump");
    t.c.step(1);
    t.page.ad = false;
    await vi.waitFor(() => expect(t.page.video.seeks).toContain(HITS[1].start));
    expect(t.page.video.seeks).not.toContain(HITS[0].start);
  });

  it("does not jump onto another video that loaded while it waited for the ad", async () => {
    const t = setup();
    t.page.ad = true;
    await startOn(t);
    t.answer("full");
    await new Promise((r) => setTimeout(r, 10));
    t.c.navigateStart();
    t.c.video(OTHER);
    t.page.ad = false;
    await new Promise((r) => setTimeout(r, 20));
    expect(t.page.video.seeks).toEqual([]);
    expect(t.c.state.waitingForAd).toBeNull();
  });

  it("does not jump when, after the ad, the player holds another video that the page reader has not posted yet", async () => {
    const t = setup();
    t.page.ad = true;
    await startOn(t);
    t.answer("full");
    await new Promise((r) => setTimeout(r, 10));
    t.c.navigateStart();
    t.page.video.duration = 300; // the next video, loaded where the ad was
    t.page.ad = false;
    t.c.navigateFinish();
    await vi.waitFor(() => expect(t.c.state.waitingForAd).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(t.page.video.seeks).toEqual([]);
    expect(t.c.state.hits).toHaveLength(2); // still the old video's answer: only the jump was refused
  });
});

describe("Controller: errors never leave the bar on Searching (I4, C3)", () => {
  it("a search that cannot reach the engine ends Searching with the reason and Try again", async () => {
    const t = setup();
    t.c.video(INFO);
    await settle();
    t.link.send.mockRejectedValueOnce(new Error("the engine page did not announce itself within 10 s"));
    await t.c.search("q");
    expect(t.c.state.searching).toBe(false);
    expect(t.c.state.notice?.text).toMatch(/could not reach its engine: the engine page did not announce/);
    expect(canRetry(t.c.state)).toBe(true);
  });

  it("after an extension update says to reload the page", async () => {
    const t = setup();
    t.c.video(INFO);
    await settle();
    t.page.alive = false;
    t.link.send.mockRejectedValueOnce(new Error("Extension context invalidated."));
    await t.c.search("q");
    expect(t.c.state.notice).toEqual({ kind: "updated", text: UPDATED });
  });

  it("an engine that answers a search as failed ends Searching and does not start a read", async () => {
    const t = setup();
    await startOn(t);
    t.c.message({ type: "state", videoId: INFO.videoId, kind: "none", readUntil: 0, viewerStopped: false, reading: null, done: 0, total: 0, problem: "error", message: "Error: stuck" });
    t.answer("none", { failed: true, hits: [] });
    await settle();
    expect(t.c.state.searching).toBe(false);
    expect(canRetry(t.c.state)).toBe(true);
    expect(t.of("full-start")).toEqual([]);
  });

  it("a dropped line ends Searching, reconnects, and sends the lost search again", async () => {
    const t = setup();
    await startOn(t);
    t.c.disconnected();
    expect(t.c.state).toMatchObject({ searching: false, notice: { kind: "reconnecting", text: RECONNECTING } });
    expect(t.link.reconnect).toHaveBeenCalledOnce();

    t.c.connected();
    await settle();
    expect(t.of("open")).toHaveLength(2);
    expect(t.of("search").map((m) => m.query)).toEqual(["a dog jumping", "a dog jumping"]);
  });

  it("a dropped line stops a read and closes it, and the read can run again", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 7 && t.c.disconnected();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")[0]).toMatchObject({ complete: false });
    t.page.video.onSeek = () => undefined;
    await t.c.search("again");
    t.answer("preview");
    await vi.waitFor(() => expect(t.of("full-start")).toHaveLength(2));
  });

  it("does not reconnect off a video page, where the engine unloads on purpose", async () => {
    const t = setup();
    t.c.video(INFO);
    t.page.watch = false;
    t.c.disconnected();
    expect(t.link.reconnect).not.toHaveBeenCalled();
    expect(t.c.state.notice).toBeNull();
  });

  it("stops a read when the model fails for good, so frames do not pile up behind it", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 8 && t.c.message({ type: "model", phase: "error", loaded: 0, total: 0, device: "webgpu", message: "failed twice" });
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")[0]).toMatchObject({ complete: false });
    expect(canRetry(t.c.state)).toBe(true);
  });

  it("Try again opens the video again and repeats the search, with a fresh set of reconnects", async () => {
    const t = setup();
    t.c.video(INFO);
    await settle();
    t.link.send.mockRejectedValueOnce(new Error("gone"));
    await t.c.search("q");
    await t.c.retry();
    expect(t.link.resetRetries).toHaveBeenCalledOnce();
    expect(t.of("open")).toHaveLength(2);
    expect(t.of("search").map((m) => m.query)).toEqual(["q"]);
    expect(t.c.state).toMatchObject({ searching: true, notice: null });
  });
});

describe("Controller: why a read stopped decides whether it is continued (I1)", () => {
  it("never continues a read the viewer stopped on an earlier visit: it jumps from what is saved", async () => {
    const t = setup();
    await startOn(t);
    t.answer("partial", { readUntil: 12, viewerStopped: true });
    await vi.waitFor(() => expect(t.page.video.seeks).toEqual([12]));
    expect(t.of("full-start")).toEqual([]);
  });

  it("continues a read that lost frames on the viewer's next search, never on the bar's own repeat", async () => {
    const t = setup();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")[0]).toMatchObject({ complete: true, byViewer: false });

    // The engine lost a batch on the way: partial up to 0:30, not stopped by the viewer. The bar asks again by itself.
    t.c.message({ type: "state", videoId: INFO.videoId, kind: "partial", readUntil: 30, viewerStopped: false, reading: null, done: 36, total: 36, problem: null, message: "" });
    expect(t.of("search")).toHaveLength(2);
    t.answer("partial", { readUntil: 30 });
    await settle();
    expect(t.of("full-start")).toHaveLength(1);

    await t.c.search("a dog jumping");
    t.answer("partial", { readUntil: 30 });
    await vi.waitFor(() => expect(t.of("full-start")).toHaveLength(2));
    expect(t.of("full-start")[1]).toMatchObject({ after: 30 });
  });

  it("after Skip before anything was read, this tab still does not read the video again", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 0 && t.c.skip();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")[0]).toMatchObject({ sent: 0, byViewer: true });

    t.page.video.onSeek = () => undefined;
    await t.c.search("again");
    t.answer("preview");
    await settle();
    expect(t.of("full-start")).toHaveLength(1);
  });

  it("marks a read stopped by a switch of video or a dropped line as not stopped by the viewer", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 7 && t.c.disconnected();
    await startOn(t);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")[0]).toMatchObject({ complete: false, byViewer: false });
  });
});

const WITH_PREVIEWS: VideoInfo = { ...INFO, spec: "https://i.ytimg.com/sb/dQw4w9WgXcQ/storyboard3_L$L/$N.jpg?x" };

describe("Controller: the player fails during a read (PF32)", () => {
  it("ends the read as partial not stopped by the viewer, loads the video again at the viewer's second and asks for previews", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => {
      if (s === 10) t.page.failed = true;
    };
    await startOn(t, WITH_PREVIEWS);
    t.answer("preview");
    await t.ended();
    expect(t.of("full-end")).toEqual([{ type: "full-end", videoId: INFO.videoId, complete: false, sent: 10, byViewer: false }]);
    expect(t.reload).toHaveBeenCalledExactlyOnceWith(INFO.videoId, 30, true);
    expect(t.page.video.seeks.at(-1)).toBe(10);
    await vi.waitFor(() => expect(t.of("open")).toHaveLength(2));
    expect(t.of("open")[1]).toMatchObject({ autoRead: true });
  });

  it("does not try the read again in this tab", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => {
      if (s === 10) t.page.failed = true;
    };
    await startOn(t);
    t.answer("preview");
    await t.ended();
    t.page.failed = false;
    await t.c.search("again");
    t.answer("partial", { readUntil: 9 });
    await settle();
    expect(t.of("full-start")).toHaveLength(1);
  });
});

describe("Controller: previews cover what a stopped read did not reach (PF32)", () => {
  it("asks for previews after the viewer stops a read", async () => {
    const t = setup();
    t.page.video.onSeek = (s) => s === 5 && t.c.skip();
    await startOn(t, WITH_PREVIEWS);
    t.answer("preview");
    await t.ended();
    await vi.waitFor(() => expect(t.of("open")).toHaveLength(2));
    expect(t.of("open")[1]).toMatchObject({ videoId: INFO.videoId, autoRead: true });
  });

  it("does not ask for previews again after a read that went to the end", async () => {
    const t = setup();
    await startOn(t, WITH_PREVIEWS);
    t.answer("preview");
    await t.ended();
    await settle();
    expect(t.of("open")).toHaveLength(1);
  });

  it("searches again when previews fill in after a partial read, without moving the player", async () => {
    const t = setup();
    await startOn(t);
    t.answer("partial", { readUntil: 30, viewerStopped: true, hits: [] });
    const state = (total: number) => ({ type: "state" as const, videoId: INFO.videoId, kind: "partial" as const, readUntil: 30, viewerStopped: true, reading: null, done: total, total, problem: null, message: "" });
    t.c.message(state(31));
    const searches = t.of("search").length;
    t.c.message(state(36)); // the previews after 0:30 arrived
    expect(t.of("search")).toHaveLength(searches + 1);
    t.answer("partial", { readUntil: 30, viewerStopped: true });
    await settle();
    expect(t.page.video.seeks).toEqual([]);
  });
});

describe("Controller: no WebGPU (item 4)", () => {
  it("sends no search and starts no read when the engine says Moments cannot run here", async () => {
    const t = setup();
    t.c.video(INFO);
    await settle();
    t.c.message({ type: "model", phase: "unsupported", loaded: 0, total: 0, device: null, message: "this browser offers no WebGPU" });
    await t.c.search("a dog");
    expect(t.of("search")).toEqual([]);
    expect(t.c.state.searching).toBe(false);
  });
});
