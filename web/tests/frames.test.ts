import { describe, expect, it } from "vitest";
import { frameTimes, scaledSize } from "../src/frames";

describe("frameTimes", () => {
  it("samples every 4 s inside the video", () => {
    expect(frameTimes(13)).toEqual([0, 4, 8, 12]);
  });

  it("skips a frame that would land on the very last instant", () => {
    expect(frameTimes(12)).toEqual([0, 4, 8]);
  });

  it("gives a short clip at least its first frame", () => {
    expect(frameTimes(1.5)).toEqual([0]);
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
