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

export const ABANDONED_MESSAGE = "Moments: a model download was cancelled before it was read";

// An answer whose network download can be stopped while nobody has started reading it, and that then fails when
// someone does read it. A plainly cancelled body would read as empty and finished, and transformers.js would
// keep the zero-filled file in its cache for good with no error.
function abandonable(res: Response): { answer: Response; abandonIfUnread: () => void } {
  const network = res.body?.getReader();
  if (!network) return { answer: res, abandonIfUnread: () => undefined };
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  // highWaterMark 0: nothing is read from the network until the answer itself is read.
  const body = new ReadableStream<Uint8Array>(
    {
      start: (controller) => {
        stream = controller;
      },
      pull: async (controller) => {
        const { done, value } = await network.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => network.cancel(reason),
    },
    { highWaterMark: 0 },
  );
  const answer = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  const abandonIfUnread = () => {
    if (answer.bodyUsed || body.locked) return;
    void network.cancel().catch(() => undefined);
    stream?.error(new Error(ABANDONED_MESSAGE));
  };
  return { answer, abandonIfUnread };
}

// transformers.js keeps its own copy of each model file (the Cache API), so the browser's HTTP cache is skipped
// for them: storing a 200 MB response there failed in a fresh profile (ERR_CACHE_WRITE_FAILURE), stalled the
// download and crashed the tab (PREFLIGHT PF24). Every other request goes through untouched.
// The website's copy answers first, so a network that blocks Hugging Face still loads and Hugging Face sees
// nothing unless the copy fails.
// A safety net for a stall seen live (PREFLIGHT PF25). Given a relative model path, transformers.js checked each
// file's size with a full download whose headers it read and whose body it never closed, so each file was
// downloaded twice. Over HTTP/2 every request shares one connection, and the two unread 200 MB answers stalled
// it: every download stopped at about 130 of 402 MB. The worker now gives it a full address, which makes the
// size check a 1-byte Range request. Should an earlier answer for a file ever still be unread when the file is
// asked for again, it is dropped here: its download stops, and reading it later fails loudly (see abandonable).
export function modelFetch(plain: Fetch, files: ModelFile[], mirror?: Mirror): Fetch {
  const abandonLast = new Map<string, () => void>();
  return async (input, init) => {
    const url = String(input);
    const size = sizeFor(url, files);
    if (size === undefined) return plain(input, init);
    abandonLast.get(url)?.();
    const options = { ...init, cache: "no-store" as const };
    const mirrored = mirror && mirrorUrl(url, mirror);
    const res = (mirrored && (await fromMirror(plain, mirrored, options))) || (await plain(input, options));
    const { answer, abandonIfUnread } = abandonable(withKnownLength(res, size));
    abandonLast.set(url, abandonIfUnread);
    return answer;
  };
}
