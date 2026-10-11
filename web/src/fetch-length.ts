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

// transformers.js keeps its own copy of each model file (the Cache API), so the browser's HTTP cache is skipped
// for them: storing a 200 MB response there failed in a fresh profile (ERR_CACHE_WRITE_FAILURE), stalled the
// download and crashed the tab (PREFLIGHT PF24). Every other request goes through untouched.
export function modelFetch(plain: Fetch, files: ModelFile[]): Fetch {
  return async (input, init) => {
    const size = sizeFor(String(input), files);
    if (size === undefined) return plain(input, init);
    return withKnownLength(await plain(input, { ...init, cache: "no-store" }), size);
  };
}
