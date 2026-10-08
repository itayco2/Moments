import { describe, expect, it } from "vitest";
import {
  base64Fp16,
  displayName,
  emptyLibrary,
  fileKey,
  parseDemo,
  withSource,
  withVideo,
  type DemoJson,
} from "../src/library";

function fp16Bytes(values: number[]): Uint8Array {
  // Exact fp16 encodings for the handful of values the tests use.
  const table: Record<number, number> = { 0: 0x0000, 1: 0x3c00, 0.5: 0x3800, [-1]: 0xbc00 };
  return new Uint8Array(new Uint16Array(values.map((v) => table[v])).buffer);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const demo: DemoJson = {
  name: "NASA demo",
  dim: 2,
  videos: [
    { key: "a.mp4", display: "A", duration: 60, src: "https://example.org/a.mp4" },
    { key: "b.mp4", display: "B", duration: 30, src: "https://example.org/b.mp4" },
  ],
  rows: [
    [0, 0, 1],
    [1, 4, 5],
  ],
  examples: [{ query: "a rocket", vector: b64(fp16Bytes([1, 0])) }],
};

describe("parseDemo", () => {
  it("builds rows, vectors, videos and example vectors", () => {
    const { library, examples } = parseDemo(demo, fp16Bytes([1, 0, 0.5, -1]).buffer as ArrayBuffer, "/demo/");
    expect(library.rows[1]).toEqual({ video: "b.mp4", start: 4, end: 5, thumb: "/demo/thumbs/1.webp" });
    expect(Array.from(library.vectors)).toEqual([1, 0, 0.5, -1]);
    expect(library.videos["a.mp4"].src).toBe("https://example.org/a.mp4");
    expect(examples[0].query).toBe("a rocket");
    expect(Array.from(examples[0].vector)).toEqual([1, 0]);
  });

  it("refuses vectors that do not match the row count", () => {
    expect(() => parseDemo(demo, fp16Bytes([1, 0]).buffer as ArrayBuffer, "/")).toThrow(/rows/);
  });

  it("decodes base64 fp16 vectors", () => {
    expect(Array.from(base64Fp16(b64(fp16Bytes([0.5, -1]))))).toEqual([0.5, -1]);
  });
});

describe("own library", () => {
  const info = { key: "k", display: "clip", duration: 8, src: null };

  it("adds a video without touching the old library", () => {
    const empty = emptyLibrary("Your videos", 2);
    const rows = [{ video: "k", start: 0, end: 1, thumb: "t0" }];
    const next = withVideo(empty, info, rows, [new Float32Array([1, 0])]);
    expect(empty.rows).toHaveLength(0);
    expect(empty.vectors).toHaveLength(0);
    expect(next.rows).toHaveLength(1);
    expect(Array.from(next.vectors)).toEqual([1, 0]);
  });

  it("refuses vectors of the wrong size", () => {
    expect(() =>
      withVideo(emptyLibrary("x", 2), info, [{ video: "k", start: 0, end: 1, thumb: "" }], [new Float32Array(3)]),
    ).toThrow(/dims/);
  });

  it("attaches a playable source later", () => {
    const lib = withVideo(emptyLibrary("x", 2), info, [], []);
    expect(withSource(lib, "k", "blob:1").videos.k.src).toBe("blob:1");
    expect(lib.videos.k.src).toBeNull();
  });

  it("identifies a file by name, size and date", () => {
    expect(fileKey({ name: "a.mp4", size: 10, lastModified: 5 })).toBe("a.mp4|10|5");
    expect(displayName("holiday.2024.mp4")).toBe("holiday.2024");
  });
});
