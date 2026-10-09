import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs build script, tested here without type declarations
import { expectedHash, gitBlobSha1, ranges } from "../scripts/model-files.mjs";
import { expectedBytes, MODEL_REVISION, modelPath, onnxFiles, TEXT_DTYPE, VISION_DTYPE } from "../src/config";
import model from "../src/model.json";

describe("ranges", () => {
  it("covers a file end to end with no gap and no overlap", () => {
    const parts: [number, number][] = ranges(100, 30);
    expect(parts).toEqual([[0, 29], [30, 59], [60, 89], [90, 99]]);
  });

  it("is one range for a file smaller than a chunk", () => {
    expect(ranges(10, 30)).toEqual([[0, 9]]);
  });
});

describe("hashes", () => {
  it("computes git's blob hash, which Hugging Face reports for small files", () => {
    // The empty blob's hash is the same in every git repository.
    expect(gitBlobSha1(Buffer.alloc(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("checks large files by their SHA-256 and small ones by their git hash", () => {
    const content = Buffer.from("hello");
    const sha256 = createHash("sha256").update(content).digest("hex");
    expect(expectedHash({ oid: "abc", lfs: { oid: sha256 } })).toEqual({ kind: "sha256", hex: sha256 });
    expect(expectedHash({ oid: "abc" })).toEqual({ kind: "git", hex: "abc" });
  });
});

describe("the self-hosted model", () => {
  it("lives under the pinned revision, so its files can be cached forever", () => {
    expect(model.revision).toBe(MODEL_REVISION);
    expect(modelPath("/")).toBe(`/models/${MODEL_REVISION.slice(0, 7)}/`);
  });

  it("includes exactly the ONNX files the configured precisions load", () => {
    expect(onnxFiles("q4", "q8")).toEqual([
      "onnx/model_q4.onnx",
      "onnx/model_q4.onnx_data",
      "onnx/vision_encoder_quantized.onnx",
      "onnx/vision_encoder_quantized.onnx_data",
    ]);
    const paths = model.files.map((f) => f.path);
    for (const file of onnxFiles(TEXT_DTYPE, VISION_DTYPE)) expect(paths).toContain(file);
  });

  it("knows how many bytes each load reads: text only for the demo, everything for your own videos", () => {
    const all = model.files.reduce((sum, f) => sum + f.size, 0);
    const vision = model.files.filter((f) => f.path.includes("vision_encoder")).reduce((sum, f) => sum + f.size, 0);
    expect(expectedBytes(true)).toBe(all);
    expect(expectedBytes(false)).toBe(all - vision);
  });
});
