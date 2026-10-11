// Saved per-video vectors in the engine's IndexedDB. Metadata lives apart from vectors so eviction never loads
// 200 MB of vectors just to read sizes and dates.
import { CAP_BYTES, entryBytes, evict, type StoredMeta } from "../store-policy";

export interface SavedVideo {
  videoId: string;
  kind: "preview" | "full";
  dim: number;
  times: Float32Array;
  vectors: Uint16Array;
}

const DB_NAME = "moments";
const VERSION = 1;
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("meta", { keyPath: "videoId" });
      req.result.createObjectStore("vectors", { keyPath: "videoId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // A failed request aborts the transaction, and only the abort carries the real error (onerror fires before
    // tx.error is set, which would reject with null).
    tx.onabort = () => reject(tx.error ?? new Error("the saved-videos transaction was aborted"));
  });

export async function loadVideo(videoId: string): Promise<SavedVideo | undefined> {
  const tx = (await db()).transaction(["meta", "vectors"], "readwrite");
  const saved = (await result(tx.objectStore("vectors").get(videoId))) as SavedVideo | undefined;
  const meta = (await result(tx.objectStore("meta").get(videoId))) as StoredMeta | undefined;
  if (meta) tx.objectStore("meta").put({ ...meta, lastOpened: Date.now() });
  await finished(tx);
  return saved;
}

// Marks a video as opened now, without loading its vectors: the storage cap evicts the longest unopened video first.
export async function touchVideo(videoId: string): Promise<void> {
  const tx = (await db()).transaction("meta", "readwrite");
  const meta = (await result(tx.objectStore("meta").get(videoId))) as StoredMeta | undefined;
  if (meta) tx.objectStore("meta").put({ ...meta, lastOpened: Date.now() });
  await finished(tx);
}

export async function saveVideo(v: SavedVideo): Promise<void> {
  const tx = (await db()).transaction(["meta", "vectors"], "readwrite");
  tx.objectStore("vectors").put(v);
  tx.objectStore("meta").put({ videoId: v.videoId, bytes: entryBytes(v.times.length, v.dim), lastOpened: Date.now() });
  const all = (await result(tx.objectStore("meta").getAll())) as StoredMeta[];
  for (const id of evict(all, CAP_BYTES)) {
    tx.objectStore("meta").delete(id);
    tx.objectStore("vectors").delete(id);
  }
  await finished(tx);
}

export async function usage(): Promise<{ videos: number; bytes: number }> {
  const tx = (await db()).transaction("meta", "readonly");
  const all = (await result(tx.objectStore("meta").getAll())) as StoredMeta[];
  return { videos: all.length, bytes: all.reduce((sum, m) => sum + m.bytes, 0) };
}

export async function forgetAll(): Promise<void> {
  const tx = (await db()).transaction(["meta", "vectors"], "readwrite");
  tx.objectStore("meta").clear();
  tx.objectStore("vectors").clear();
  await finished(tx);
}
