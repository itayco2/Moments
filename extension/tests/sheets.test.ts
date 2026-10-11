import { describe, expect, it } from "vitest";
import { MAX_PREVIEW_FRAMES, plannedFrames, previewTiles, usableTiles } from "../src/engine/sheets";
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
