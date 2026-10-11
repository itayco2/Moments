import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadyGate } from "../src/ready-gate";

describe("ReadyGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves a waiter when the announcement arrives", async () => {
    const gate = new ReadyGate(10_000, "the engine");
    const waiting = gate.wait();
    gate.announce();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("resolves at once when the announcement came before anyone waited", async () => {
    const gate = new ReadyGate(10_000, "the engine");
    gate.announce();
    await expect(gate.wait()).resolves.toBeUndefined();
  });

  it("forgets an old announcement when a new document is created", async () => {
    const gate = new ReadyGate(10_000, "the engine");
    gate.announce();
    gate.reset();
    const outcome = expect(gate.wait()).rejects.toThrow(/the engine/);
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;
  });

  it("rejects with a clear message after the timeout", async () => {
    const gate = new ReadyGate(10_000, "the engine page");
    const outcome = expect(gate.wait()).rejects.toThrow("the engine page did not announce itself within 10 s");
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });

  it("wakes every waiter and leaves no timer running", async () => {
    const gate = new ReadyGate(10_000, "the engine");
    const both = Promise.all([gate.wait(), gate.wait()]);
    gate.announce();
    await both;
    expect(vi.getTimerCount()).toBe(0);
  });
});
