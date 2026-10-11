// extension/tests/full-read.test.ts
import { describe, expect, it } from "vitest";
import { type Frame } from "../src/protocol";
import { fullRead } from "../src/content/full-read";

class FakeVideo extends EventTarget {
  paused = false;
  private t = 30;
  stuckAt: number | null = null;
  get currentTime(): number {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
    if (v !== this.stuckAt) queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  pause(): void {
    this.paused = true;
  }
  async play(): Promise<void> {
    this.paused = false;
  }
}

const times = Array.from({ length: 20 }, (_, i) => i * 2);

function run(video: FakeVideo, over: Partial<Parameters<typeof fullRead>[0]> = {}) {
  const sent: Frame[][] = [];
  const done: number[] = [];
  const controller = new AbortController();
  const promise = fullRead({
    video,
    times,
    capture: () => `data:image/jpeg;base64,${video.currentTime}`,
    isAd: () => false,
    send: (frames) => sent.push(frames),
    progress: (n) => done.push(n),
    signal: controller.signal,
    seekTimeoutMs: 5,
    adPollMs: 1,
    ...over,
  });
  return { promise, sent, done, controller };
}

describe("fullRead", () => {
  it("reads every frame in order, in batches of 8, then puts the viewer back", async () => {
    const video = new FakeVideo();
    const { promise, sent } = run(video);
    expect(await promise).toBe(true);
    expect(sent.map((b) => b.length)).toEqual([8, 8, 4]);
    expect(sent.flat().map((f) => f.t)).toEqual(times);
    expect(video.currentTime).toBe(30);
    expect(video.paused).toBe(false);
  });

  it("stops at once when the viewer acts, keeps what it read and restores the player", async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    const sent: Frame[][] = [];
    const ok = await fullRead({
      video,
      times,
      capture: () => "data:image/jpeg;base64,x",
      isAd: () => false,
      send: (f) => sent.push(f),
      progress: (n) => n === 5 && controller.abort(),
      signal: controller.signal,
      seekTimeoutMs: 5,
    });
    expect(ok).toBe(false);
    expect(sent.flat()).toHaveLength(5);
    expect(video.currentTime).toBe(30);
    expect(video.paused).toBe(false);
  });

  it("leaves a paused viewer paused", async () => {
    const video = new FakeVideo();
    video.paused = true;
    await run(video).promise;
    expect(video.paused).toBe(true);
  });

  it("waits while an ad plays", async () => {
    let polls = 0;
    const video = new FakeVideo();
    const { promise, sent } = run(video, { isAd: () => ++polls <= 3 });
    expect(await promise).toBe(true);
    expect(sent.flat()).toHaveLength(20);
    expect(polls).toBeGreaterThan(3);
  });

  it("skips a frame whose seek never finishes instead of capturing the wrong one", async () => {
    const video = new FakeVideo();
    video.stuckAt = 10;
    const { promise, sent, done } = run(video);
    await promise;
    expect(sent.flat().map((f) => f.t)).not.toContain(10);
    expect(done.at(-1)).toBe(20);
  });
});
