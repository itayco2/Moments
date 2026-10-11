import { describe, expect, it, vi } from "vitest";
import { Drainer, inOrder } from "../src/engine/drain";
import { ReadQueue } from "../src/engine/queue";

const request = (videoId: string) => ({ videoId, duration: 200, spec: "https://i.ytimg.com/sb/x" });

describe("Drainer (one preview read at a time)", () => {
  it("reports a read whose model call failed, stops reading, and reads the next video", async () => {
    const queue = new ReadQueue<string>();
    queue.add(request("first"), "tab1");
    queue.add(request("second"), "tab2"); // newest first: read before "first"
    const failed = vi.fn();
    const read = vi.fn(async (job: { videoId: string }) => {
      if (job.videoId === "second") throw new Error("the AI model failed twice");
    });
    const reads = new Drainer(queue, { alive: () => true, read, failed });

    await reads.drain();

    expect(read.mock.calls.map(([job]) => job.videoId)).toEqual(["second", "first"]);
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0][1]).toEqual(new Error("the AI model failed twice"));
    expect(reads.busy).toBe(false);
  });

  it("starts again after a failure when a new video is queued", async () => {
    const queue = new ReadQueue<string>();
    const read = vi.fn(async () => {
      throw new Error("no answer for 60 s");
    });
    const reads = new Drainer(queue, { alive: () => true, read, failed: () => undefined });
    queue.add(request("a"), "tab");
    await reads.drain();
    queue.add(request("b"), "tab");
    await reads.drain();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("skips a video whose tabs have all gone", async () => {
    const queue = new ReadQueue<string>();
    queue.add(request("gone"), "closed-tab");
    const read = vi.fn(async () => undefined);
    await new Drainer(queue, { alive: (p) => p !== "closed-tab", read, failed: () => undefined }).drain();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("inOrder (one tab's messages)", () => {
  it("runs tasks in order, and a failed task is reported without blocking the next", async () => {
    const run = inOrder();
    const order: string[] = [];
    const failures: unknown[] = [];
    void run(
      async () => {
        order.push("frames");
        throw new Error("embed failed");
      },
      (err) => void failures.push(err),
    );
    await run(
      async () => void order.push("end"),
      () => undefined,
    );
    expect(order).toEqual(["frames", "end"]);
    expect(failures).toEqual([new Error("embed failed")]);
  });

  it("keeps going when reporting a failure fails too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = inOrder();
    void run(
      async () => {
        throw new Error("a");
      },
      async () => {
        throw new Error("the tab is gone");
      },
    );
    const next = vi.fn(async () => undefined);
    await run(next, () => undefined);
    expect(next).toHaveBeenCalledOnce();
  });
});
