# Moments for YouTube: design

Approved 2026-10-11. A Chrome extension: on any YouTube video, type what you want to see and jump to that
second. The model (EmbeddingGemma 2, the same pinned revision as the website) runs on the viewer's own computer;
nothing about the viewer or the video leaves it. v1 is YouTube only, published on the Chrome Web Store.

## What the viewer sees

1. Nothing happens until a YouTube watch page opens.
2. A slim Moments bar appears right under the player, in YouTube's look (dark or light theme, YouTube's font),
   left to right even when YouTube is in Hebrew.
3. The first time ever, the bar shows the one-time model download with a bar, speed and time left
   ("Setting up: downloading the AI model once, 120 of 402 MB, about 30 s left").
4. Every video is read quickly from YouTube's preview frames in the background, so the bar can answer at once.
5. The first time the viewer searches a video, a full-detail read starts automatically: the extension pauses the
   player, steps it through the video under an overlay that shows the frames being read ("Reading in full
   detail, 2:10 of 10:00"), then returns to the same second and play state. Skip (or Esc) stops it and keeps
   what was read. It happens once per video; the result is saved. (As built: a stopped read is saved as
   partial, up to the second it reached, with preview frames after it; that tab does not read the video again by
   itself, and a later visit's first search continues from that second, never from 0:00.)
6. Search works like Ctrl+F: Enter jumps to the best moment and plays; the bar shows "2 of 6" with arrows;
   Enter and Shift+Enter step through matches; every match is a mark on YouTube's progress bar, the current one
   highlighted. Esc clears.
7. When nothing matches well the bar says "No clear match, closest moments:" instead of pretending.
8. Alt+M focuses the bar from anywhere on the page (changeable in chrome://extensions/shortcuts). As built, in
   fullscreen the bar is not visible and Alt+M still moves the keyboard focus to it; leave fullscreen first.
9. The toolbar icon opens a small popup: background reading on or off, saved space used with "Forget all", and
   the model's status.

Not in v1: other sites, searching what is said, Shorts, live streams (no preview frames).

## Accuracy: why two reading speeds

Measured 2026-10-11 on the 53 pre-registered NASA queries (EVAL.md) and on two 60 s game clips with 16
queries whose answers were written from 2 s contact sheets before any search ran.

| frames the model reads | NASA right first | NASA top 5 |
|---|---|---|
| YouTube previews, simulated: 320x180, JPEG, one every 10 s | 0.60 | 0.79 |
| real frames, one every 4 s (the website) | 0.77 | 0.93 |

- YouTube's preview images: one frame every 2 s for short videos, every 10 s for long ones, 320x180 when the
  video has them (160x90 otherwise), about 2.3 KB a frame. The simulation used 5.9 KB a frame, so real previews
  are likely below 0.60 / 0.79. Previews alone cannot reach the target.
- A hidden second player is not possible: YouTube refuses an embed inside youtube.com (Error 152-4, also when
  visible and full size). Fetching the video stream would break YouTube's terms and the Chrome Web Store policy.
- The viewer's own player works: on a watch page its frames are readable (854x480, no protection), seeks take
  22 to 122 ms, and 16x playback holds. The full-detail read uses it.
- Two cheap levers were tried with settings fixed in advance and dropped: averaging three phrasings of the query
  (no change) and blending each moment's score with its neighbours (slightly worse).
- So the reachable target is "the right moment in the top 5" at about 90 percent after a full read. "Right
  first" stays near 0.77 for this model on any frames.

## Architecture

| part | where it runs | job |
|---|---|---|
| page reader | YouTube's page (main world) | reads video id, length, preview spec and ad state from YouTube's player; follows YouTube's in-page navigation; seeks and pauses the player when asked |
| bar | content script, Shadow DOM | the bar, the overlay during a full read, the progress-bar marks, keys; grabs frames from the player during a full read and sends them to the engine as JPEG |
| router | background service worker | stateless: wakes the engine, passes messages, handles the keyboard command |
| engine | offscreen document plus a worker | loads the model once for the whole browser; fetches and cuts preview sheets; embeds frames and queries; runs searches; saves each video's vectors |
| storyboard | pure functions | preview spec to levels, sheet URLs, frame times and crop boxes; picks the best level |
| store | engine, IndexedDB | per-video vectors (768 numbers in fp16), frame times and source, last-opened time; a 200 MB cap that drops the least recently opened videos first |
| popup | extension page | settings and status |

Flow, preview read: page reader finds the preview spec, the engine downloads the sheets (about 1 MB for an hour),
cuts them, embeds them in batches and streams progress to the bar. Flow, full-detail read: on the first search
the bar pauses the player, seeks it to each frame time from `frameEvery(duration)` (every second up to 2
minutes, every 4 s for long videos, as on the website), draws each frame at 360 px on the short side (the
website's measured setting, `DECODE_SHORT_SIDE`), sends it to the engine as a JPEG at quality 0.9, and finally
restores the player. Full-detail vectors replace the preview vectors of that video. Search: the engine embeds
the query and runs the website's search rule over the video's vectors; the bar seeks and draws the marks.

Shared with the website, imported from `web/src`: the search rule (with the frame-counted hide window, PF21),
`frameEvery`, the model loader, the pinned model files and sizes (`model.json`), and the fetch wrapper that
restores sizes and skips the HTTP cache (PF22, PF24). The model weights come from moments-video.vercel.app with
Hugging Face at the same revision as fallback.

Chrome Web Store rules that shape the build:
- No remote code. transformers.js loads its ONNX runtime from a CDN by default; the extension bundles those
  files and points the runtime at them. Only model weights (data) are downloaded.
- The page CSP allows WebAssembly (`wasm-unsafe-eval`) and nothing else beyond the default.
- Permissions: youtube.com, i.ytimg.com, moments-video.vercel.app, huggingface.co and its CDN hosts, `offscreen`,
  `storage`, `alarms` (the 10-minute unload check; a service worker cannot keep a timer). No access to other sites.

## Targets, written before measuring

Speed:
- First-ever setup: progress shown; under 60 s on a fast line.
- Model ready when Chrome reopens: under 10 s.
- Preview read: a 10-minute video under 10 s, a 1-hour video under 40 s.
- Full-detail read: a 10-minute video under 40 s, a 1-hour video under 3 minutes.
- Search after typing: under 100 ms. A video read before: instant.

Light:
- Does nothing outside YouTube watch pages. The model unloads about 10 minutes (9 to 10, checked every minute)
  after the last YouTube video tab closes.
- Background preview reading stays on by default only if, on Itay's PC, YouTube playback drops less than 1
  percent more frames while it runs and memory use stays reasonable. Otherwise previews are read when the
  viewer first opens the bar.
- Saved data never exceeds 200 MB (about 360 hours of long video).

Accurate:
- Acceptance test on 4 real YouTube videos of different kinds (a launch, a game or sport, cooking, a talk), 5
  searches each, answers written from 2 s contact sheets before searching, run through the built extension.
  After the full-detail read: the right moment in the top 5 for at least 18 of 20, first for at least 14 of 20.
  Preview-only results are measured on the same 20 and reported, not gated.

## When things go wrong

| situation | behaviour |
|---|---|
| no preview frames (brand-new upload, some Shorts) | preview read skipped; the full-detail read still works on search |
| a live stream | nothing is read; the bar says it can be searched once the stream has ended |
| only 160x90 previews | used; the full-detail read upgrades them |
| no WebGPU | runs on the CPU and says so; background reading off |
| model download fails | retries, falls back to Hugging Face, then a Try again button |
| the GPU is lost or stuck (driver reset, PF26) | the model restarts and the batch is sent again; the bar says "restarting"; a second failure shows the reason and Try again, and nothing waits forever |
| the engine cannot be reached, or its line drops | the bar never stays on "Searching": it shows the reason with Try again, or reconnects and sends the lost search again; after an extension update it says to reload the page |
| an ad plays | nothing pauses or seeks the ad; reads and jumps wait until the ad ends ("Reads after the ad", "Jumps after the ad"); a read uses YouTube's length for the video and is refused if the player's length is more than 2 s off |
| the viewer acts during a full read (play, a player key such as a seek, Skip, Esc, a step to another match) | the read stops at once, keeps what it has (saved as partial), and the player is restored |
| the viewer switches videos during a read | the read stops and saves what it read for the old video; nothing from it shows on the new video and the player is not moved |
| several YouTube tabs | one engine, one queue, the most recently opened video first (as built; not the visible tab) |
| YouTube changes its page | the bar falls back to a floating button on the player; if the marks cannot attach, the result list still works |
| YouTube changes the preview format | the spec is validated before use (numbers, URL, level names and signatures); a spec that fails counts as no preview frames, so the bar says there are none and the full-detail read still works on search (as built; no separate "something changed" message) |
| storage refused | vectors kept for the session only |
| messages from the page | treated as untrusted and validated (types, ranges, video id format) |

Open before release: the live website's first visit crashed the page in automated Chrome twice on 2026-10-11
after PF24, without a cache error; WebGPU was available. The engine shares that code path, so the cause is found
and fixed first.

## Testing and release

- Unit tests (Vitest): storyboard parsing with real captured specs (short, long, 160x90 only, missing), frame
  times and crop boxes, the 200 MB cap, message validation, the shared search with the existing Python parity
  test.
- Browser tests: the unpacked extension in Chrome via Playwright, a preview read, a full-detail read and a search
  on a real YouTube video, the player restored afterwards.
- Acceptance: the speed numbers, the playback-stutter measurement, the 20-search test above. Results go in
  EVAL.md; defects in PREFLIGHT.md as for the website.
- Code review and security review before release.
- Layout: `extension/` in the Moments repo, built with the site's Vite toolchain; one command makes the store
  zip. Store listing text, screenshots and a privacy page on moments-video.vercel.app are prepared here;
  Itay opens the Chrome developer account and submits. After approval the website gets an "Add to Chrome"
  button, then the feed video is re-recorded with the extension, then the post.
