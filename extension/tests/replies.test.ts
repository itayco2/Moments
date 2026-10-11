import { describe, expect, it } from "vitest";
import { failureReplies, knownState } from "../src/engine/replies";

describe("knownState", () => {
  it("says what is known about a video that needs no reading", () => {
    expect(knownState("dQw4w9WgXcQ", { kind: "preview", times: [0, 2, 4] })).toEqual({
      type: "state",
      videoId: "dQw4w9WgXcQ",
      kind: "preview",
      reading: null,
      done: 3,
      total: 3,
      problem: null,
      message: "",
    });
  });
});

describe("failureReplies", () => {
  const boom = new Error("model failed to load");

  it("reports the problem with the real kind of the video", () => {
    const replies = failureReplies({ type: "full-end", videoId: "dQw4w9WgXcQ", complete: true }, "preview", boom);
    expect(replies).toEqual([
      { type: "state", videoId: "dQw4w9WgXcQ", kind: "preview", reading: null, done: 0, total: 0, problem: "error", message: "Error: model failed to load" },
    ]);
  });

  it("also answers a failed search under its id, so nobody waits forever", () => {
    const replies = failureReplies({ type: "search", id: 7, videoId: "dQw4w9WgXcQ", query: "a dog" }, "full", boom);
    expect(replies).toEqual([
      expect.objectContaining({ type: "state", kind: "full", problem: "error" }),
      { type: "results", id: 7, videoId: "dQw4w9WgXcQ", kind: "full", hits: [], weak: false },
    ]);
  });

  it("answers a failed search of an unknown video as kind none", () => {
    const replies = failureReplies({ type: "search", id: 8, videoId: "dQw4w9WgXcQ", query: "a dog" }, "none", boom);
    expect(replies.at(-1)).toMatchObject({ type: "results", id: 8, kind: "none", hits: [] });
  });
});
