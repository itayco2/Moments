# Moments Web: design

Approved 2026-10-08. A free browser tool: search a NASA demo library instantly, then search your own videos.
The model runs in the visitor's browser, so hosting costs nothing and no video is ever uploaded.

## Visitor experience

1. The page opens on a demo library: 3 hours of NASA footage. Example searches answer instantly from vectors
   computed ahead of time; the NASA video streams from NASA's own servers (they answer range requests with
   206 Partial Content, checked 2026-10-08) and plays from the found second.
2. Typed searches need the text half of the model (about 175 MB at 4-bit). It starts downloading in the
   background when the page opens, shows progress, and is cached by the browser afterwards.
3. "Search your own videos": the visitor drops files or picks a folder. The image half of the model downloads
   (about 109 MB at 4-bit). The page grabs one frame every 4 seconds, embeds it, and shows progress. Search
   then runs over their library and plays their own file at the found second. Nothing leaves the machine.
4. The library (vectors and thumbnails) is kept in IndexedDB for the next visit.

## Why one frame every 4 seconds

EVAL.md: single frames every 4 s scored 41/53 first-place hits against 39/53 for 8-second windows, a draw
query by query. Frames are also what a browser can afford: the model card warns that video longer than about
19 seconds can exceed a WebGPU dispatch limit.

## Architecture

- `web/`: Vite and TypeScript, no UI framework, the look of the current page.
- `web/src/worker.ts`: transformers.js (`onnx-community/embeddinggemma-2-ONNX`) in a Web Worker, WebGPU with a
  WASM fallback. Two calls: embed texts, embed images.
- `web/src/frames.ts`: a hidden video element seeks every 4 s and draws each frame to a canvas.
- `web/src/search.ts`: dot products over a Float32Array and the same merge rule as `moments/search.py`,
  unit-tested against outputs exported from Python.
- `web/src/library.ts`: IndexedDB persistence.
- `scripts/export_web_demo.py`: writes the demo library (fp16 vectors, rows, WebP thumbnails, NASA video URLs,
  and precomputed vectors for the example searches) into `web/public/demo/`.

## Measured before shipping

- Browser query parity: the 53 eval queries embedded by transformers.js (q4 and q8) against the Python demo
  index. Accuracy must stay within noise of the Python result; the better dtype ships.
- Browser image parity: frames embedded by transformers.js against the same frames embedded in Python
  (cosine similarity).
- Frames as images vs frames as one-frame videos in Python, since the browser embeds images.
- Indexing speed in the browser on the RTX 3070.

## Cost and deployment

$0. Vercel's free plan serves static files; Hugging Face serves the model; NASA serves its videos; the visitor's
computer does the work. The repo becomes public as `itayco2/Moments` and Vercel deploys `web/` from it. Account
steps are the owner's.

## Testing

Vitest for search math, merging and storage; Playwright with the installed Chrome (H.264 playback) for the demo
flow and for indexing a short clip. CI runs both.

## Not in version 1

Search by sound, Director mode (sentence to trailer), search by picture, phones.
