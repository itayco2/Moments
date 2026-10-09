# Moments

Type what you want to see and jump to that second in hours of video, in your browser.

Search 3 hours of NASA footage instantly, or drop in your own videos. The search model runs inside the browser tab,
so your videos never leave your computer and the site costs nothing to host.

**Try it: [moments-video.vercel.app](https://moments-video.vercel.app)** (Chrome on a desktop for your own videos;
the NASA examples answer without downloading the model). A search is a link you can share:
[moments-video.vercel.app/?q=astronauts+on+the+Moon](https://moments-video.vercel.app/?q=astronauts+on+the+Moon)
opens on that moment.

| type | lands on |
|---|---|
| a rocket lifting off | the last Space Shuttle climbing off the pad, 45:40 into a 49-minute replay |
| astronauts on the Moon | Apollo 11 at 26:23, an astronaut walking beside the flag |
| a hurricane seen from space | Earth from the space station at 32:28, the eye through a window |
| a red and white parachute | the Perseverance landing at 4:56 |

## What it does well, measured

53 descriptions written before the first search, each with the time ranges where the answer really is
(`eval/queries.json`). Method, every table and every miss: [EVAL.md](EVAL.md).

| | right moment first | in the top 5 |
|---|---|---|
| NASA demo on the website | 74% (39/53) | 93% (49/53) |
| your own videos, indexed by the browser | 76% (40/53) | 91% (48/53) |
| the same footage indexed in Python | 76% (40/53) | 93% (49/53) |

Speed on an RTX 3070: Chrome indexes a 9.5-minute video in 27 seconds (about 20 times faster than watching it), and
a typed search answers in 50 to 190 ms. The first visit downloads the model once (175 MB for searching the demo, 370 MB with
the picture model for your own videos); the browser keeps it for next time.

## What measuring changed

- **Watching 8 seconds did not beat looking at one frame.** A frame every 4 seconds scored 41/53 against 39/53 for
  8-second clips; query by query it is a draw. So the browser embeds one picture every 4 seconds: just as accurate,
  far lighter, and within what WebGPU can handle.
- **Half the detail per frame cost nothing.** 70 vision tokens per frame matched 140 and 280.
- **The browser needed 8-bit pictures.** Built entirely in the browser with 4-bit models, the library scored 37/53;
  with an 8-bit picture model it scores 40/53, equal to Python. Text stays 4-bit, which costs nothing.
- **A result is a moment, not a frame.** One long shot used to fill the list; now each moment grows from its best
  frame and shows once.

## How it works

1. **Frames.** The page plays your video hidden, jumps to every fourth second and copies the frame (`web/src/frames.ts`).
2. **Numbers.** Google's open EmbeddingGemma 2 turns each frame into 768 numbers that describe what is in it, running
   on your GPU through WebGPU in a background worker (`web/src/worker.ts`).
3. **Search.** Your sentence becomes 768 numbers the same way; the frames whose numbers are closest win, and
   neighbouring frames of one shot merge into one moment (`web/src/search.ts`).
4. **Play.** The video plays from that second, with its place in the whole video marked on a timeline.

The NASA demo was built ahead of time by the Python engine in this repo and ships as 2,625 moments in 12.4 MB; its
videos stream straight from NASA's servers.

## Run it

The website, in `web/` (Node 22):

```
cd web
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests, plus golden results that must match Python
npx playwright test demo
```

Built and tested in Google Chrome on Windows, where the model runs on the GPU through WebGPU. A browser without
WebGPU falls back to the CPU, which is much slower and was not measured.

The Python engine, at the root (Python 3.12, [uv](https://docs.astral.sh/uv/), an NVIDIA GPU with 8 GB was used for
every number here): it builds and scores indexes, and exports the demo.

```
uv sync
uv run python scripts/gate.py                                   # loads the model, checks text finds video
uv run python scripts/fetch_footage.py --out D:/moments/footage # 7 NASA videos, 5.95 GiB
uv run python scripts/build_index.py --footage D:/moments/footage --out D:/moments/index/img --window 1 --as-image
uv run python scripts/evaluate.py --index D:/moments/index/img
uv run python scripts/export_web_demo.py --index D:/moments/index/img --footage D:/moments/footage
```

`scripts/serve.py` runs a local search page on top of an index. Stop it before indexing: two copies of the model on
an 8 GB card spill into system memory (PREFLIGHT PF09).

## What it gets wrong

- **Before and during blur together.** "a space shuttle lifting off from the launch pad" ranks the shuttle standing
  on the pad first. Questions about a moment in time are the hardest: 56% first, against 81% for what is visible.
- **Look-alikes win.** "a small island in a deep blue ocean" finds the Apollo capsule floating in the Pacific.
- **It always answers.** A first result under 0.74 is labelled a weak match; that catches 3 of the 4 test searches
  for things the footage does not contain.

## Every defect, with numbers

[PREFLIGHT.md](PREFLIGHT.md) lists the 16 problems found while building this, the number that exposed each one, the
fix, and the number after.

## Credits

Footage: NASA (images.nasa.gov); NASA material is generally not subject to copyright in the United States. NASA
does not endorse this project.
Model: [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) by Google DeepMind, Apache 2.0; the browser
uses the [ONNX build](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX) with transformers.js.
Code: MIT.
