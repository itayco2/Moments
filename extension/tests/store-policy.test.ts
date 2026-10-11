import { describe, expect, it } from "vitest";
import { CAP_BYTES, entryBytes, evict } from "../src/store-policy";

describe("the 200 MB cap", () => {
  it("costs about half a megabyte for an hour of video read every 10 s", () => {
    expect(entryBytes(360, 768)).toBe(360 * (768 * 2 + 4));
    expect(entryBytes(360, 768) / 1e6).toBeCloseTo(0.55, 1);
  });

  it("drops the least recently opened videos first, only as many as needed", () => {
    const entries = [
      { videoId: "a", bytes: 60, lastOpened: 3 },
      { videoId: "b", bytes: 60, lastOpened: 1 },
      { videoId: "c", bytes: 60, lastOpened: 2 },
    ];
    expect(evict(entries, 100)).toEqual(["b", "c"]);
    expect(evict(entries, 130)).toEqual(["b"]);
    expect(evict(entries, 180)).toEqual([]);
  });

  it("is 200 MB in the units the popup shows", () => {
    expect(CAP_BYTES).toBe(200_000_000);
  });
});
