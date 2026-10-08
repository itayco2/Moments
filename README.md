# Moments

Type what you want to see and jump to that second in hours of video.

One open embedding model (Google's EmbeddingGemma 2), one home graphics card (RTX 3070, 8 GB), nothing in the cloud.
Three hours of NASA footage become searchable in 16.5 minutes, and a search takes about 150 ms.

| query | lands on |
|---|---|
| a rocket lifting off | Apollo 11 at 14:21, the Saturn V climbing into a blue sky |
| astronauts on the Moon | Apollo 11 at 26:27, an astronaut walking beside the flag |
| a hurricane seen from space | the station's Earth footage at 32:32, the eye through a window |
| a parachute opening over Mars | Perseverance's landing at 4:46 |

## Results

53 descriptions written from contact sheets before the first search, each with the time ranges where the answer
really is (`eval/queries.json`). The method, every table and every miss are in [EVAL.md](EVAL.md).

| | right moment first | in the top 5 |
|---|---|---|
| all 53 queries | 74% (39) | 93% (49) |
| what is visible (32) | 78% | 97% |
| actions and moments in time (18) | 61% | 83% |
| words on screen (3) | 3 of 3 | 3 of 3 |

Three findings from measuring instead of guessing:

- **Half the detail per frame cost nothing.** 70 vision tokens per frame scored within noise of the model's default 140
  and indexed in 16.5 minutes instead of 25.
- **Watching 8 seconds did not beat looking at one frame.** A single frame every 4 seconds scored 41/53 against 39/53;
  query by query it is a draw (8 against 7). Frames win "a shuttle lifting off", windows win "climbing down the ladder".
- **256 numbers per moment work as well as 768.** The model is trained so a cut vector still works; 128 starts to
  lose the action queries.

## How it works

1. Each video is cut into 8-second windows, one frame per second, a new window every 4 seconds.
2. EmbeddingGemma 2 turns each window into 768 numbers that describe what happens in it (`moments/index.py`).
3. A typed sentence becomes 768 numbers the same way. The windows whose numbers are closest win; neighbouring
   windows of one shot merge into one result (`moments/search.py`).
4. A small local page plays the winner from its first second and shows where it sits in the whole video
   (`moments/server.py`, `moments/static/index.html`).

## Run it

Windows or Linux with Python 3.12 and [uv](https://docs.astral.sh/uv/). Every number here comes from an RTX 3070
with 8 GB; a CPU-only run should work but was not measured. ffmpeg is needed for the demo recorder and the gate only.

```
uv sync
uv run python scripts/gate.py                                   # loads the model, checks text finds video
uv run python scripts/fetch_footage.py --out D:/moments/footage # 7 NASA videos, 5.95 GiB
uv run python scripts/build_index.py --footage D:/moments/footage --out D:/moments/index/main
uv run python scripts/serve.py --index D:/moments/index/main --footage D:/moments/footage
```

Then open http://127.0.0.1:8780. Stop the server before indexing again: two copies of the model on an 8 GB card
spill into system memory and indexing slows several times over (PREFLIGHT PF09).

Score an index with `scripts/evaluate.py`, measure throughput settings with `scripts/bench_index.py`, and record the
demo video with `scripts/record_demo.py`. `uv run pytest` runs the fast checks (about a second, no GPU, no download).

## What it gets wrong

- It always answers. "city lights seen from orbit at night" returns something, though the footage has no night side;
  the best wrong matches score 0.63 to 0.72 against 0.72 to 0.83 for correct answers, so a cutoff is possible but costs
  a few true hits.
- Before and during blur together: "a space shuttle lifting off" ranks the engines venting steam on the pad first.
- Look-alikes win: "a small island in a deep blue ocean" finds the Apollo capsule floating in the Pacific.

## Every defect, with numbers

[PREFLIGHT.md](PREFLIGHT.md) lists each problem found while building this, the number that exposed it, the fix and the
number after.

## Credits

Footage: NASA (images.nasa.gov); NASA material is generally not subject to copyright in the United States.
NASA does not endorse this project.
The per-video source pages are in the `manifest.json` the fetcher writes.
Model: [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) by Google DeepMind, Apache 2.0.
Code: MIT.
