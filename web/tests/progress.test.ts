import { describe, expect, it } from "vitest";
import { DownloadTally, downloadStatus } from "../src/progress";

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

describe("downloadStatus", () => {
  const MB = 1e6;

  it("says what is downloading, how fast and how long is left", () => {
    expect(downloadStatus(110 * MB, 370 * MB, 22)).toBe(
      "Downloading the AI model to this browser, once: 110 of 370 MB, 5.0 MB/s, about 55 s left",
    );
  });

  it("rounds long waits to minutes", () => {
    expect(downloadStatus(20 * MB, 370 * MB, 20)).toBe(
      "Downloading the AI model to this browser, once: 20 of 370 MB, 1.0 MB/s, about 6 min left",
    );
  });

  it("leaves out the speed until there is enough to measure", () => {
    expect(downloadStatus(2 * MB, 370 * MB, 0.5)).toBe("Downloading the AI model to this browser, once: 2 of 370 MB");
  });

  it("says the model is being prepared once every byte has arrived", () => {
    expect(downloadStatus(370 * MB, 370 * MB, 80)).toBe("Preparing the AI model on your GPU");
  });

  it("says the download is starting before any size is known", () => {
    expect(downloadStatus(0, 0, 0)).toBe("Starting the AI model download");
  });
});
