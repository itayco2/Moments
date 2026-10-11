import { describe, expect, it } from "vitest";
import { videoInfo } from "../src/video-info";
import short from "./fixtures/spec_short.json";

const response = (over: Record<string, unknown> = {}, spec: unknown = short.spec) => ({
  videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213", isLive: false, ...over },
  storyboards: { playerStoryboardSpecRenderer: { spec } },
});

describe("videoInfo", () => {
  it("reads id, length and preview spec from YouTube's player response", () => {
    expect(videoInfo(response())).toEqual({ videoId: "dQw4w9WgXcQ", duration: 213, spec: short.spec, live: false });
  });

  it("drops a preview spec that belongs to another video (seen after in-page navigation)", () => {
    expect(videoInfo(response({ videoId: "aaaaaaaaaaa" }))?.spec).toBeNull();
  });

  it("marks live streams and survives a missing spec", () => {
    // `undefined` would trigger the helper's default parameter, so a missing spec is passed as null.
    expect(videoInfo(response({ isLive: true }, null))).toMatchObject({ live: true, spec: null });
    expect(videoInfo({ videoDetails: { videoId: "dQw4w9WgXcQ", isLive: true } })).toMatchObject({ live: true, spec: null, duration: 0 });
  });

  it("refuses anything without a proper video id", () => {
    expect(videoInfo(null)).toBeNull();
    expect(videoInfo({ videoDetails: { videoId: "<script>" } })).toBeNull();
  });
});
