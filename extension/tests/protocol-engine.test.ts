import { describe, expect, it } from "vitest";
import { MAX_FRAMES_PER_MESSAGE, MAX_QUERY, parseToEngine } from "../src/protocol";

const jpeg = "data:image/jpeg;base64,/9j/4AAQ";

describe("parseToEngine", () => {
  it("accepts the four message kinds", () => {
    expect(parseToEngine({ type: "open", videoId: "dQw4w9WgXcQ", duration: 213, spec: null, autoRead: true })).toMatchObject({ type: "open" });
    expect(parseToEngine({ type: "search", id: 3, videoId: "dQw4w9WgXcQ", query: "a man singing" })).toMatchObject({ type: "search", id: 3 });
    expect(parseToEngine({ type: "full-frames", videoId: "dQw4w9WgXcQ", frames: [{ t: 4, jpeg }] })).toMatchObject({ type: "full-frames" });
    expect(parseToEngine({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: false })).toMatchObject({ complete: false });
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
});
