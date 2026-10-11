import { describe, expect, it } from "vitest";
import { IDLE_CHECK_MINUTES, IDLE_CHECKS_BEFORE_UNLOAD, idleStep } from "../src/idle";

describe("idleStep (M10: the model unloads about 10 minutes after the last video tab)", () => {
  it("unloads after 10 checks a minute apart with no video tab, so 9 to 10 minutes after the last one", () => {
    let checks = 0;
    const unloads: boolean[] = [];
    for (let minute = 1; minute <= IDLE_CHECKS_BEFORE_UNLOAD; minute++) {
      const step = idleStep(checks, false);
      checks = step.checks;
      unloads.push(step.unload);
    }
    expect(unloads.indexOf(true)).toBe(9);
    expect((IDLE_CHECKS_BEFORE_UNLOAD - 1) * IDLE_CHECK_MINUTES).toBe(9);
    expect(IDLE_CHECKS_BEFORE_UNLOAD * IDLE_CHECK_MINUTES).toBe(10);
  });

  it("starts counting again whenever a video tab is open", () => {
    expect(idleStep(9, true)).toEqual({ checks: 0, unload: false });
  });
});
