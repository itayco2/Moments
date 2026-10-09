import { describe, expect, it } from "vitest";
import { frameEvery } from "../src/config";
import { frameTimes, scaledSize } from "../src/frames";

describe("frameEvery", () => {
  it("reads short clips every second: game moments last a second or two (PF21)", () => {
    expect(frameEvery(60)).toBe(1);
    expect(frameEvery(120)).toBe(1);
  });

  it("keeps a medium video at 120 frames or fewer", () => {
    expect(frameEvery(121)).toBe(2);
    expect(frameEvery(300)).toBe(3);
    expect(Math.ceil(480 / frameEvery(480))).toBeLessThanOrEqual(120);
  });

  it("reads long videos every 4 s, as the NASA demo was measured", () => {
    expect(frameEvery(570)).toBe(4);
    expect(frameEvery(3 * 3600)).toBe(4);
  });
});

describe("frameTimes", () => {
  it("samples a 1-minute clip every second by default", () => {
    expect(frameTimes(60)).toHaveLength(60);
  });

  it("samples every 4 s inside the video when asked", () => {
    expect(frameTimes(13, 4)).toEqual([0, 4, 8, 12]);
  });

  it("skips a frame that would land on the very last instant", () => {
    expect(frameTimes(12, 4)).toEqual([0, 4, 8]);
  });

  it("gives a short clip at least its first frame", () => {
    expect(frameTimes(0.8)).toEqual([0]);
    expect(frameTimes(1.5)).toEqual([0, 1]);
  });

  it("refuses an unknown length", () => {
    expect(() => frameTimes(Number.POSITIVE_INFINITY)).toThrow(/length/);
    expect(() => frameTimes(0)).toThrow(/length/);
  });
});

describe("scaledSize", () => {
  it("brings 1080p down to 360p", () => {
    expect(scaledSize(1920, 1080)).toEqual({ w: 640, h: 360 });
  });

  it("handles portrait phone video", () => {
    expect(scaledSize(1080, 1920)).toEqual({ w: 360, h: 640 });
  });

  it("never upscales a small video", () => {
    expect(scaledSize(320, 240)).toEqual({ w: 320, h: 240 });
  });

  it("keeps sides even", () => {
    const { w, h } = scaledSize(1001, 563);
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
  });
});
