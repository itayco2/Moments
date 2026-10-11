import { describe, expect, it } from "vitest";
import { MAX_FRAMES_PER_MESSAGE, MAX_QUERY, MAX_READ_FRAMES, MAX_SPEC_CHARS, parseToEngine } from "../src/protocol";

const jpeg = "data:image/jpeg;base64,/9j/4AAQ";

describe("parseToEngine", () => {
  it("accepts the five message kinds", () => {
    expect(parseToEngine({ type: "open", videoId: "dQw4w9WgXcQ", duration: 213, spec: null, autoRead: true })).toMatchObject({ type: "open" });
    expect(parseToEngine({ type: "search", id: 3, videoId: "dQw4w9WgXcQ", query: "a man singing" })).toMatchObject({ type: "search", id: 3 });
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: 4, jpeg }] })).toMatchObject({ type: "full-frames" });
    expect(parseToEngine({ type: "full-start", videoId: "dQw4w9WgXcQ", after: null })).toEqual({ type: "full-start", videoId: "dQw4w9WgXcQ", after: null });
    expect(parseToEngine({ type: "full-start", videoId: "dQw4w9WgXcQ", after: 130 })).toMatchObject({ after: 130 });
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: false, sent: 12 })).toEqual({
      type: "full-end",
      videoId: "dQw4w9WgXcQ",
      complete: false,
      sent: 12,
    });
  });

  it("refuses a full-detail read without a valid start point or frame count", () => {
    expect(parseToEngine({ type: "full-start", videoId: "dQw4w9WgXcQ" })).toBeNull();
    expect(parseToEngine({ type: "full-start", videoId: "dQw4w9WgXcQ", after: -1 })).toBeNull();
    expect(parseToEngine({ type: "full-start", videoId: "dQw4w9WgXcQ", after: "0" })).toBeNull();
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: true })).toBeNull();
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: true, sent: 1.5 })).toBeNull();
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: true, sent: -1 })).toBeNull();
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: true, sent: MAX_READ_FRAMES + 1 })).toBeNull();
  });

  it("refuses malformed or oversized messages", () => {
    expect(parseToEngine({ type: "search", id: 1, videoId: "dQw4w9WgXcQ", query: "x".repeat(MAX_QUERY + 1) })).toBeNull();
    expect(parseToEngine({ type: "search", id: 1, videoId: "bad", query: "a" })).toBeNull();
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: -1, jpeg }] })).toBeNull();
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: 1, jpeg: "data:text/html,hi" }] })).toBeNull();
    const many = Array.from({ length: MAX_FRAMES_PER_MESSAGE + 1 }, (_, t) => ({ t, jpeg }));
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: many })).toBeNull();
    expect(parseToEngine({ type: "open", videoId: "dQw4w9WgXcQ", duration: 213, spec: 5, autoRead: true })).toBeNull();
    expect(parseToEngine({ type: "unknown" })).toBeNull();
  });

  it("caps the preview spec at the length the page reader allows", () => {
    const prefix = "https://i.ytimg.com/sb/dQw4w9WgXcQ/";
    const open = (spec: string) => parseToEngine({ type: "open", videoId: "dQw4w9WgXcQ", duration: 213, spec, autoRead: true });
    expect(open(prefix + "x".repeat(MAX_SPEC_CHARS - prefix.length))).toMatchObject({ type: "open" });
    expect(open(prefix + "x".repeat(MAX_SPEC_CHARS - prefix.length + 1))).toBeNull();
    expect(open(prefix + "x".repeat(1_000_000))).toBeNull();
  });
});
