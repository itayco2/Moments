import { describe, expect, it, vi } from "vitest";
import { reloadPlayer } from "../src/player-reload";
import { CONTENT_SOURCE, parseReloadMessage } from "../src/protocol";

const ok = { source: CONTENT_SOURCE, type: "reload", videoId: "ANv5UfZsvZQ", at: 41.5, play: true };

describe("parseReloadMessage (the page can post it too)", () => {
  it("accepts the content script's request", () => {
    expect(parseReloadMessage(ok)).toEqual({ videoId: "ANv5UfZsvZQ", at: 41.5, play: true });
  });

  it("refuses other senders, bad ids, times and flags", () => {
    expect(parseReloadMessage({ ...ok, source: "moments-page" })).toBeNull();
    expect(parseReloadMessage({ ...ok, type: "video" })).toBeNull();
    expect(parseReloadMessage({ ...ok, videoId: "x" })).toBeNull();
    expect(parseReloadMessage({ ...ok, at: -1 })).toBeNull();
    expect(parseReloadMessage({ ...ok, at: Number.NaN })).toBeNull();
    expect(parseReloadMessage({ ...ok, at: "1" })).toBeNull();
    expect(parseReloadMessage({ ...ok, play: 1 })).toBeNull();
    expect(parseReloadMessage(null)).toBeNull();
  });
});

describe("reloadPlayer", () => {
  const player = () => ({ loadVideoById: vi.fn(), cueVideoById: vi.fn() });

  it("loads the video again at the second, playing when it was playing", () => {
    const p = player();
    expect(reloadPlayer(p, "ANv5UfZsvZQ", { videoId: "ANv5UfZsvZQ", at: 41.5, play: true })).toBe(true);
    expect(p.loadVideoById).toHaveBeenCalledExactlyOnceWith({ videoId: "ANv5UfZsvZQ", startSeconds: 41.5 });
    expect(p.cueVideoById).not.toHaveBeenCalled();
  });

  it("cues it, paused at the second, when it was paused", () => {
    const p = player();
    reloadPlayer(p, "ANv5UfZsvZQ", { videoId: "ANv5UfZsvZQ", at: 12, play: false });
    expect(p.cueVideoById).toHaveBeenCalledExactlyOnceWith({ videoId: "ANv5UfZsvZQ", startSeconds: 12 });
  });

  it("never loads another video than the one in the player, and survives a player without the API", () => {
    const p = player();
    expect(reloadPlayer(p, "dQw4w9WgXcQ", { videoId: "ANv5UfZsvZQ", at: 1, play: true })).toBe(false);
    expect(p.loadVideoById).not.toHaveBeenCalled();
    expect(reloadPlayer({}, "ANv5UfZsvZQ", { videoId: "ANv5UfZsvZQ", at: 1, play: true })).toBe(false);
    expect(reloadPlayer(null, "ANv5UfZsvZQ", { videoId: "ANv5UfZsvZQ", at: 1, play: true })).toBe(false);
  });
});
