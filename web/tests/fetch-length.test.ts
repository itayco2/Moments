import { describe, expect, it } from "vitest";
import { ABANDONED_MESSAGE, modelFetch, sizeFor, withKnownLength } from "../src/fetch-length";

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

describe("modelFetch closes answers nobody reads (PF25)", () => {
  const URL_DATA = "/models/daa72c5/m/onnx/model_q4.onnx_data";
  const URL_OTHER = "/models/daa72c5/m/onnx/vision_encoder_quantized.onnx_data";
  const FILES2 = [
    { path: "onnx/model_q4.onnx_data", size: 3 },
    { path: "onnx/vision_encoder_quantized.onnx_data", size: 3 },
  ];

  // Every answer is a stream that records whether it was cancelled, like a network body still arriving.
  function setup() {
    const cancelled: boolean[] = [];
    const fake = async () => {
      const i = cancelled.push(false) - 1;
      const body = new ReadableStream<Uint8Array>({
        pull: (c) => c.enqueue(new Uint8Array([1, 2, 3])),
        cancel: () => {
          cancelled[i] = true;
        },
      });
      return new Response(body, { status: 200 });
    };
    return { cancelled, fetchModel: modelFetch(fake, FILES2) };
  }

  it("closes the size probe's unread answer when the same file is asked for again", async () => {
    // transformers.js reads only the headers of its first request for each file and never closes it; over
    // HTTP/2 the unread 200 MB answers held the shared connection until every download stopped.
    const { cancelled, fetchModel } = setup();
    await fetchModel(URL_DATA);
    const real = await fetchModel(URL_DATA);
    expect(cancelled).toEqual([true, false]);
    const { value } = await real.body!.getReader().read();
    expect(Array.from(value!)).toEqual([1, 2, 3]);
  });

  it("never closes an answer that is being read", async () => {
    const { cancelled, fetchModel } = setup();
    const first = await fetchModel(URL_DATA);
    const reader = first.body!.getReader();
    await fetchModel(URL_DATA);
    expect(cancelled).toEqual([false, false]);
    expect((await reader.read()).done).toBe(false);
  });

  it("leaves other files' answers alone", async () => {
    const { cancelled, fetchModel } = setup();
    await fetchModel(URL_DATA);
    await fetchModel(URL_OTHER);
    expect(cancelled).toEqual([false, false]);
  });

  it("fails loudly when a cancelled answer is read after all, instead of ending as an empty, finished file", async () => {
    // A cancelled stream reads as {done: true}; transformers.js would take that for a complete file, fill it
    // with zeros and keep it in its cache for good, with no error.
    async function droppedAnswer() {
      const { cancelled, fetchModel } = setup();
      const dropped = await fetchModel(URL_DATA);
      await fetchModel(URL_DATA);
      expect(cancelled).toEqual([true, false]);
      return dropped;
    }
    const message = "Moments: a model download was cancelled before it was read";
    expect(ABANDONED_MESSAGE).toBe(message);
    await expect((await droppedAnswer()).body!.getReader().read()).rejects.toThrow(message);
    await expect((await droppedAnswer()).arrayBuffer()).rejects.toThrow(message);
  });

  it("hands on every byte of an answer that is read, and reads nothing from the network before that", async () => {
    let pulls = 0;
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const network = new ReadableStream<Uint8Array>(
      { pull: (c) => (pulls < chunks.length ? c.enqueue(chunks[pulls++]) : c.close()) },
      { highWaterMark: 0 },
    );
    const fetchModel = modelFetch(async () => new Response(network, { status: 200 }), FILES2);
    const res = await fetchModel(URL_DATA);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pulls).toBe(0);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("passes an answer without a body through", async () => {
    const fetchModel = modelFetch(async () => new Response(null, { status: 204 }), FILES2);
    const res = await fetchModel(URL_DATA);
    await fetchModel(URL_DATA);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
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
