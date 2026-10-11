import { describe, expect, it } from "vitest";
import { MAX_QUEUED_READS, ReadQueue } from "../src/engine/queue";

const id = (n: number) => `video${String(n).padStart(6, "0")}`;
const request = (videoId: string) => ({ videoId, duration: 200, spec: "https://i.ytimg.com/sb/x" });

describe("ReadQueue", () => {
  it("hands out the most recently opened video first", () => {
    const q = new ReadQueue<string>();
    q.add(request(id(1)), "tab1");
    q.add(request(id(2)), "tab2");
    expect(q.next()?.videoId).toBe(id(2));
    expect(q.next()?.videoId).toBe(id(1));
    expect(q.next()).toBeNull();
  });

  it("keeps at most 32 waiting reads and drops the oldest", () => {
    const q = new ReadQueue<string>();
    const dropped = Array.from({ length: MAX_QUEUED_READS + 3 }, (_, n) => q.add(request(id(n)), `tab${n}`));
    expect(MAX_QUEUED_READS).toBe(32);
    expect(dropped.filter(Boolean).map((j) => j?.videoId)).toEqual([id(0), id(1), id(2)]);
    expect(dropped.find(Boolean)?.ports).toEqual(new Set(["tab0"]));
    const order: string[] = [];
    for (let job = q.next(); job; job = q.next()) order.push(job.videoId);
    expect(order).toHaveLength(MAX_QUEUED_READS);
    expect(order[0]).toBe(id(MAX_QUEUED_READS + 2));
    expect(order.at(-1)).toBe(id(3));
  });

  it("queues a video once and remembers every tab that asked for it", () => {
    const q = new ReadQueue<string>();
    q.add(request(id(1)), "tab1");
    q.add(request(id(2)), "tab2");
    q.add(request(id(1)), "tab3");
    const first = q.next();
    expect(first?.videoId).toBe(id(1)); // asked for again, so it is the newest request
    expect(first?.ports).toEqual(new Set(["tab1", "tab3"]));
    expect(q.next()?.videoId).toBe(id(2));
    expect(q.next()).toBeNull();
  });

  it("lets a tab join the read that is already running", () => {
    const q = new ReadQueue<string>();
    q.add(request(id(1)), "tab1");
    const running = q.next();
    expect(q.add(request(id(1)), "tab2")).toBeNull();
    expect(running?.ports).toEqual(new Set(["tab1", "tab2"]));
    expect(q.next()).toBeNull(); // no second read of the same video
  });

  it("starts a new read once the running one is finished", () => {
    const q = new ReadQueue<string>();
    q.add(request(id(1)), "tab1");
    q.next();
    q.finish();
    q.add(request(id(1)), "tab2");
    expect(q.next()?.ports).toEqual(new Set(["tab2"]));
  });
});
