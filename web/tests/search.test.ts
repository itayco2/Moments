import { describe, expect, it } from "vitest";
import { clock, count, fp16ToFloat32, loopEnd } from "../src/format";
import { dotAll, isWeakMatch, median, normalize, search, type Row } from "../src/search";

// Two-dimensional unit vectors whose dot product with [1, 0] is exactly the given score.
function vectorsFor(scores: number[]): Float32Array {
  return new Float32Array(scores.flatMap((s) => [s, Math.sqrt(1 - s * s)]));
}

const Q = new Float32Array([1, 0]);
const row = (video: string, start: number, len = 8): Row => ({ video, start, end: start + len, thumb: "" });

describe("search", () => {
  it("keeps one hit per moment (same case as the Python test)", () => {
    const rows = [0, 4, 8, 40].map((s) => row("a.mp4", s)).concat(row("b.mp4", 0));
    const hits = search(rows, vectorsFor([0.9, 0.95, 0.8, 0.5, 0.7]), 2, Q, 3);
    expect(hits.map((h) => [h.video, h.start])).toEqual([
      ["a.mp4", 4],
      ["b.mp4", 0],
      ["a.mp4", 40],
    ]);
  });

  it("hides 4 frames around a moment, counted in that video's own frame spacing (PF21)", () => {
    // A 30 s game clip with a frame every second next to a long video with a frame every 4 s.
    const clip = Array.from({ length: 31 }, (_, i) => row("clip.mp4", i, 1));
    const long = Array.from({ length: 31 }, (_, i) => row("long.mp4", i * 4, 1));
    const peaks: Record<string, number> = { "clip.mp4@10": 0.9, "long.mp4@40": 0.88, "long.mp4@52": 0.86,
      "clip.mp4@16": 0.85, "long.mp4@60": 0.84 };
    const rows = [...clip, ...long];
    const scores = rows.map((r) => peaks[`${r.video}@${r.start}`] ?? 0.3);
    const hits = search(rows, vectorsFor(scores), 2, Q, 4);
    // 6 s apart in the clip is a new moment; 12 s apart in the long video is still inside its 16 s.
    expect(hits.map((h) => `${h.video}@${h.start}`)).toEqual(["clip.mp4@10", "long.mp4@40", "clip.mp4@16", "long.mp4@60"]);
  });

  it("merges adjacent windows of one shot (PF06)", () => {
    const rows = [0, 8, 16, 60].map((s) => row("a.mp4", s));
    const hits = search(rows, vectorsFor([0.9, 0.89, 0.88, 0.5]), 2, Q, 3);
    expect(hits.map((h) => h.start)).toEqual([0, 60]);
  });

  it("merges single frames 4 s apart into one moment", () => {
    const rows = [0, 4, 8, 12, 100].map((s) => row("a.mp4", s, 1));
    const hits = search(rows, vectorsFor([0.9, 0.89, 0.88, 0.87, 0.3]), 2, Q, 5);
    expect(hits.map((h) => h.start)).toEqual([0, 100]);
  });

  it("merges a shot even when its far end ranks before its middle (PF10)", () => {
    // Like a real library, most frames are unrelated background (the margin is relative to the median).
    const shot = [1948, 1952, 1956, 1960, 1964, 1968, 2400].map((s) => row("a.mp4", s, 1));
    const background = Array.from({ length: 20 }, (_, i) => row("b.mp4", i * 4, 1));
    const scores = [0.9, 0.88, 0.885, 0.875, 0.88, 0.895, 0.5, ...Array(20).fill(0.3)];
    const hits = search([...shot, ...background], vectorsFor(scores), 2, Q, 3);
    expect(hits.slice(0, 2).map((h) => h.start)).toEqual([1948, 2400]);
  });

  it("calls a first result under 0.74 a weak match", () => {
    const hit = (score: number) => ({ ...row("a", 0), score });
    expect(isWeakMatch([hit(0.741)])).toBe(false);
    expect(isWeakMatch([hit(0.739), hit(0.9)])).toBe(true);
    expect(isWeakMatch([])).toBe(false);
  });

  it("takes the median like numpy", () => {
    expect(median(new Float32Array([3, 1, 2]))).toBe(2);
    expect(median(new Float32Array([4, 1, 3, 2]))).toBe(2.5);
  });

  it("finds several moments in one continuous video (PF11)", () => {
    const starts = Array.from({ length: 12 }, (_, i) => i * 4);
    const scores = [0.9, 0.89, 0.7, 0.6, 0.61, 0.62, 0.6, 0.7, 0.86, 0.87, 0.6, 0.59];
    const hits = search(starts.map((s) => row("a.mp4", s, 1)), vectorsFor(scores), 2, Q, 2);
    expect(hits.map((h) => h.start)).toEqual([0, 36]);
  });

  it("refuses rows and vectors that disagree", () => {
    expect(() => search([row("a", 0)], new Float32Array(4), 2, Q, 1)).toThrow(/rows but/);
  });

  it("refuses a query of the wrong size", () => {
    expect(() => dotAll(new Float32Array(4), 2, new Float32Array(3))).toThrow(/dims/);
  });
});

describe("helpers", () => {
  it("normalizes to unit length", () => {
    const v = normalize(new Float32Array([3, 4]));
    expect(Array.from(v)).toEqual([0.6, 0.8].map((x) => Math.fround(x)));
  });

  it("formats clock times like the Python page", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(1954.7)).toBe("32:34");
    expect(clock(3725)).toBe("1:02:05");
  });

  it("loops a few seconds past a moment, but never past the end of the video (PF17)", () => {
    expect(loopEnd(100, 101, 3000)).toBe(108);
    expect(loopEnd(100, 108, 3000)).toBe(110);
    // The case that froze: a moment 4 s before the end of a 120 s clip.
    expect(loopEnd(116, 117, 120)).toBeCloseTo(119.7);
    expect(loopEnd(119.9, 120, 120)).toBeCloseTo(120.4);
  });

  it("counts in words that agree with the number", () => {
    expect(count(1, "video")).toBe("1 video");
    expect(count(3, "video")).toBe("3 videos");
    expect(count(2625, "moment")).toBe("2,625 moments");
  });

  it("decodes half-precision floats", () => {
    // 0x3c00 = 1, 0xc000 = -2, 0x3555 ~ 0.33325, 0x0001 = smallest subnormal, 0x7c00 = +inf
    const out = fp16ToFloat32(new Uint16Array([0x3c00, 0xc000, 0x3555, 0x0001, 0x7c00]));
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(-2);
    expect(out[2]).toBeCloseTo(0.33325, 5);
    expect(out[3]).toBeCloseTo(5.96e-8, 10);
    expect(out[4]).toBe(Number.POSITIVE_INFINITY);
  });
});
