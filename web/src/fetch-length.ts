// Vercel (and Vite's preview server) compress files on the fly and then send no Content-Length. Without it,
// transformers.js grows its buffer one chunk at a time, copying the whole file again each time: a 195 MB model
// file sat at "preparing" for minutes (PREFLIGHT PF22). The pinned revision fixes every file's size, so the
// worker puts the size back.

export interface ModelFile {
  path: string;
  size: number;
}

export function sizeFor(url: string, files: ModelFile[]): number | undefined {
  const path = new URL(url, "http://relative.invalid").pathname; // the worker asks for its own copy by path
  return files.find((f) => path.endsWith(`/${f.path}`))?.size;
}

export function withKnownLength(res: Response, size: number): Response {
  if (res.status !== 200 || res.headers.has("content-length")) return res;
  const headers = new Headers(res.headers);
  headers.set("content-length", String(size));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

// Where Hugging Face URLs of hosted files can be answered from instead: `from` is the start of such a URL
// (up to and including "/resolve/"), `to` is the folder holding the same files (ending in "/").
export interface Mirror {
  from: string;
  to: string;
}

const REVISION_TAIL = /\/resolve\/[^/]+\/(.+)$/; // "/resolve/<revision>/<path>": a branch name or a commit

export function mirrorUrl(url: string, mirror: Mirror): string | null {
  if (!url.startsWith(mirror.from)) return null;
  const path = REVISION_TAIL.exec(new URL(url).pathname)?.[1];
  return path ? mirror.to + path : null;
}

// null when the copy is missing or unreachable: the caller then asks the original address.
async function fromMirror(plain: Fetch, url: string, init: RequestInit): Promise<Response | null> {
  try {
    const res = await plain(url, init);
    return res.ok ? res : null; // 200, and 206 for a Range probe
  } catch {
    return null;
  }
}

// transformers.js keeps its own copy of each model file (the Cache API), so the browser's HTTP cache is skipped
// for them: storing a 200 MB response there failed in a fresh profile (ERR_CACHE_WRITE_FAILURE), stalled the
// download and crashed the tab (PREFLIGHT PF24). Every other request goes through untouched.
// The website's copy answers first, so a network that blocks Hugging Face still loads and Hugging Face sees
// nothing unless the copy fails.
export function modelFetch(plain: Fetch, files: ModelFile[], mirror?: Mirror): Fetch {
  return async (input, init) => {
    const url = String(input);
    const size = sizeFor(url, files);
    if (size === undefined) return plain(input, init);
    const options = { ...init, cache: "no-store" as const };
    const mirrored = mirror && mirrorUrl(url, mirror);
    const res = (mirrored && (await fromMirror(plain, mirrored, options))) || (await plain(input, options));
    return withKnownLength(res, size);
  };
}
