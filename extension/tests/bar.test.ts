import { describe, expect, it } from "vitest";
import { canFocusBar, nextPlace } from "../src/content/bar";

// Stand-ins for DOM nodes: an element "contains" the nodes listed in it.
const bar = { name: "moments-bar" } as unknown as Node;
const element = (...inside: Node[]) => ({ contains: (node: Node | null) => inside.includes(node as Node) });

describe("canFocusBar (Alt+M in fullscreen)", () => {
  it("focuses the bar when nothing is fullscreen", () => {
    expect(canFocusBar(null, bar)).toBe(true);
  });

  it("leaves YouTube's keys alone in fullscreen, where the bar under the player is hidden", () => {
    expect(canFocusBar(element(), bar)).toBe(false);
  });

  it("focuses the bar in fullscreen when it floats on the player that is fullscreen", () => {
    expect(canFocusBar(element(bar), bar)).toBe(true);
  });
});

describe("nextPlace (the bar under the player, also when the page reports the video first)", () => {
  it("goes under the player when that space exists", () => {
    expect(nextPlace(null, true, true)).toBe("below");
  });

  it("floats on the player until the space under it exists, then moves under it", () => {
    expect(nextPlace(null, false, true)).toBe("floating");
    expect(nextPlace("floating", false, true)).toBeNull();
    expect(nextPlace("floating", true, true)).toBe("below");
  });

  it("stays put under the player, and waits when there is no player yet", () => {
    expect(nextPlace("below", true, true)).toBeNull();
    expect(nextPlace(null, false, false)).toBeNull();
  });
});
