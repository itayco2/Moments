import { describe, expect, it } from "vitest";
import { clock, fp16ToFloat32 } from "../src/format";
import { dotAll, normalize, search, type Row } from "../src/search";

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

  it("merges adjacent windows of one shot (PF06)", () => {
    const rows = [0, 8, 16, 60].map((s) => row("a.mp4", s));
    const hits = search(rows, vectorsFor([0.9, 0.85, 0.8, 0.5]), 2, Q, 3);
    expect(hits.map((h) => h.start)).toEqual([0, 60]);
  });

  it("merges single frames 4 s apart into one moment", () => {
    const rows = [0, 4, 8, 12, 100].map((s) => row("a.mp4", s, 1));
    const hits = search(rows, vectorsFor([0.9, 0.88, 0.86, 0.84, 0.3]), 2, Q, 5);
    expect(hits.map((h) => h.start)).toEqual([0, 100]);
  });

  it("merges a run of frames even when its middle ranks after both ends (PF10)", () => {
    const rows = [1948, 1952, 1956, 1960, 1964, 1968, 2400].map((s) => row("a.mp4", s, 1));
    const hits = search(rows, vectorsFor([0.9, 0.7, 0.71, 0.72, 0.73, 0.89, 0.5]), 2, Q, 3);
    expect(hits.map((h) => h.start)).toEqual([1948, 2400]);
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
