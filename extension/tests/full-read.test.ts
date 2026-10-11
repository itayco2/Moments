// extension/tests/full-read.test.ts
import { describe, expect, it } from "vitest";
import { type Frame } from "../src/protocol";
import { fullRead, type FullReadDeps } from "../src/content/full-read";

// A player that seeks at once, and can be told what happens during a seek (an ad starts, YouTube loads another video).
class FakeVideo extends EventTarget {
  paused = false;
  private t = 30;
  stuckAt: number | null = null;
  ad = false;
  current = true;
  failed = false;
  seeks: { t: number; duringAd: boolean }[] = [];
  plays = 0;
  pauses = 0;
  onSeek: (t: number) => void = () => {};
  get currentTime(): number {
    return this.t;
  }
  set currentTime(v: number) {
    this.seeks.push({ t: v, duringAd: this.ad });
    this.t = v;
    this.onSeek(v);
    if (v !== this.stuckAt) queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
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

const times = Array.from({ length: 20 }, (_, i) => i * 2);

function run(video: FakeVideo, over: Partial<FullReadDeps> = {}) {
  const sent: Frame[][] = [];
  const done: number[] = [];
  const controller = new AbortController();
  const promise = fullRead({
    video,
    times,
    capture: () => `data:image/jpeg;base64,${video.currentTime}`,
    isAd: () => video.ad,
    isCurrent: () => video.current,
    playerFailed: () => video.failed,
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
    expect(await promise).toMatchObject({ complete: true, sent: 20, blank: 0 });
    expect(sent.map((b) => b.length)).toEqual([8, 8, 4]);
    expect(sent.flat().map((f) => f.t)).toEqual(times);
    expect(video.currentTime).toBe(30);
    expect(video.paused).toBe(false);
  });

  it("stops at once when the viewer acts, keeps what it read and restores the player", async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    const sent: Frame[][] = [];
    const outcome = await fullRead({
      video,
      times,
      capture: () => "data:image/jpeg;base64,x",
      isAd: () => false,
      isCurrent: () => true,
      playerFailed: () => false,
      send: (f) => sent.push(f),
      progress: (n) => n === 5 && controller.abort(),
      signal: controller.signal,
      seekTimeoutMs: 5,
    });
    expect(outcome).toMatchObject({ complete: false, sent: 5, blank: 0 });
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

  it("skips a frame whose seek never finishes instead of capturing the wrong one", async () => {
    const video = new FakeVideo();
    video.stuckAt = 10;
    const { promise, sent, done } = run(video);
    expect(await promise).toMatchObject({ complete: true, sent: 19, blank: 1 });
    expect(sent.flat().map((f) => f.t)).not.toContain(10);
    expect(done.at(-1)).toBe(20);
  });

  it("leaves the player alone when nothing is left to read (a partial read that had reached the end)", async () => {
    const video = new FakeVideo();
    expect(await run(video, { times: [] }).promise).toMatchObject({ complete: true, sent: 0, blank: 0 });
    expect(video.pauses).toBe(0);
    expect(video.seeks).toEqual([]);
  });

  it("skips frames with no picture and counts them", async () => {
    const video = new FakeVideo();
    const { promise, sent } = run(video, { capture: () => (video.currentTime < 10 ? null : "data:image/jpeg;base64,x") });
    expect(await promise).toMatchObject({ complete: true, sent: 15, blank: 5 });
    expect(sent.flat()[0].t).toBe(10);
  });

  describe("when YouTube loads another video mid-read (C1)", () => {
    it("grabs nothing after the switch, even the frame whose seek was in flight, and does not restore onto the new video", async () => {
      const video = new FakeVideo();
      video.onSeek = (t) => {
        if (t === 10) video.current = false; // the next video arrived while this seek ran
      };
      const { promise, sent } = run(video);

      expect(await promise).toMatchObject({ complete: false, sent: 5, blank: 0 });
      expect(sent.flat().map((f) => f.t)).toEqual([0, 2, 4, 6, 8]);
      expect(video.seeks.map((s) => s.t)).toEqual([0, 2, 4, 6, 8, 10]); // no seek back to 0:30
      expect(video.plays).toBe(0);
    });

    it("does not start on a player that no longer holds the video", async () => {
      const video = new FakeVideo();
      video.current = false;
      expect(await run(video).promise).toMatchObject({ complete: false, sent: 0, blank: 0 });
      expect(video.pauses).toBe(0);
      expect(video.seeks).toEqual([]);
    });
  });

  describe("when the player itself fails mid-read (PF32)", () => {
    it("ends the read as failed when the player drops its source, keeps the frames and never touches the player again", async () => {
      const video = new FakeVideo();
      video.onSeek = (t) => {
        if (t === 10) video.failed = true; // YouTube dropped the source: no length, "Something went wrong"
      };
      const { promise, sent } = run(video);
      expect(await promise).toEqual({ complete: false, sent: 5, blank: 0, failed: true, saved: { t: 30, playing: true } });
      expect(sent.flat().map((f) => f.t)).toEqual([0, 2, 4, 6, 8]);
      expect(video.seeks.at(-1)?.t).toBe(10); // no seek back on a dead player: the caller loads the video again
      expect(video.plays).toBe(0);
    });

    it("takes two seeks in a row that never land as a failed player, while one is only skipped", async () => {
      const video = new FakeVideo();
      video.onSeek = (t) => {
        if (t >= 10) video.stuckAt = t;
      };
      const { promise, sent } = run(video);
      expect(await promise).toMatchObject({ complete: false, sent: 5, blank: 1, failed: true });
      expect(sent.flat().map((f) => f.t)).toEqual([0, 2, 4, 6, 8]);
    });
  });

  describe("ads (C2)", () => {
    it("never pauses, seeks or restores an ad: a read asked for during one does nothing", async () => {
      const video = new FakeVideo();
      video.ad = true;
      expect(await run(video).promise).toMatchObject({ complete: false, sent: 0, blank: 0 });
      expect(video.pauses).toBe(0);
      expect(video.seeks).toEqual([]);
      expect(video.plays).toBe(0);
    });

    it("waits out an ad that starts mid-read without touching it, then carries on", async () => {
      const video = new FakeVideo();
      let polls = 0;
      const { promise, sent } = run(video, {
        isAd: () => {
          if (video.seeks.length === 6 && polls < 4) {
            polls++;
            return true;
          }
          return false;
        },
      });
      expect(await promise).toMatchObject({ complete: true, sent: 20 });
      expect(polls).toBe(4);
      expect(sent.flat().map((f) => f.t)).toEqual(times);
    });

    it("does not grab an ad that a seek started; it seeks that frame again once the ad is over", async () => {
      const video = new FakeVideo();
      let adPolls = 0;
      video.onSeek = (t) => {
        if (t === 10 && adPolls === 0) video.ad = true;
      };
      const isAd = () => {
        if (video.ad && ++adPolls > 3) video.ad = false;
        return video.ad;
      };
      const { promise, sent } = run(video, { isAd, capture: () => (video.ad ? "data:image/jpeg;base64,AD" : "data:image/jpeg;base64,x") });
      expect(await promise).toMatchObject({ complete: true, sent: 20 });
      expect(sent.flat().every((f) => !f.jpeg.endsWith("AD"))).toBe(true);
      expect(video.seeks.filter((s) => s.t === 10)).toHaveLength(2);
      expect(video.seeks.every((s) => !s.duringAd || s.t === 10)).toBe(true); // only the seek that started it
    });

    it("leaves the player alone when the read is stopped while an ad shows", async () => {
      const video = new FakeVideo();
      const { promise, controller } = run(video, {
        progress: (n) => {
          if (n === 3) {
            video.ad = true;
            setTimeout(() => controller.abort(), 5);
          }
        },
      });
      const outcome = await promise;
      expect(outcome).toMatchObject({ complete: false, sent: 3 });
      expect(video.seeks.at(-1)?.t).toBe(4); // no seek back to 0:30 under the ad
      expect(video.plays).toBe(0);
    });
  });
});
