import { describe, expect, it } from "vitest";
import { bestLevel, parseSpec, sheetUrl, tiles } from "../src/storyboard";
import long from "./fixtures/spec_long.json";
import lowres from "./fixtures/spec_lowres.json";
import level159 from "./fixtures/spec_159.json";
import short from "./fixtures/spec_short.json";

describe("parseSpec", () => {
  it("reads the video id and every level of a real spec", () => {
    const sb = parseSpec(short.spec)!;
    expect(sb.videoId).toBe("dQw4w9WgXcQ");
    expect(sb.levels.map((l) => `${l.width}x${l.height}@${l.intervalMs}`)).toEqual([
      "48x27@0",
      "80x45@2000",
      "160x90@2000",
      "320x180@2000",
    ]);
  });

  it("refuses text that is not a YouTube storyboard spec", () => {
    expect(parseSpec("")).toBeNull();
    expect(parseSpec("https://evil.example/sb/dQw4w9WgXcQ/storyboard3_L$L/$N.jpg?x|1#1#1#1#1#1#M$M#s")).toBeNull();
    expect(parseSpec(short.spec.split("|")[0])).toBeNull();
    expect(parseSpec(short.spec.replace("320#180#108", "320#abc#108"))).toBeNull();
  });
});

describe("bestLevel", () => {
  it("picks 320x180 when the video has it", () => {
    expect(bestLevel(parseSpec(long.spec)!)).toMatchObject({ index: 3, width: 320, intervalMs: 10000 });
  });

  it("uses a 159x90 level, the 160x90 class as YouTube sizes it for some videos (PF31)", () => {
    const sb = parseSpec(level159.spec)!;
    expect(bestLevel(sb)).toMatchObject({ index: 2, width: 159, height: 90, cols: 5, rows: 5, intervalMs: 2000 });
    expect(tiles(sb, bestLevel(sb)!, level159.lengthSeconds)).toHaveLength(109);
  });

  it("still refuses the levels below the 160x90 class", () => {
    const sb = parseSpec(level159.spec)!;
    expect(bestLevel({ ...sb, levels: sb.levels.slice(0, 2) })).toBeNull(); // 48x27 and 79x45 only
  });

  it("falls back to 160x90 for older uploads", () => {
    expect(bestLevel(parseSpec(lowres.spec)!)).toMatchObject({ index: 2, width: 160, cols: 5, rows: 5 });
  });
});

describe("tiles", () => {
  it("gives one frame every 2 s of a short video, inside its length", () => {
    const sb = parseSpec(short.spec)!;
    const all = tiles(sb, bestLevel(sb)!, short.lengthSeconds);
    expect(all).toHaveLength(107);
    expect(all.at(-1)!.t).toBe(212);
  });

  it("cuts 3x3 sheets left to right, top to bottom", () => {
    const sb = parseSpec(short.spec)!;
    const all = tiles(sb, bestLevel(sb)!, short.lengthSeconds);
    expect(all[4]).toMatchObject({ x: 320, y: 180, width: 320, height: 180 });
    expect(all[4].sheet).toContain("storyboard3_L3/M0.jpg?");
    expect(all[9]).toMatchObject({ x: 0, y: 0 });
    expect(all[9].sheet).toContain("/M1.jpg?");
    expect(all[9].sheet).toMatch(/&sigh=rs\$AOn4CLCHZGerbRu0IiBb-AIyubx5_-E4oQ$/);
  });

  it("gives one frame every 10 s of a long video", () => {
    const sb = parseSpec(long.spec)!;
    const all = tiles(sb, bestLevel(sb)!, long.lengthSeconds);
    expect(all).toHaveLength(267);
    expect(new Set(all.map((t) => t.sheet)).size).toBe(30);
  });
});

describe("sheetUrl", () => {
  it("fills in the level and the sheet number", () => {
    const sb = parseSpec(lowres.spec)!;
    expect(sheetUrl(sb, bestLevel(sb)!, 2)).toMatch(
      /^https:\/\/i\.ytimg\.com\/sb\/YrM9I19GN2A\/storyboard3_L2\/M2\.jpg\?sqp=.+&sigh=rs\$/,
    );
  });
});

describe("spec validation (M5: names and signatures go into URLs)", () => {
  const level = (name: string, sigh: string) => short.spec.replace("#M$M#rs$AOn4CLCHZGerbRu0IiBb-AIyubx5_-E4oQ", () => `#${name}#${sigh}`);

  it("accepts every name and signature in the captured specs", () => {
    for (const spec of [short.spec, long.spec, lowres.spec]) expect(parseSpec(spec)).not.toBeNull();
  });

  it("refuses names and signatures with anything but letters, digits, _, $ and -", () => {
    expect(parseSpec(level("M$M", "rs$abc&evil=1"))).toBeNull();
    expect(parseSpec(level("../M$M", "rs$abc"))).toBeNull();
    expect(parseSpec(level("M$M", "rs$abc/x"))).toBeNull();
    expect(parseSpec(level("M$&", "rs$abc"))).toBeNull();
    expect(parseSpec(level("M$M", ""))).toBeNull();
    expect(parseSpec(level("M$M", "rs$abc"))).not.toBeNull();
  });

  it("puts a $$ in a name into the URL as it is, not as a replacement pattern", () => {
    const sb = parseSpec(level("M$$", "rs$abc"))!;
    expect(sheetUrl(sb, sb.levels[3], 0)).toContain("/storyboard3_L3/M$$.jpg?");
  });
});
