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

Correct first results score 0.742 to 0.862 (median 0.788). Four negatives are too few to trust a hard "not
found", and a cutoff fitted exactly between 0.741 and 0.742 would only describe these 57 numbers. The page uses a
round 0.74: a first result below it is labelled a weak match, and the results still show. On this set that flags
3 of the 4 negatives ("city lights seen from orbit at night", 0.741, slips through) and none of the 39 correct
first results.

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

## Moments for YouTube (Chrome extension)

Does the built extension find the right second on real YouTube videos, how fast does it read, and does reading in the
background make playback stutter? Measured on 2026-10-11 with `extension/acceptance/acceptance.spec.ts` (raw numbers:
`extension/acceptance/results.json`), in Playwright's Chromium with the unpacked extension, headless, on the RTX 3070
(8 GB) with the model on WebGPU. The 15 searches and their answers were committed (762ea9d, `queries.json` and
`videos.md`) before any search was run; nothing was tuned afterwards. The numbers below are from main at 5ea6c73 (the
final-review merge) built with this commit's `settings.ts`; the test turns background reading on by itself, so the
default does not touch the run. The model is loaded before any timing starts (its own number below).

### The videos

| kind | id | title | length |
|---|---|---|---|
| launch | ANv5UfZsvZQ | "The Falcon has landed" / Recap of Falcon 9 launch and landing (SpaceX) | 3:37 |
| game | 5_RInEohkwA | Super Mario Bros. Wonder hits Nintendo Switch October 20th! (Nintendo UK) | 2:40 |
| cooking | 9biIOtEYeHc | How To Make Slow Roasted Pork Belly (Gordon Ramsay) | 4:15 |

Three videos instead of four, 5 searches each; there is no talk with slides. Each answer is a second range read off a
contact sheet with the previews 2 s apart; a result is right when its start lies within 2 s of a range.

### Accuracy: gate missed

The gate: after the full-detail read, the right moment in the top 5 for at least 14 of 15 searches and first for at least
11 of 15 (the plan's 90 and 70 percent).

| | top 5 | first |
|---|---|---|
| after the full-detail read (the gate) | **12 of 15** (needs 14) | **12 of 15** (needs 11) |
| preview only, same searches | 10 of 10 | 10 of 10 |

Verdict: not met. Both counts are required and the top-5 count is 12, not 14. All 3 misses are the launch video
(2 of 5 in the top 5; game 5 of 5, cooking 5 of 5). Preview only is 10 of 10 on the two videos that had previews; the
launch video had none, so its 5 searches have no preview-only answer ("n/a"). The bar's answers and the engine's answer
to the same search agree on all 15 searches. "-" means the right moment is not among the (up to 6) results.

| video | # | search | answer (s) | preview rank | full rank | results after the read (s, best first) |
|---|---|---|---|---|---|---|
| launch | 1 | an American flag on the white side of a rocket | 4 | n/a | 1 | 4 48 14 30 |
| launch | 2 | a bright orange fireball and smoke as the rocket engines ignite | 56-58 | n/a | 1 | 58 6 38 20 |
| launch | 3 | a satellite floating in space with the curved edge of the Earth below it | 106 or 176-182 | n/a | - | 48 8 38 22 |
| launch | 4 | a rocket coming down with its landing legs spread open above a bright flame | 164-168 | n/a | - | 52 8 38 28 18 |
| launch | 5 | a tall rocket standing upright against a pink and orange sunset sky | 196-200 | n/a | - | 6 52 38 26 |
| game | 1 | a glowing blue flower with a face floating in the sky | 46-50 | 1 | 1 | 46 6 28 128 80 154 |
| game | 2 | an overhead view of a green hilly landscape with winding paths | 88 | 1 | 1 | 88 98 66 8 20 130 |
| game | 3 | a princess in an orange dress and a yellow turtle character beside a teal pipe | 96 | 1 | 1 | 96 124 134 38 6 58 |
| game | 4 | Mario at the top of a tall flagpole at the end of the level | 126-132 | 1 | 1 | 128 44 144 8 34 76 |
| game | 5 | an elephant version of Mario standing in front of green hills | 150 | 1 | 1 | 150 44 16 128 30 74 |
| cooking | 1 | a knife chopping a pale green fennel bulb on a board | 46-52 | 1 | 1 | 48 80 64 128 140 244 |
| cooking | 2 | green cardamom pods on a dark surface crushed with the flat of a knife | 78-80 | 1 | 1 | 80 48 214 240 64 134 |
| cooking | 3 | the inside of an oven with a glowing orange light | 150-152 | 1 | 1 | 152 168 202 132 0 102 |
| cooking | 4 | a modern house with a big green lawn in front | 154-156 | 1 | 1 | 154 92 0 234 210 184 |
| cooking | 5 | a slice of white bread soaked in brown gravy in a roasting tray | 186-194 | 1 | 1 | 188 132 226 164 0 144 |

What the misses are: the launch video has no preview read (defect 1) and its full-detail read stopped at 58 s (defect
2), so everything after 58 s is unreadable for it: the searches whose answers are at 106 or 176, 164 and 196 s have
nothing to find. The game and cooking videos also stopped at 58 and 57 s, but they keep their previews after that point
(the reads end as "partial" and the previews after the read point stay), which is why they score 10 of 10. The
full-detail read changed no rank on them: the answers are first with or without it. With only 15 searches this says the
previews are strong on these two videos, not that the full read helps.

### Defects found (for PREFLIGHT.md)

1. **A 159-pixel preview level is refused.** The launch video's largest preview is 159x90 (levels 48x27, 79x45, 159x90);
   `MIN_WIDTH = 160` in `extension/src/storyboard.ts` refuses it and the bar says "No preview frames for this
   video". The spec says 160x90 is used; 159 is the same picture. The other two videos have 160x90 and 320x180. The
   first search then starts the full read directly, with no previews to fall back on.
2. **The full-detail read cannot go past about the first minute on these three videos.** All three reads ended
   "partial" (not stopped by the viewer) at 58, 58 and 57 s. Each page logged "Moments: the player does not hold this
   video's length NaN 217" (160, 255) and "4 or 5 frames had no picture and were skipped": after about 60 s of buffer the
   player drops its source (readyState 0, duration NaN) on a seek and does not come back. Reproduced without the
   extension, in plain headless Chromium, on the launch video: seeks to 0 through 58 s landed in 9 to 511 ms, seeks to
   60 s and later never landed in 5 s, whether set with `video.currentTime` or the player's `seekTo`, paused or
   playing. The fourth video I tried the same way (dQw4w9WgXcQ) seeks across its whole length (to 200 s, 25 to 316 ms,
   one 2.5 s at the buffer edge). All four use the same streaming type (`serverAbrStreamingUrl`); I found no
   difference. Not tried in headed Chrome or a signed-in profile, so it is unknown how common this is for viewers.
3. **On the first build I ran (762ea9d, before the final-review merge) a read that stalled was recorded as complete.**
   Seeks that did not land were skipped after 5 s each and the read was saved as "full", replacing the previews:
   top 5 was 4 of 15 and first 4 of 15 (preview only: 10 of 10 on the same two videos), and the three reads took 398,
   254 and 333 s (110, 95 and 78 s per minute of video). About 79, 50 and 65 skipped seeks of 5 s account for 395, 250
   and 325 s of that (my arithmetic from the frame counts, not logged). The merged build (partial reads that keep the
   previews after the read point) fixed it; that is why the table above is from the later build.
4. **The GPU can hang under the background preview read** (see the stutter section): "the GPU was reset ...
   DXGI_ERROR_DEVICE_HUNG", model restarting, in both traced control runs on the later build (a third showed the same signature).

### Speed

Gate: a full-detail read under 4 s per minute of video (a 10-minute video under 40 s).

| video | length | preview read | full read | read ended as | full read per minute of video |
|---|---|---|---|---|---|
| launch | 217 s | no preview read | 27.6 s | partial, up to 58 s | 7.6 s |
| game | 160 s | 10.1 s | 32.2 s | partial, up to 58 s | 12.1 s |
| cooking | 255 s | 14.4 s | 31.7 s | partial, up to 57 s | 7.5 s |

- **Full read: not met, and not a fair measure.** All three are above 4 s per minute of video, and none of the three
  reads got to the end of its video (defect 2), so there is no full-read speed for a whole video on these three. On the
  first build the reads took 78 to 110 s per minute, nearly all of it 5 s timeouts.
- **Preview read** (page load to "quick results ready", a 160 s and a 255 s video, previews 2 s apart): 10.1 s and 14.4 s. The plan's target is a 10-minute video under 10 s; no 10-minute video was run.
- **First-ever setup** (empty cache, model from the website's copy, WebGPU): 26.2 s (25.5 s and 29.3 s in two earlier runs). Target: under 60 s.
- Search after typing and reopening a read video: not measured here.

### Playback stutter and the default

One tab plays a YouTube video (after its ad); dropped frames are counted over 30 s, in 5 s slices. With background reading
on, a second tab opens another video and the engine reads it in the background (previews, 267 moments).

| window (main run) | dropped-frame share | per 5 s slice |
|---|---|---|
| the tab alone (background reading off) | 0.0 % | 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 |
| while the second tab is read | 2.2 % | 2.4, 3.1, 2.4, 3.8, 1.6, 0.0 |
| the tab alone again | 0.0 % | 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 |

The share rose by **2.2 points** (the same window in two earlier runs: 2.5 points on 762ea9d, 1.9 points
on the first run of 5ea6c73). The limit is 1 point, so **background reading is off by default**
(`DEFAULT_BACKGROUND_READING = false`); the popup switch turns it on, and without it the first search reads the video as
before. The spec's Light bullet says so.

A control separates "a second tab is playing" from "a second tab is being read", with the same tab playing:

| window (last control run) | dropped-frame share | per 5 s slice |
|---|---|---|
| alone | 0.0 % | 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 |
| second tab playing, not read | 0.0 % | 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 |
| alone again | 0.3 % | 1.6, 0.0, 0.0, 0.0, 0.0, 0.0 |
| second tab being read | 9.0 % | 0.0, 40.7, 0.0, 0.0, 0.0, 0.0 |

A second playing tab alone costs nothing (0.0 % in all 3 control runs on the later build and in the one on the first).
Reading it did: 1.9 % on the first build, then 16.2 %, 5.4 % and 9.0 % on the later one, because in those
runs the reader's GPU hung (the read tab's bar said "The AI model stopped (the GPU was reset:
ID3D12Device::GetDeviceRemovedReason failed with DXGI_ERROR_DEVICE_HUNG ...) and is restarting"; the first of the three
had no trace taken, but the same signature: one slice at 70 % dropped and the read never finishing). The engine
restarts the model (PF26); the viewer sees a stall of seconds on the playing video. It happened in the control, where
the model was loaded but had not yet run any pictures, and not in the main-run windows, where it had; the cold case is
the one a new user meets first.

GPU load: `nvidia-smi` before the quiet window showed 36 % and 4675 MiB; the card also draws the desktop (22 to 50 %
and 1.0 to 1.8 GB sampled every 3 s with no test running). The processes it listed were desktop apps (explorer, the
user's Chrome, Docker Desktop, the NVIDIA overlay) and the test's own Chromium; no other GPU-heavy process was running.
During the read window it showed 100 %. Memory use was not measured.

### Runs

Two passes on 762ea9d (the first stopped after 10 minutes at the launch video: no previews, defect 1; the test then
learned to record "no previews" and go on), two on 5ea6c73 with identical ranks and result lists (the numbers above are
the second), and four stutter controls. The first attempt on 5ea6c73 failed at once because the engine then ignored
`stats` sent from a tab (fixed in 5aff594); the test now sends it from the service worker, which both versions
accept. Main moved to 19cec5a while this ran (the popup is accepted in a tab; the bar is placed under the player once
YouTube draws it); neither touches reading or search. No run hit a model-load stall or "Error: 9950264".

### Second run, 2026-10-11 (main 4d8942a)

Same test, same 15 pre-registered searches (`queries.json` unchanged), same profile with the model cached. Raw
numbers: `extension/acceptance/results.json` (the first run's are in that file at 356a3b1). What changed since the first
run:

- The 159x90 preview level is used (PF31), so the launch video now has a preview read (109 frames).
- A player that fails during a full read is detected: no length, YouTube's error, or two seeks in a row that never
  land. The read then ends as partial, the video is loaded again at the viewer's second, and previews are asked for
  to cover the rest (PF32).
- The test browser starts without `--enable-automation` and with `--disable-blink-features=AutomationControlled`
  (`navigator.webdriver` is false).
- The first attempt stopped at the first preview read with a GPU driver reset (DXGI_ERROR_DEVICE_HUNG) while another
  agent's screen recording used the GPU (PF33). It was run again once, as agreed beforehand. That attempt's model
  setup took 34.6 s because the profile's whole `Service Worker` folder, model cache included, had been deleted
  before it (PF34). The rerun's took 2.9 s.

| | top 5 | first |
|---|---|---|
| after the full-detail read (the gate: 14 and 11) | **15 of 15** | **13 of 15** |
| preview only, same searches | 15 of 15 | 13 of 15 |

Verdict: **gate met.** By video: launch 5 of 5 in the top 5 and 3 of 5 first, game 5 and 5, cooking 5 and 5. The launch
video's two non-first answers:
- "a bright orange fireball and smoke as the rocket engines ignite" (56 to 58 s): 58 is second, after 84.
- "a rocket coming down with its landing legs spread open above a bright flame" (164 to 168 s): 164 is fourth.

The three answers after 58 s that the first run could not find (106 or 176 to 182 s, 164 to 168 s, 196 to 200 s) now
rank 1, 4 and 1, from the previews kept after the read point. The bar's answers equal the engine's on all 15. As in the
first run, the full-detail read changed no first place: ranks after it equal the preview-only ranks except the landing
search (5 to 4).

**Full reads still stop at 58, 58 and 57 s.** The new check now ends them ("the player stopped working during the
full-detail read; loading the video again", once per video) and the player is loaded again. The reads took 12.2, 11.9
and 12.4 s, about 10 s of that the two 5 s seek deadlines; the first 58 s were read in about 2 s. A probe in the same
headless test browser was run with the two flags, `navigator.webdriver` false and without the extension, on the launch
video. Seeks from 0 to 58 s landed. Seeks to 60, 62 and 64 s never landed in 5 s: readyState 1, the length kept, no
error shown.

So the 58 s stop is the test browser being refused by YouTube, not the extension (the first run's probe without the
extension showed the same). The two flags are not enough here. The other agent saw a video seek past 1:00 with them,
so the remaining difference is likely headless mode (its user agent says HeadlessChrome); not tested yet. There is still
no full-read time for a whole video. Reading the first 58 s took about 2 s, roughly 2 s per minute of video, against the
gate of 4.

| video | length | preview read | full read ended | full read time |
|---|---|---|---|---|
| launch | 217 s | 12.6 s | partial at 58 s, player failure | 12.2 s |
| game | 160 s | 9.8 s | partial at 58 s, player failure | 11.9 s |
| cooking | 255 s | 14.9 s | partial at 57 s, player failure | 12.4 s |

**Stutter while a second tab is read:** 3.2 %. The slices were 10.1, 10.2, 0, 0, 0 and 0 %; quiet before and after was
0.0 %. That tab's read ended in another GPU driver reset ("The AI model stopped (the GPU was reset ... DXGI_ERROR_DEVICE_HUNG)
and is restarting") while the other agent's recording shared the GPU. Background reading stays off by default.

**Not measured in this run:** the scores behind "No clear match". The test now records each search's scores
(`previewScores`, `engineScores`) for the next run, which sets the extension's own line.
