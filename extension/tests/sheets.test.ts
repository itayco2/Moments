import { describe, expect, it } from "vitest";
import { frameProblem, jpegSize, MAX_PREVIEW_FRAMES, plannedFrames, previewTiles, usableTiles } from "../src/engine/sheets";
import { parseSpec, type Level, type Tile } from "../src/storyboard";
import short from "./fixtures/spec_short.json";

const tile = (t: number, width = 160, height = 90): Tile => ({ t, sheet: "https://i.ytimg.com/sb/x", x: 0, y: 0, width, height });
const run = (n: number, width = 160, height = 90) => Array.from({ length: n }, (_, t) => tile(t, width, height));
const level = (over: Partial<Level> = {}): Level => ({ index: 2, width: 160, height: 90, count: 100, cols: 5, rows: 5, intervalMs: 2000, name: "M$M", sigh: "s", ...over });

describe("usableTiles", () => {
  it("keeps an ordinary preview list as it is", () => {
    const list = run(108);
    expect(usableTiles(list)).toBe(list);
  });

  it("refuses an empty list and a single frame, which would be saved as a preview that finds nothing", () => {
    expect(usableTiles([])).toBeNull();
    expect(usableTiles(run(1))).toBeNull();
    expect(usableTiles(run(2))).not.toBeNull();
  });

  it("refuses more than the frame cap", () => {
    expect(usableTiles(run(MAX_PREVIEW_FRAMES))).not.toBeNull();
    expect(usableTiles(run(MAX_PREVIEW_FRAMES + 1))).toBeNull();
  });

  it("refuses tiles larger than 640x360 and tiles with no area", () => {
    expect(usableTiles(run(3, 640, 360))).not.toBeNull();
    expect(usableTiles(run(3, 641, 360))).toBeNull();
    expect(usableTiles(run(3, 640, 361))).toBeNull();
    expect(usableTiles(run(3, 0, 90))).toBeNull();
    expect(usableTiles(run(3, 160, 0))).toBeNull();
  });

  it("refuses a list where only one tile is bad", () => {
    expect(usableTiles([tile(0), tile(1), tile(2, 800, 90)])).toBeNull();
  });
});

describe("plannedFrames", () => {
  it("counts what the level holds when the video is long enough", () => {
    expect(plannedFrames(level({ count: 108 }), 10_000)).toBe(108);
  });

  it("counts only the frames inside the video when the level promises more", () => {
    expect(plannedFrames(level({ count: 2_000_000_000, intervalMs: 1 }), 10)).toBe(10_001);
  });
});

describe("previewTiles", () => {
  const sb = parseSpec(short.spec);

  it("lists a real video's frames", () => {
    expect(sb).not.toBeNull();
    const list = previewTiles(sb!, sb!.levels[2], short.lengthSeconds);
    expect(list?.length).toBeGreaterThan(50);
  });

  it("refuses without building a huge list when a hostile spec promises billions of frames", () => {
    const hostile = { ...sb!, levels: [level({ count: 2_000_000_000, intervalMs: 1 })] };
    expect(previewTiles(hostile, hostile.levels[0], 48 * 3600)).toBeNull();
  });

  it("refuses a video too short to hold two frames", () => {
    expect(previewTiles(sb!, sb!.levels[2], 0)).toBeNull();
  });
});

// SOI, a JFIF APP0 segment, then a frame header declaring width x height (SOF0 baseline unless told otherwise).
const jpeg = (width: number, height: number, sof = 0xc0) =>
  Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00,
  ]);

describe("jpegSize (read from the header, before anything is decoded)", () => {
  it("reads the size of a baseline and a progressive JPEG", () => {
    expect(jpegSize(jpeg(640, 360))).toEqual({ width: 640, height: 360 });
    expect(jpegSize(jpeg(4000, 3000, 0xc2))).toEqual({ width: 4000, height: 3000 });
  });

  it("steps over fill bytes between segments", () => {
    const b = jpeg(640, 360);
    const padded = Uint8Array.from([...b.slice(0, 20), 0xff, ...b.slice(20)]);
    expect(jpegSize(padded)).toEqual({ width: 640, height: 360 });
  });

  it("finds no size in bytes that are not a JPEG, are cut short, or reach image data first", () => {
    expect(jpegSize(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(jpegSize(jpeg(640, 360).slice(0, 25))).toBeNull();
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]))).toBeNull();
  });
});

describe("frameProblem (M4: no picture bombs)", () => {
  it("accepts a frame the full-detail read sends", () => {
    expect(frameProblem(jpeg(640, 360))).toBeNull();
    expect(frameProblem(jpeg(1920, 1040))).toBeNull();
  });

  it("refuses a frame over about 2 megapixels, one with no area and one that is not a JPEG", () => {
    expect(frameProblem(jpeg(2000, 2000))).toMatch(/2000x2000 is larger/);
    expect(frameProblem(jpeg(0, 360))).toMatch(/not a readable JPEG/);
    expect(frameProblem(new Uint8Array(10))).toMatch(/not a readable JPEG/);
  });
});
