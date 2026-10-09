import { describe, expect, it } from "vitest";
import { sizeFor, withKnownLength } from "../src/fetch-length";

const FILES = [
  { path: "config.json", size: 5031 },
  { path: "onnx/model_q4.onnx_data", size: 174028800 },
];

describe("sizeFor", () => {
  it("finds a model file's size from the end of its URL, local copy or Hugging Face", () => {
    expect(sizeFor("https://site.app/models/daa72c5/onnx-community/m/onnx/model_q4.onnx_data", FILES)).toBe(174028800);
    expect(sizeFor("https://huggingface.co/onnx-community/m/resolve/daa72c5/config.json", FILES)).toBe(5031);
  });

  it("accepts the relative path the worker asks for its own copy (it threw, and every file fell back to Hugging Face)", () => {
    expect(sizeFor("/models/daa72c5/onnx-community/m/config.json", FILES)).toBe(5031);
  });

  it("knows nothing about other files", () => {
    expect(sizeFor("https://site.app/demo/vectors.bin", FILES)).toBeUndefined();
    expect(sizeFor("https://site.app/models/x/my_config.json", FILES)).toBeUndefined();
  });
});

describe("withKnownLength", () => {
  it("adds the size a compressing server left out, keeping the body intact", async () => {
    const res = await withKnownLength(new Response("hello", { status: 200 }), 5);
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("leaves a response that already states its size alone", async () => {
    const original = new Response("hello", { headers: { "content-length": "5" } });
    expect(await withKnownLength(original, 999)).toBe(original);
  });

  it("leaves errors and range answers alone", async () => {
    const missing = new Response("nope", { status: 404 });
    expect(await withKnownLength(missing, 5)).toBe(missing);
    const range = new Response("h", { status: 206 });
    expect(await withKnownLength(range, 5)).toBe(range);
  });
});
