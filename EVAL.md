# EVAL

How well does typing a sentence find the right second in three hours of video, on a home GPU and in a
browser tab?

## Method

- **Footage:** 7 NASA videos, 2 h 59 min 43 s in total (`scripts/fetch_footage.py`, list in `manifest.json`):
  Apollo 11 archive film, a 52-minute 4K cut of Earth from the space station, the full replay of the last Space
  Shuttle launch, a tour of the station, the Perseverance landing, a Crew Dragon cabin tour and a spacewalk.
- **Queries:** 53 descriptions in `eval/queries.json`, written from contact sheets (one frame every 12 s,
  `scripts/contact_sheets.py`) **before any search was run on this footage**, each with the time ranges where the
  answer really is. 32 describe what is visible (scene), 18 need motion or a moment in time (action), 3 ask for
  words on screen (text). Four more ask for things the footage does not contain (negatives).
- **Scoring:** a result is correct when its centre lies within 6 s of a labelled range. For 8-second windows that
  is the same as "the window overlaps the range with 2 s to spare"; stated by centre, it scores single frames by the
  same standard. hit@1 = correct first result, hit@5 = a correct result in the top five, MRR@10 = mean of 1/rank.
- **Results are moments, not frames:** a moment grows from its best frame through neighbours that score almost as
  well, and the seconds around it are hidden from later results, so one shot is listed once (PREFLIGHT PF06, PF10,
  PF11). Every number below uses this final rule.
- **Hardware:** RTX 3070 (8 GB), i7-8700. Python runs bf16 on CUDA; the browser stack is transformers.js 4.3.1 on
  WebGPU (in Chrome, and in Node on the same ONNX Runtime WebGPU path for the full-library runs).

## Results

### What ships

| | how the library is built | how queries are embedded | hit@1 | hit@5 | MRR@10 |
|---|---|---|---|---|---|
| **NASA demo on the website** | Python, frames as pictures, 70 tokens | browser, 4-bit text | **0.74** (39/53) | **0.93** | 0.819 |
| **Your videos on the website** | browser, 8-bit pictures, 70 tokens | browser, 4-bit text | **0.76** (40/53) | **0.91** | 0.827 |
| Python reference | Python, frames as pictures, 70 tokens | Python bf16 | 0.76 (40/53) | 0.93 | 0.828 |

With 53 queries one query is 1.9 points; the three rows are within noise of each other. The browser loses nothing
measurable against Python once its picture model runs at 8 bits (below).

### Every index built

| library | tokens per frame | hit@1 | hit@5 | action hit@1 | time to index 3 h |
|---|---|---|---|---|---|
| 8 s video windows every 4 s | 140 | 0.70 | 0.93 | 0.56 | 25.0 min |
| 8 s video windows every 4 s | 70 | 0.74 | 0.93 | 0.61 | 16.5 min |
| one frame every 4 s, as a 1-frame video | 140 | 0.77 | 0.93 | 0.67 | 12.4 min |
| one frame every 4 s, as a picture | 280 | 0.79 | 0.93 | 0.67 | 13.4 min |
| one frame every 4 s, as a picture | 70 | 0.76 | 0.93 | 0.56 | 11.5 min |

Python indexing times include decoding the video on the CPU, which is most of it for single frames.

**Half the detail per frame costs nothing measurable.** 70 tokens scored within noise of 140 (windows) and of 280
(pictures) and indexed faster, so 70 is the default everywhere.

**Watching 8 seconds did not beat looking at one frame.** The expectation was that windows would win on actions.
Query by query it is a draw (windows ahead on 7, frames ahead on 8). Frames win "a space shuttle lifting off from
the launch pad": one frame of a shuttle trailing fire is unambiguous, while an 8 s window that spans liftoff blends
the pad with the sky. Windows win "an astronaut climbing down the lander's ladder" and "the President greeting the
astronauts through a quarantine trailer window", which unfold over seconds. On these 53 queries the motion did not
pay for itself; a query set built around actions might say otherwise. This result is why the browser tool embeds
one picture every 4 seconds: it is as accurate and far lighter, and WebGPU struggles with long video inputs.

### In the browser

The website runs `onnx-community/embeddinggemma-2-ONNX` with transformers.js. Quantization was chosen by
rebuilding the whole 2,625-frame library in the browser stack (`web/scripts/embed-frames.mjs`) and scoring it:

| browser pictures | browser text | hit@1 | hit@5 | action hit@1 | download for your videos |
|---|---|---|---|---|---|
| 4-bit | 4-bit | 0.70 (37/53) | 0.89 | 0.44 | 284 MB |
| **8-bit** | **4-bit** | **0.76 (40/53)** | **0.91** | **0.56** | **370 MB** |
| 8-bit | 8-bit | 0.77 (41/53) | 0.91 | 0.56 | 509 MB |

On 119 identical frames, 4-bit picture vectors average 0.974 cosine similarity to Python's (worst 0.895) and agree
on each frame's most similar other frame 71% of the time; 8-bit averages 0.991 (worst 0.925) and agrees 85% of the
time. Text at 4 bits matches Python, so a visitor who only searches the demo downloads 175 MB.

Speed, RTX 3070:

| | rate |
|---|---|
| browser stack embedding pictures on WebGPU | 11.1 frames/s (2,625 frames in 237 s) |
| whole your-videos path in Chrome: seek, grab, embed, save | 5.3 frames/s (a 9.5-minute video in 27 s) |
| search in the browser | 50 to 190 ms for a typed query, under 10 ms for an example |
| Python search | about 150 ms |

### Shorter vectors (Matryoshka)

The model is trained so the first N numbers of a vector still work. On the shipped demo setup:

| numbers per moment | hit@1 | hit@5 | action hit@1 |
|---|---|---|---|
| 768 | 0.74 | 0.93 | 0.56 |
| 256 | 0.70 | 0.91 | 0.44 |
| 128 | 0.64 | 0.83 | 0.39 |

On the picture index, cutting costs accuracy, actions first, so the demo ships all 768 (4 MB as fp16). (On the
140-token window index 256 numbers had stayed within noise; the picture index is less forgiving.)

### Searches with no answer

Search always returns something. On the shipped demo setup, the four negatives' best wrong matches score:

| query | best wrong match |
|---|---|
| the northern lights glowing over the Earth at night | 0.715 |
| city lights seen from orbit at night | 0.741 |
| a dog running on a beach | 0.683 |
| a chef cooking in a restaurant kitchen | 0.639 |

Correct first results score 0.742 to 0.862 (median 0.788). On this set a cutoff near 0.74 separates the two, but
four negatives are too few to trust a hard "not found". The page therefore labels a first result under 0.74 as a
weak match instead of hiding it.

## What it gets wrong

On the shipped demo setup, 14 of 53 queries do not come first. The instructive ones:

- **Before vs during.** "a space shuttle lifting off from the launch pad" ranks second, behind the shuttle standing on
  the pad before launch: the right place, the wrong moment. Action hit@1 is 0.56 against 0.81 for scenes.
- **Look-alikes.** "a solar panel against the curve of the Earth" ranks third, behind the camera on the shuttle's
  fuel tank looking back at Earth: a long structure against the planet's edge. "astronauts eating breakfast at a
  table" first finds astronauts sharing a meal on the space station, which is a fair answer the labels did not list.
- **Right words, wrong thing.** "a small island in a deep blue ocean" misses the top 10; its first result is the
  Apollo capsule floating in the Pacific, a small object in deep blue water. "a gloved hand working on equipment
  during a spacewalk" finds gloved hands too, strapping an astronaut into the shuttle's seat.
- **Words on screen win.** "a parachute opening over Mars" first found NASA's title card, whose text describes the
  parachute, before the parachute itself; the picture model reads text in frames (all 3 text queries come first).
  The demo's example became "a red and white parachute", which finds the parachute at 4:56.
