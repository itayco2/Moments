// The TypeScript search must return what Python returns on the exported demo library (same fp16 vectors).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type DemoJson, parseDemo } from "../src/library";
import { search } from "../src/search";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const files = { json: at("../public/demo/library.json"), bin: at("../public/demo/vectors.bin"), golden: at("./golden.json") };
const ready = Object.values(files).every(existsSync);

describe.skipIf(!ready)("golden results from Python", () => {
  const json = JSON.parse(readFileSync(files.json, "utf-8")) as DemoJson;
  const bin = readFileSync(files.bin);
  const bytes = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const { library, examples } = parseDemo(json, bytes, "/demo/");
  const golden = JSON.parse(readFileSync(files.golden, "utf-8")) as { query: string; hits: [string, number][] }[];

  it.each(golden)("$query", ({ query, hits }) => {
    const example = examples.find((e) => e.query === query);
    expect(example).toBeDefined();
    const got = search(library.rows, library.vectors, library.dim, example!.vector, hits.length);
    expect(got.map((h) => [h.video, h.start])).toEqual(hits);
  });
});
