# EVAL

How well does typing a sentence find the right second in three hours of video?

## Method

- **Footage:** 7 NASA videos, 2 h 59 min 43 s in total (`scripts/fetch_footage.py`, list in `manifest.json`).
  Apollo 11 archive film, a 52-minute 4K cut of Earth from the space station, the full replay of the last
  Space Shuttle launch, a tour of the station, the Perseverance landing, a Crew Dragon cabin tour and a spacewalk.
- **Queries:** 53 descriptions in `eval/queries.json`, written from contact sheets (one frame every 12 s,
  `scripts/contact_sheets.py`) **before any search was run on this footage**, each with the time ranges where
  the answer really is. 32 describe what is visible (scene), 18 need motion or a moment in time (action),
  3 ask for words on screen (text). Four more ask for things the footage does not contain (negatives).
- **Scoring:** a result is correct when its 8-second window overlaps a labelled range (2 s tolerance).
  hit@1 = correct first result, hit@5 = a correct result in the top five, MRR@10 = mean of 1/rank.
- **Index:** windows of 8 s at 1 frame per second, a new window every 4 s: 2,620 windows for 3 hours.
  Each window becomes one 768-number vector. A query is embedded the same way and compared by cosine
  similarity; adjacent windows of one shot are merged into one result (PREFLIGHT PF06).
- **Hardware:** RTX 3070 (8 GB), i7-8700, bf16. `uv run python scripts/evaluate.py --index <dir> --dims 768 256 128`.

## Results

| Index | tokens per frame | hit@1 | hit@5 | MRR@10 | index time for 3 h | peak GPU |
|---|---|---|---|---|---|---|
| 8 s windows | **70** (default) | **0.74** (39/53) | **0.93** (49/53) | 0.815 | **16.5 min** | 2.48 GiB |
| 8 s windows | 140 | 0.70 (37/53) | 0.89 (47/53) | 0.783 | 25.0 min | 3.61 GiB |

By kind, 70 tokens per frame:

| kind | n | hit@1 | hit@5 |
|---|---|---|---|
| scene | 32 | 0.78 | 0.97 |
| action | 18 | 0.61 | 0.83 |
| text | 3 | 1.00 | 1.00 |

With 53 queries one query is 1.9 points, so the two budgets are within noise of each other. Half the
vision tokens per frame cost nothing measurable on this footage and indexed 1.5x faster.

### Shorter vectors (Matryoshka)

The model is trained so the first N numbers of a vector still work on their own. Same index, cut and renormalized:

| index | 768 numbers | 256 numbers | 128 numbers |
|---|---|---|---|
| 140 tokens, hit@1 / hit@5 | 0.70 / 0.89 | 0.76 / 0.87 | 0.68 / 0.83 |
| 70 tokens, hit@1 / hit@5 | 0.74 / 0.93 | 0.70 / 0.91 | not run |

256 numbers per moment, a third of the storage, stays within noise. At 128 the action queries fall
(hit@5 0.83 to 0.72 on the 140-token index).

### Searches with no answer

Search always returns something. For the four negatives, the best wrong match scores:

| query | best wrong match (70 tokens) |
|---|---|
| the northern lights glowing over the Earth at night | 0.699 |
| city lights seen from orbit at night | 0.721 |
| a dog running on a beach | 0.646 |
| a chef cooking in a restaurant kitchen | 0.626 |

Correct first results score 0.715 to 0.832 (median 0.779). A "nothing found" cutoff near 0.73 would
reject all four negatives and also hide the few correct answers that scored lowest. The page does not
apply a cutoff today; the numbers are here for whoever wants one.

## What it gets wrong

From the default index (70 tokens), 14 of 53 queries do not come first. The instructive ones:

- **Before vs during.** "a space shuttle lifting off from the launch pad" ranks third. First is a close-up
  of the main engines venting steam on the pad: the same place, before the moment. Telling a moment in
  time apart from the scene around it is the hardest kind of query; action hit@1 is 0.61 against 0.78 for scenes.
- **Look-alikes.** "a solar panel against the curve of the Earth" ranks second, behind the camera on the
  shuttle's fuel tank looking back at Earth: a long structure against the planet's edge.
- **Right words, wrong thing.** "a small island in a deep blue ocean" misses the top 10. Its first result is
  the Apollo capsule floating in the Pacific: a small object in deep blue water.
- **A label, probably.** "a gloved hand working on equipment during a spacewalk" misses the top 10, but its
  first result starts 7 s after the labelled range and that frame also shows a glove on equipment. The
  range was likely written too tight. Labels were fixed before the first search, so the miss stands.
