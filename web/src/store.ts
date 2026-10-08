// Keeps your own library in IndexedDB so the next visit does not index the same videos again.
// The videos themselves are never stored: only vectors, times and small thumbnails.

const DB_NAME = "moments";
const STORE = "videos";
const VERSION = 1;

export interface SavedVideo {
  key: string;
  display: string;
  duration: number;
  dim: number;
  times: { start: number; end: number }[];
  vectors: Float32Array;
  thumbs: Blob[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) return reject(new Error("this browser cannot save a library"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open the saved library"));
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error("saving the library failed"));
      tx.onabort = () => reject(tx.error ?? new Error("saving the library was cancelled (storage full?)"));
    });
  } finally {
    db.close();
  }
}

export const saveVideo = (video: SavedVideo) => run("readwrite", (s) => s.put(video)).then(() => undefined);
export const loadVideos = () => run<SavedVideo[]>("readonly", (s) => s.getAll());
export const clearVideos = () => run("readwrite", (s) => s.clear()).then(() => undefined);
