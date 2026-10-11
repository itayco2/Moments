import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIM, type Entry, fromSaved, Library, MAX_IN_MEMORY, mergePartial, mergeRead, needsPreviews, type Part } from "../src/engine/library";
import { loadVideo, saveVideo, touchVideo } from "../src/engine/store";

// No IndexedDB in node: the store is replaced, so these tests see exactly what the library asks it to do.
vi.mock("../src/engine/store", () => ({
  loadVideo: vi.fn(async () => undefined),
  saveVideo: vi.fn(async () => undefined),
  touchVideo: vi.fn(async () => undefined),
}));

const VIDEO = "dQw4w9WgXcQ";
const vec = (...xs: number[]) => Float32Array.from(xs);
const frame = (x: number) => new Float32Array(DIM).fill(x);
// One number per frame (dim 1) keeps the merge tests readable: the vector says where the frame came from.
const part = (times: number[], mark: number): Part => ({ times, vectors: Float32Array.from(times.map((t) => mark + t / 1000)) });
const saved = (kind: Entry["kind"], times: number[], readUntil: number, mark: number): Entry => ({ kind, readUntil, viewerStopped: false, dim: 1, rows: [], ...part(times, mark) });
const sources = (p: Part) => Array.from(p.vectors, (v) => Math.floor(v)); // 1 = preview, 2 = an earlier read, 3 = this read

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

describe("mergeRead (what a finished full-detail read leaves saved)", () => {
  const preview = saved("preview", [0, 10, 20, 30], 0, 1);
  const fresh = (times: number[], complete: boolean, sent = times.length) => ({ after: null, part: part(times, 3), complete, sent, byViewer: false });

  it("saves a read from 0:00 that went to the end and arrived whole as full", () => {
    const merged = mergeRead(preview, fresh([0, 4, 8, 12, 16, 20, 24, 28], true), 1);
    expect(merged).toMatchObject({ kind: "full", readUntil: 28 });
    expect(sources(merged!.part)).toEqual(Array(8).fill(3));
  });

  it("saves a read the viewer stopped as partial, with the preview frames after it", () => {
    const merged = mergeRead(preview, fresh([0, 4, 8, 12], false), 1);
    expect(merged).toMatchObject({ kind: "partial", readUntil: 12 });
    expect(merged!.part.times).toEqual([0, 4, 8, 12, 20, 30]);
    expect(sources(merged!.part)).toEqual([3, 3, 3, 3, 1, 1]);
  });

  it("saves a stopped read of a video without previews as partial, never as full", () => {
    expect(mergeRead(null, fresh([0, 4, 8], false), 1)).toMatchObject({ kind: "partial", readUntil: 8 });
  });

  it("saves a read that went to the end but lost frames on the way as partial", () => {
    expect(mergeRead(preview, fresh([0, 4, 12, 16], true, 5), 1)).toMatchObject({ kind: "partial", readUntil: 16 });
  });

  it("remembers a read the viewer stopped; one stopped otherwise or short of frames is not marked", () => {
    expect(mergeRead(preview, { ...fresh([0, 4], false), byViewer: true }, 1)).toMatchObject({ kind: "partial", viewerStopped: true });
    expect(mergeRead(preview, fresh([0, 4], false), 1)).toMatchObject({ kind: "partial", viewerStopped: false }); // a switch of video, the engine
    expect(mergeRead(preview, fresh([0, 4, 12], true, 4), 1)).toMatchObject({ kind: "partial", viewerStopped: false }); // lost frames
    expect(mergeRead(preview, fresh([0, 4, 8], true), 1)).toMatchObject({ kind: "full", viewerStopped: false });
  });

  it("never replaces a full read", () => {
    expect(mergeRead(saved("full", [0, 1, 2], 2, 2), fresh([0, 4, 8], true), 1)).toBeNull();
    expect(mergeRead(saved("full", [0, 1, 2], 2, 2), fresh([0, 4], false), 1)).toBeNull();
  });

  it("keeps a saved partial read that reaches further than a new one from 0:00", () => {
    expect(mergeRead(saved("partial", [0, 4, 8, 12, 20, 30], 12, 2), fresh([0, 4], false), 1)).toBeNull();
  });

  it("replaces a shorter partial read with a longer one from 0:00, keeping the previews after it", () => {
    const merged = mergeRead(saved("partial", [0, 4, 10, 20, 30], 4, 2), fresh([0, 4, 8, 12, 16], false), 1);
    expect(merged).toMatchObject({ kind: "partial", readUntil: 16 });
    expect(merged!.part.times).toEqual([0, 4, 8, 12, 16, 20, 30]);
    expect(sources(merged!.part)).toEqual([3, 3, 3, 3, 3, 2, 2]);
  });

  describe("a read that continues a partial one", () => {
    const partial = saved("partial", [0, 4, 8, 10, 20, 30], 8, 2); // full detail to 0:08, previews after

    it("joins it and becomes full when it reaches the end whole", () => {
      const merged = mergeRead(partial, { after: 8, part: part([12, 16, 20, 24, 28], 3), complete: true, sent: 5, byViewer: false }, 1);
      expect(merged).toMatchObject({ kind: "full", readUntil: 28 });
      expect(merged!.part.times).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
      expect(sources(merged!.part)).toEqual([2, 2, 2, 3, 3, 3, 3, 3]);
    });

    it("moves readUntil on when it stops again, keeping the previews after it", () => {
      const merged = mergeRead(partial, { after: 8, part: part([12, 16], 3), complete: false, sent: 2, byViewer: false }, 1);
      expect(merged).toMatchObject({ kind: "partial", readUntil: 16 });
      expect(merged!.part.times).toEqual([0, 4, 8, 12, 16, 20, 30]);
    });

    it("finishes a partial read whose plan had nothing left", () => {
      const merged = mergeRead(partial, { after: 8, part: part([], 3), complete: true, sent: 0, byViewer: false }, 1);
      expect(merged).toMatchObject({ kind: "full", readUntil: 8 });
      expect(merged!.part.times).toEqual([0, 4, 8]);
    });

    it("is dropped when the read it continues is gone (Forget all, the storage cap)", () => {
      const read = { after: 8, part: part([12, 16], 3), complete: true, sent: 2, byViewer: false };
      expect(mergeRead(null, read, 1)).toBeNull();
      expect(mergeRead(preview, read, 1)).toBeNull();
      expect(mergeRead(saved("partial", [0, 4], 4, 2), read, 1)).toBeNull();
    });
  });
});

describe("fromSaved (records from older builds keep loading)", () => {
  const record = (kind: string, readUntil?: number, viewerStopped?: boolean) =>
    ({ videoId: VIDEO, kind, readUntil, viewerStopped, dim: DIM, times: Float32Array.from([0, 5, 10]), vectors: new Uint16Array(3 * DIM) }) as never;

  it("reads an old full record, which has no readUntil, as full to its last frame", () => {
    expect(fromSaved(record("full"))).toMatchObject({ kind: "full", readUntil: 10 });
  });

  it("reads an old preview record as a preview", () => {
    expect(fromSaved(record("preview"))).toMatchObject({ kind: "preview", readUntil: 0 });
  });

  it("reads a partial record as partial, and one without readUntil as a preview so it is read again", () => {
    expect(fromSaved(record("partial", 5))).toMatchObject({ kind: "partial", readUntil: 5 });
    expect(fromSaved(record("partial"))).toMatchObject({ kind: "preview", readUntil: 0 });
    expect(fromSaved(record("something-new", 5))).toMatchObject({ kind: "preview" });
  });

  it("reads why a partial read stopped; a record from before the reason was kept counts as not the viewer", () => {
    expect(fromSaved(record("partial", 5, true))).toMatchObject({ kind: "partial", viewerStopped: true });
    expect(fromSaved(record("partial", 5))).toMatchObject({ kind: "partial", viewerStopped: false });
    expect(fromSaved(record("full", undefined, true))).toMatchObject({ kind: "full", viewerStopped: false });
  });
});

describe("Library.open (recency for the storage cap)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshes the saved video's date when it is served from memory", async () => {
    const library = new Library();
    await library.putPreview(VIDEO, library.stamp, [0, 5], [frame(1), frame(2)]);
    vi.mocked(touchVideo).mockClear();

    const entry = await library.open(VIDEO);

    expect(entry?.kind).toBe("preview");
    expect(touchVideo).toHaveBeenCalledExactlyOnceWith(VIDEO);
  });

  it("does not write twice when it has to load from storage, because loading already refreshes the date", async () => {
    vi.mocked(loadVideo).mockResolvedValueOnce({ videoId: VIDEO, kind: "preview", dim: DIM, times: Float32Array.from([0, 5]), vectors: new Uint16Array(2 * DIM) });
    const library = new Library();

    const entry = await library.open(VIDEO);

    expect(entry?.times).toEqual([0, 5]);
    expect(loadVideo).toHaveBeenCalledOnce();
    expect(touchVideo).not.toHaveBeenCalled();
  });

  it("touches nothing for a video it has never seen", async () => {
    expect(await new Library().open(VIDEO)).toBeNull();
    expect(touchVideo).not.toHaveBeenCalled();
  });

  it("still answers when the date cannot be refreshed", async () => {
    const library = new Library();
    await library.putPreview(VIDEO, library.stamp, [0, 5], [frame(1), frame(2)]);
    vi.mocked(touchVideo).mockRejectedValueOnce(new Error("storage busy"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await library.open(VIDEO))?.kind).toBe("preview");
  });
});

describe("Library full-detail reads", () => {
  const a = { name: "tab A" };
  const b = { name: "tab B" };
  beforeEach(() => vi.clearAllMocks());

  const lastSave = () => vi.mocked(saveVideo).mock.calls.at(-1)?.[0];
  const savedTimes = () => Array.from(lastSave()?.times ?? []);

  it("saves a whole read from 0:00 as full", async () => {
    const library = new Library();
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 2], [frame(1), frame(2)]);
    library.addFull(VIDEO, a, [4], [frame(3)]);

    const done = await library.finishFull(VIDEO, a, { complete: true, sent: 3, byViewer: false });

    expect(done?.kind).toBe("full");
    expect(lastSave()).toMatchObject({ kind: "full", readUntil: 4 });
    expect(savedTimes()).toEqual([0, 2, 4]);
  });

  it("ignores frames for a read its tab never started (a batch that arrives on a new line after a reconnect)", async () => {
    const library = new Library();
    expect(library.addFull(VIDEO, a, [8, 10], [frame(1), frame(2)])).toBe(false);
    expect(await library.finishFull(VIDEO, a, { complete: true, sent: 2, byViewer: false })).toBeNull();
    expect(saveVideo).not.toHaveBeenCalled();
  });

  it("drops the pending frames when their tab goes away", async () => {
    const library = new Library();
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 2], [frame(1), frame(2)]);

    library.dropPending(a);

    expect(await library.finishFull(VIDEO, a, { complete: true, sent: 2, byViewer: false })).toBeNull();
    expect(saveVideo).not.toHaveBeenCalled();
  });

  it("keeps two tabs reading one video apart, and the second cannot undo the first one's full read", async () => {
    const library = new Library();
    library.startFull(VIDEO, a, null);
    library.startFull(VIDEO, b, null);
    library.addFull(VIDEO, a, [0, 2], [frame(1), frame(2)]);
    library.addFull(VIDEO, b, [0], [frame(7)]);
    library.addFull(VIDEO, a, [4], [frame(3)]);

    const first = library.finishFull(VIDEO, a, { complete: true, sent: 3, byViewer: false });
    const second = library.finishFull(VIDEO, b, { complete: false, sent: 1, byViewer: false });

    expect((await first)?.kind).toBe("full");
    expect((await second)?.kind).toBe("full");
    expect(saveVideo).toHaveBeenCalledOnce();
    expect(savedTimes()).toEqual([0, 2, 4]);
  });

  it("saves a stopped read as partial and a later read that continues it as full", async () => {
    const library = new Library();
    await library.putPreview(VIDEO, library.stamp, [0, 10, 20], [frame(9), frame(9), frame(9)]);
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 4], [frame(1), frame(2)]);
    expect(await library.finishFull(VIDEO, a, { complete: false, sent: 2, byViewer: false })).toMatchObject({ kind: "partial", readUntil: 4, times: [0, 4, 10, 20] });

    library.startFull(VIDEO, b, 4);
    library.addFull(VIDEO, b, [8, 12, 16], [frame(3), frame(4), frame(5)]);
    const done = await library.finishFull(VIDEO, b, { complete: true, sent: 3, byViewer: false });

    expect(done).toMatchObject({ kind: "full", readUntil: 16, times: [0, 4, 8, 12, 16] });
  });

  it("never lets a preview read replace a full read", async () => {
    const library = new Library();
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 1], [frame(1), frame(2)]);
    await library.finishFull(VIDEO, a, { complete: true, sent: 2, byViewer: false });
    vi.mocked(saveVideo).mockClear();

    const after = await library.putPreview(VIDEO, library.stamp, [0, 10, 20], [frame(9), frame(9), frame(9)]);

    expect(after?.kind).toBe("full");
    expect(saveVideo).not.toHaveBeenCalled();
  });

  it("saves why a read stopped, and a preview that fills in after it keeps that", async () => {
    const library = new Library();
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 4], [frame(1), frame(2)]);
    await library.finishFull(VIDEO, a, { complete: false, sent: 2, byViewer: true });
    expect(lastSave()).toMatchObject({ kind: "partial", readUntil: 4, viewerStopped: true });

    const after = await library.putPreview(VIDEO, library.stamp, [0, 10, 20], [frame(9), frame(9), frame(9)]);

    expect(after).toMatchObject({ kind: "partial", viewerStopped: true, times: [0, 4, 10, 20] });
    expect(lastSave()).toMatchObject({ viewerStopped: true });
  });

  it("fills in the rest of a partial read when a preview read ends after it", async () => {
    const library = new Library();
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 4], [frame(1), frame(2)]);
    await library.finishFull(VIDEO, a, { complete: false, sent: 2, byViewer: false });

    const after = await library.putPreview(VIDEO, library.stamp, [0, 10, 20], [frame(9), frame(9), frame(9)]);

    expect(after).toMatchObject({ kind: "partial", readUntil: 4, times: [0, 4, 10, 20] });
  });

  it("saves nothing from reads that began before Forget all", async () => {
    const library = new Library();
    const previewStamp = library.stamp;
    library.startFull(VIDEO, a, null);
    library.addFull(VIDEO, a, [0, 2], [frame(1), frame(2)]);

    library.clear();

    expect(library.addFull(VIDEO, a, [4], [frame(3)])).toBe(false);
    expect(await library.finishFull(VIDEO, a, { complete: true, sent: 3, byViewer: false })).toBeNull();
    expect(await library.putPreview(VIDEO, previewStamp, [0, 10], [frame(9), frame(9)])).toBeNull();
    expect(saveVideo).not.toHaveBeenCalled();
    expect(await library.get(VIDEO)).toBeNull();
  });

  it("holds at most the most recently used videos in memory and reloads older ones from storage", async () => {
    const library = new Library();
    const id = (n: number) => `video${String(n).padStart(6, "0")}`;
    for (let n = 0; n <= MAX_IN_MEMORY; n++) await library.putPreview(id(n), library.stamp, [0, 5], [frame(1), frame(2)]);
    vi.mocked(loadVideo).mockClear();

    await library.get(id(MAX_IN_MEMORY));
    expect(loadVideo).not.toHaveBeenCalled();
    await library.get(id(0));
    expect(loadVideo).toHaveBeenCalledExactlyOnceWith(id(0));
  });
});

describe("needsPreviews (PF32: search covers the whole video)", () => {
  const e = (kind: Entry["kind"], times: number[], readUntil: number): Entry => ({ kind, readUntil, viewerStopped: false, dim: 1, rows: [], ...part(times, 1) });

  it("asks for previews for a video with nothing saved, and for a partial read with nothing after it", () => {
    expect(needsPreviews(null)).toBe(true);
    expect(needsPreviews(e("partial", [0, 1, 2, 58], 58))).toBe(true);
  });

  it("does not for a partial read with previews after it, a preview read or a full read", () => {
    expect(needsPreviews(e("partial", [0, 1, 58, 60, 70], 58))).toBe(false);
    expect(needsPreviews(e("preview", [0, 2, 4], 0))).toBe(false);
    expect(needsPreviews(e("full", [0, 1, 2], 2))).toBe(false);
  });
});
