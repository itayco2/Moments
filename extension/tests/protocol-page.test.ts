import { describe, expect, it } from "vitest";
import { PAGE_SOURCE, parsePageMessage } from "../src/protocol";
import short from "./fixtures/spec_short.json";

const good = { videoId: "dQw4w9WgXcQ", duration: 213, spec: short.spec, live: false };
const wrap = (info: unknown) => ({ source: PAGE_SOURCE, type: "video", info });

describe("parsePageMessage (the page is untrusted)", () => {
  it("accepts a well-formed message from the page reader", () => {
    expect(parsePageMessage(wrap(good))).toEqual(good);
  });

  it("refuses other senders and malformed fields", () => {
    expect(parsePageMessage({ ...wrap(good), source: "someone-else" })).toBeNull();
    expect(parsePageMessage(wrap({ ...good, videoId: "x" }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, duration: -1 }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, duration: 1e9 }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, spec: "https://evil.example/sb/dQw4w9WgXcQ/x" }))).toBeNull();
    expect(parsePageMessage(wrap({ ...good, live: "no" }))).toBeNull();
    expect(parsePageMessage("hello")).toBeNull();
  });

  it("accepts a video without previews", () => {
    expect(parsePageMessage(wrap({ ...good, spec: null }))).toMatchObject({ spec: null });
  });
});
