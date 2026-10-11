import { describe, expect, it } from "vitest";
import { MAX_DURATION_S, MAX_SPEC_CHARS, PAGE_SOURCE, parsePageMessage } from "../src/protocol";
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

describe("parsePageMessage negatives (T5: anything on the page can post a message)", () => {
  it("refuses values that are not a message object", () => {
    for (const data of [null, undefined, 0, true, "video", [], [wrap(good)]]) expect(parsePageMessage(data)).toBeNull();
  });

  it("refuses another message type and a missing or non-object info", () => {
    expect(parsePageMessage({ ...wrap(good), type: "search" })).toBeNull();
    expect(parsePageMessage({ source: PAGE_SOURCE, type: "video" })).toBeNull();
    expect(parsePageMessage(wrap(null))).toBeNull();
    expect(parsePageMessage(wrap("dQw4w9WgXcQ"))).toBeNull();
  });

  it("refuses a video id that is not exactly 11 id characters", () => {
    for (const videoId of [123, "", "dQw4w9WgXc", "dQw4w9WgXcQQ", "dQw4w9WgXc!", "dQw4w9WgXc/", " dQw4w9WgXc", null]) {
      expect(parsePageMessage(wrap({ ...good, videoId }))).toBeNull();
    }
  });

  it("refuses a length that is not a number from 0 to 48 hours", () => {
    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, "213", null, undefined, MAX_DURATION_S + 1]) {
      expect(parsePageMessage(wrap({ ...good, duration }))).toBeNull();
    }
    expect(parsePageMessage(wrap({ ...good, duration: 0 }))).toMatchObject({ duration: 0 });
  });

  it("refuses a preview spec that is not YouTube's for this very video, or too long", () => {
    const prefix = `https://i.ytimg.com/sb/${good.videoId}/`;
    for (const spec of [
      42,
      undefined,
      `https://i.ytimg.com/sb/aaaaaaaaaaa/${short.spec.slice(prefix.length)}`,
      `http://i.ytimg.com/sb/${good.videoId}/storyboard3_L$L/$N.jpg?x`,
      `https://i.ytimg.com.evil.example/sb/${good.videoId}/x`,
      `${prefix}${"x".repeat(MAX_SPEC_CHARS)}`,
    ]) {
      expect(parsePageMessage(wrap({ ...good, spec }))).toBeNull();
    }
  });

  it("refuses a live flag that is not a boolean", () => {
    for (const live of [1, 0, "true", null, undefined]) expect(parsePageMessage(wrap({ ...good, live }))).toBeNull();
  });

  it("passes on only the four known fields", () => {
    const parsed = parsePageMessage(wrap({ ...good, extra: "<img src=x onerror=alert(1)>", spec: null }));
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["duration", "live", "spec", "videoId"]);
  });
});
