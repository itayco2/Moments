import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIM, Library, mergePartial } from "../src/engine/library";
import { loadVideo, saveVideo, touchVideo } from "../src/engine/store";

// No IndexedDB in node: the store is replaced, so these tests see exactly what the library asks it to do.
vi.mock("../src/engine/store", () => ({
  loadVideo: vi.fn(async () => undefined),
  saveVideo: vi.fn(async () => undefined),
  touchVideo: vi.fn(async () => undefined),
}));

const vec = (...xs: number[]) => Float32Array.from(xs);
const frame = (x: number) => new Float32Array(DIM).fill(x);

describe("mergePartial", () => {
  it("keeps the full-detail frames and the preview frames after the last one read", () => {
    const full = { times: [0, 2, 4], vectors: vec(1, 1, 2, 2, 3, 3) };
    const preview = { times: [0, 10, 20], vectors: vec(9, 9, 8, 8, 7, 7) };
    const merged = mergePartial(full, preview, 2);
    expect(merged.times).toEqual([0, 2, 4, 10, 20]);
    expect(Array.from(merged.vectors)).toEqual([1, 1, 2, 2, 3, 3, 8, 8, 7, 7]);
  });

  it("is just the full-detail frames when there was no preview", () => {
    const full = { times: [0, 2], vectors: vec(1, 1, 2, 2) };
    expect(mergePartial(full, null, 2)).toEqual(full);
  });
});

describe("Library.open (recency for the storage cap)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshes the saved video's date when it is served from memory", async () => {
    const library = new Library();
    await library.put("dQw4w9WgXcQ", "preview", [0, 5], [frame(1), frame(2)]);
    vi.mocked(touchVideo).mockClear();

    const entry = await library.open("dQw4w9WgXcQ");

    expect(entry?.kind).toBe("preview");
    expect(touchVideo).toHaveBeenCalledExactlyOnceWith("dQw4w9WgXcQ");
    expect(loadVideo).not.toHaveBeenCalled();
  });

  it("does not write twice when it has to load from storage, because loading already refreshes the date", async () => {
    vi.mocked(loadVideo).mockResolvedValueOnce({
      videoId: "dQw4w9WgXcQ",
      kind: "preview",
      dim: DIM,
      times: Float32Array.from([0, 5]),
      vectors: new Uint16Array(2 * DIM),
    });
    const library = new Library();

    const entry = await library.open("dQw4w9WgXcQ");

    expect(entry?.times).toEqual([0, 5]);
    expect(loadVideo).toHaveBeenCalledOnce();
    expect(touchVideo).not.toHaveBeenCalled();
  });

  it("touches nothing for a video it has never seen", async () => {
    expect(await new Library().open("dQw4w9WgXcQ")).toBeNull();
    expect(touchVideo).not.toHaveBeenCalled();
  });

  it("still answers when the date cannot be refreshed", async () => {
    const library = new Library();
    await library.put("dQw4w9WgXcQ", "preview", [0, 5], [frame(1), frame(2)]);
    vi.mocked(touchVideo).mockRejectedValueOnce(new Error("storage busy"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await library.open("dQw4w9WgXcQ"))?.kind).toBe("preview");
  });
});

describe("Library full-detail reads belong to the tab that sends them", () => {
  const a = { name: "tab A" };
  const b = { name: "tab B" };
  beforeEach(() => vi.clearAllMocks());

  const savedTimes = () => Array.from(vi.mocked(saveVideo).mock.calls.at(-1)?.[0].times ?? []);

  it("saves the frames its owner sent", async () => {
    const library = new Library();
    library.addFull("dQw4w9WgXcQ", a, [0, 2], [frame(1), frame(2)]);
    library.addFull("dQw4w9WgXcQ", a, [4], [frame(3)]);

    const done = await library.finishFull("dQw4w9WgXcQ", true, a);

    expect(done?.kind).toBe("full");
    expect(savedTimes()).toEqual([0, 2, 4]);
  });

  it("drops the pending frames when their owner goes away", async () => {
    const library = new Library();
    library.addFull("dQw4w9WgXcQ", a, [0, 2], [frame(1), frame(2)]);

    library.dropPending(a);

    expect(await library.finishFull("dQw4w9WgXcQ", true, a)).toBeNull();
    expect(saveVideo).not.toHaveBeenCalled();
  });

  it("only drops the frames of the owner that left", async () => {
    const library = new Library();
    library.addFull("dQw4w9WgXcQ", a, [0], [frame(1)]);
    library.addFull("aaaaaaaaaaa", b, [0, 1], [frame(1), frame(2)]);

    library.dropPending(a);

    expect(await library.finishFull("aaaaaaaaaaa", true, b)).not.toBeNull();
    expect(savedTimes()).toEqual([0, 1]);
  });

  it("starts fresh when a batch arrives from another tab than the owner", async () => {
    const library = new Library();
    library.addFull("dQw4w9WgXcQ", a, [0, 2], [frame(1), frame(2)]);
    library.addFull("dQw4w9WgXcQ", b, [0], [frame(7)]);
    library.addFull("dQw4w9WgXcQ", b, [2], [frame(8)]);

    await library.finishFull("dQw4w9WgXcQ", true, b);

    expect(savedTimes()).toEqual([0, 2]);
    const saved = vi.mocked(saveVideo).mock.calls.at(-1)?.[0];
    expect(saved?.vectors).toHaveLength(2 * DIM);
  });

  it("does not let another tab finish a read it did not send", async () => {
    const library = new Library();
    library.addFull("dQw4w9WgXcQ", a, [0, 2], [frame(1), frame(2)]);

    expect(await library.finishFull("dQw4w9WgXcQ", false, b)).toBeNull();
    expect(saveVideo).not.toHaveBeenCalled();

    await library.finishFull("dQw4w9WgXcQ", true, a);
    expect(savedTimes()).toEqual([0, 2]);
  });
});
