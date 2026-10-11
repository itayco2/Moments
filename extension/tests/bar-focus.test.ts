import { describe, expect, it } from "vitest";
import { canFocusBar } from "../src/content/bar";

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
