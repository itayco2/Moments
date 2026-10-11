import { describe, expect, it } from "vitest";
import { mergePartial } from "../src/engine/library";

const vec = (...xs: number[]) => Float32Array.from(xs);

describe("mergePartial", () => {
  it("keeps the full-detail frames and the preview frames after the last one read", () => {
    const full = { times: [0, 2, 4], vectors: vec(1, 1, 2, 2, 3, 3) };
    const preview = { times: [0, 10, 20], vectors: vec(9, 9, 8, 8, 7, 7) };
    const merged = mergePartial(full, preview, 2);
    expect(merged.times).toEqual([0, 2, 4, 10, 20]);
    expect(Array.from(merged.vectors)).toEqual([1, 1, 2, 2, 3, 3, 8, 8, 7, 7]);
  });

  it("is just the full-detail frames when there was no preview", () => {
    const full = { times: [0, 2], vectors: vec(1, 1, 2, 2) };
    expect(mergePartial(full, null, 2)).toEqual(full);
  });
});
