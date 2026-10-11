import { describe, expect, it } from "vitest";
import { modelFetch, sizeFor, withKnownLength } from "../src/fetch-length";

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

describe("modelFetch", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response("x".repeat(5), { status: 200 });
  };
  const fetchModel = modelFetch(fake, [{ path: "onnx/model_q4.onnx_data", size: 5 }]);

  it("keeps model files out of the browser's HTTP cache, which failed on 200 MB files and crashed the tab (PF24)", async () => {
    const res = await fetchModel("/models/daa72c5/m/onnx/model_q4.onnx_data", { headers: { Range: "bytes=0-0" } });
    expect(calls.at(-1)?.init).toEqual({ headers: { Range: "bytes=0-0" }, cache: "no-store" });
    expect(res.headers.get("content-length")).toBe("5");
  });

  it("passes every other request through untouched", async () => {
    await fetchModel("https://site.app/demo/vectors.bin");
    expect(calls.at(-1)).toEqual({ url: "https://site.app/demo/vectors.bin", init: undefined });
  });
});

describe("modelFetch with the website's copy as a mirror", () => {
  const HF = "https://huggingface.co/onnx-community/m/resolve/";
  const SITE = "https://site.app/models/daa72c5/onnx-community/m/";
  const mirror = { from: HF, to: SITE };
  const files = [
    { path: "tokenizer_config.json", size: 7 },
    { path: "onnx/model_q4.onnx_data", size: 5 },
  ];

  // answers[url] is the response (or an Error to throw) for that URL; any other URL is a 404.
  function setup(answers: Record<string, Response | Error>, withMirror = true) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const answer = answers[url];
      if (answer instanceof Error) throw answer;
      return answer ?? new Response("missing", { status: 404 });
    };
    return { calls, fetchModel: modelFetch(fake, files, withMirror ? mirror : undefined) };
  }

  it("asks the website's copy first for a Hugging Face URL of a hosted file, whatever the revision", async () => {
    const { calls, fetchModel } = setup({ [`${SITE}tokenizer_config.json`]: new Response("{ok:1}", { status: 200 }) });
    const res = await fetchModel(`${HF}main/tokenizer_config.json`);
    expect(calls.map((c) => c.url)).toEqual([`${SITE}tokenizer_config.json`]);
    expect(calls[0].init).toEqual({ cache: "no-store" });
    expect(await res.text()).toBe("{ok:1}");
    expect(res.headers.get("content-length")).toBe("7");
  });

  it("finds the website's copy under a pinned revision and with a query string too", async () => {
    const { calls, fetchModel } = setup({ [`${SITE}onnx/model_q4.onnx_data`]: new Response("xxxxx") });
    await fetchModel(`${HF}daa72c51243991dfcaf9f9137d2c573d8f7790c0/onnx/model_q4.onnx_data?download=true`);
    expect(calls.map((c) => c.url)).toEqual([`${SITE}onnx/model_q4.onnx_data`]);
  });

  it("falls back to Hugging Face when the website's copy throws", async () => {
    const hf = `${HF}main/tokenizer_config.json`;
    const { calls, fetchModel } = setup({ [`${SITE}tokenizer_config.json`]: new TypeError("Failed to fetch"), [hf]: new Response("{hf:1}") });
    const res = await fetchModel(hf);
    expect(calls.map((c) => c.url)).toEqual([`${SITE}tokenizer_config.json`, hf]);
    expect(calls[1].init).toEqual({ cache: "no-store" });
    expect(await res.text()).toBe("{hf:1}");
    expect(res.headers.get("content-length")).toBe("7");
  });

  it("falls back to Hugging Face when the website's copy answers 404", async () => {
    const hf = `${HF}main/tokenizer_config.json`;
    const { calls, fetchModel } = setup({ [hf]: new Response("{hf:1}") });
    const res = await fetchModel(hf);
    expect(calls.map((c) => c.url)).toEqual([`${SITE}tokenizer_config.json`, hf]);
    expect(await res.text()).toBe("{hf:1}");
  });

  it("returns Hugging Face's error when both copies fail", async () => {
    const { fetchModel } = setup({});
    const res = await fetchModel(`${HF}main/tokenizer_config.json`);
    expect(res.status).toBe(404);
  });

  it("sends a Range metadata probe to the website's copy with its headers and returns the 206", async () => {
    const probe = new Response("x", { status: 206, headers: { "content-range": "bytes 0-0/5" } });
    const { calls, fetchModel } = setup({ [`${SITE}onnx/model_q4.onnx_data`]: probe });
    const res = await fetchModel(`${HF}daa72c5/onnx/model_q4.onnx_data`, { method: "GET", headers: { Range: "bytes=0-0" } });
    expect(calls).toEqual([
      { url: `${SITE}onnx/model_q4.onnx_data`, init: { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" } },
    ]);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-0/5");
  });

  it("leaves URLs that are not hosted files exactly as before", async () => {
    const other = `${HF}main/generation_config.json`;
    const { calls, fetchModel } = setup({ [other]: new Response("{}") });
    await fetchModel(other, { headers: { a: "b" } });
    expect(calls).toEqual([{ url: other, init: { headers: { a: "b" } } }]);
  });

  it("leaves hosted files alone when no mirror is given", async () => {
    const hf = `${HF}main/tokenizer_config.json`;
    const { calls, fetchModel } = setup({ [hf]: new Response("{hf:1}") }, false);
    const res = await fetchModel(hf);
    expect(calls).toEqual([{ url: hf, init: { cache: "no-store" } }]);
    expect(res.headers.get("content-length")).toBe("7");
  });

  it("does not redirect the website's own URLs (nothing to mirror)", async () => {
    const own = `${SITE}tokenizer_config.json`;
    const { calls, fetchModel } = setup({ [own]: new Response("{ok:1}") });
    await fetchModel(own);
    expect(calls.map((c) => c.url)).toEqual([own]);
  });
});
