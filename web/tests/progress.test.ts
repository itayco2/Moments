import { describe, expect, it } from "vitest";
import { DownloadTally } from "../src/progress";

describe("DownloadTally", () => {
  it("sums several files", () => {
    const t = new DownloadTally();
    t.update({ file: "model.onnx", loaded: 50, total: 200 });
    t.update({ file: "vision.onnx", loaded: 10, total: 100 });
    expect([t.loaded, t.total]).toEqual([60, 300]);
    expect(t.fraction).toBeCloseTo(0.2);
  });

  it("never moves backwards when events arrive out of order", () => {
    const t = new DownloadTally();
    t.update({ file: "a", loaded: 80, total: 100 });
    t.update({ file: "a", loaded: 30, total: 100 });
    expect(t.loaded).toBe(80);
  });

  it("marks a finished file complete", () => {
    const t = new DownloadTally();
    t.update({ file: "a", loaded: 99, total: 100 });
    t.done("a");
    expect(t.fraction).toBe(1);
  });

  it("reports zero before anything is known", () => {
    expect(new DownloadTally().fraction).toBe(0);
  });
});
