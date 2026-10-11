// Runs the pre-registered searches through the built extension: preview-only answers at engine level, then the
// full-detail answers through the bar as a viewer would. Also times every stage and measures playback stutter.
// The test records and prints; it passes or fails on nothing but a crash. The gates are applied by hand (EVAL.md).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { type BrowserContext, expect, test, type Page } from "@playwright/test";
import { launchExtension } from "../e2e/helpers";

interface Plan {
  tolerance_s: number;
  videos: { id: string; kind: string; queries: { q: string; answer: [number, number][] }[] }[];
}
interface QueryRow {
  video: string;
  kind: string;
  q: string;
  answer: [number, number][];
  previewAvailable: boolean;
  previewRank: number | null; // null: not in the list, or the video had no preview read
  fullRank: number | null;
  previewHits: number[];
  previewScores: number[];
  fullHits: number[];
  kindAtRead: string | null;
  engineKind: string; // what the engine holds for the video when the same search is asked of it directly
  engineReadUntil: number; // for a partial read: the second it reached
  engineViewerStopped: boolean; // the engine's record that the viewer stopped the read
  engineHits: number[];
  engineScores: number[];
  barMatchesEngine: boolean;
}
interface VideoRow {
  video: string;
  kind: string;
  durationS: number;
  previewAvailable: boolean;
  previewSeconds: number | null;
  kindAfterRead: string; // "full", or "partial" when the read stopped before the end or lost frames
  pageWarnings: string[]; // what the content script logged ("Moments: ...") on this video's page
  fullSeconds: number;
  fullSecondsPerMinute: number;
}
interface Counts {
  dropped: number;
  total: number;
  ad: boolean;
}

const plan = JSON.parse(readFileSync(new URL("./queries.json", import.meta.url), "utf8")) as Plan;
const near = (t: number, answer: [number, number][]) => answer.some(([a, b]) => t >= a - plan.tolerance_s && t <= b + plan.tolerance_s);
const rankOf = (starts: number[], answer: [number, number][]) => starts.findIndex((t) => near(t, answer)) + 1 || null;

const WATCH_VIDEO = "dQw4w9WgXcQ";
const READ_VIDEO = "-idr3GEYf1Q";
const WINDOW_S = 30;
const SLICE_S = 5;

// The engine answers "stats" and "forget-all" only to an extension page that is not a tab (the popup), so they are sent
// from the service worker. A page of ours wakes the worker, and the engine, first.
async function engineMessage<T>(context: BrowserContext, control: Page, message: object): Promise<T> {
  await control.evaluate(() => chrome.runtime.sendMessage({ type: "engine:ensure" }));
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return (await worker.evaluate((m) => chrome.runtime.sendMessage(m), message)) as T;
}
type ModelStats = { phase: string; device: string | null; message: string };

// What the bar shows once nothing is running: not searching, not reading, not waiting for an ad.
const SETTLED = /^(?!Searching|Reading|Reads after|Jumps after)/;

// Waits until the bar has shown the same settled status and hits for a couple of seconds. A search can be followed by a
// read that continues an earlier partial one, and the read's own search after it: the answer counts only when all that is over.
const CALM_POLLS = 4;
const POLL_MS = 500;
async function settle(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  let last = "";
  while (calm < CALM_POLLS) {
    if (Date.now() > deadline) throw new Error("the bar never settled");
    const now = await page.evaluate(() => {
      const bar = document.querySelector("moments-bar");
      return { status: bar?.getAttribute("data-status") ?? "", hits: bar?.getAttribute("data-hits") ?? "" };
    });
    const key = `${now.status}|${now.hits}`;
    calm = SETTLED.test(now.status) && key === last ? calm + 1 : 0;
    last = key;
    await page.waitForTimeout(POLL_MS);
  }
}

// The engine's own answer to searches, asked over a port like a tab would (it starts no read).
function engineSearch(control: Page, videoId: string, queries: string[], idBase: number): Promise<{ starts: number[]; scores: number[]; kind: string; readUntil: number; viewerStopped: boolean }[]> {
  return control.evaluate(
    async ({ videoId: id, queries: qs, idBase: base }) => {
      const port = chrome.runtime.connect({ name: "moments" });
      const out: { starts: number[]; scores: number[]; kind: string; readUntil: number; viewerStopped: boolean }[] = [];
      for (const [i, query] of qs.entries()) {
        out.push(
          await new Promise((resolve) => {
            port.onMessage.addListener(function on(m) {
              if (m.type === "results" && m.id === base + i) {
                port.onMessage.removeListener(on);
                resolve({ starts: m.hits.map((h: { start: number }) => h.start), scores: m.hits.map((h: { score: number }) => h.score), kind: m.kind, readUntil: m.readUntil, viewerStopped: m.viewerStopped });
              }
            });
            port.postMessage({ type: "search", id: base + i, videoId: id, query });
          }),
        );
      }
      port.disconnect();
      return out;
    },
    { videoId, queries, idBase },
  );
}

const frames = (page: Page): Promise<Counts> =>
  page.evaluate(() => {
    const q = document.querySelector("video")!.getVideoPlaybackQuality();
    return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames, ad: document.getElementById("movie_player")?.classList.contains("ad-showing") ?? false };
  });
const share = (a: Counts, b: Counts) => (b.dropped - a.dropped) / Math.max(1, b.total - a.total);

// Dropped-frame share over a window, in short slices so a read that ends early shows up in the numbers.
async function droppedShare(page: Page, seconds: number, between?: (slice: number) => Promise<void> | void): Promise<{ share: number; slices: number[]; sliceEndedInAd: boolean[] }> {
  const start = await frames(page);
  let last = start;
  const slices: number[] = [];
  const sliceEndedInAd: boolean[] = [];
  for (let s = 0; s < seconds / SLICE_S; s++) {
    await page.waitForTimeout(SLICE_S * 1000);
    const now = await frames(page);
    slices.push(share(last, now));
    sliceEndedInAd.push(now.ad);
    last = now;
    await between?.(s);
  }
  return { share: share(start, last), slices, sliceEndedInAd };
}

// Other GPU users would blur the stutter numbers: note what the card is doing when they are taken.
function gpuSnapshot(): string {
  try {
    const run = (query: string) => execFileSync("nvidia-smi", [query, "--format=csv,noheader"], { encoding: "utf8", timeout: 20_000 }).trim();
    return `gpu util,mem: ${run("--query-gpu=utilization.gpu,memory.used")}; compute apps: ${run("--query-compute-apps=pid,process_name,used_memory") || "none listed"}`;
  } catch (err) {
    return `nvidia-smi failed: ${String(err)}`;
  }
}

test("acceptance", async () => {
  const { context, extensionId } = await launchExtension();
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  const forgotten = await engineMessage<{ ok?: boolean; message?: string }>(context, control, { type: "forget-all" });
  expect(forgotten?.ok, `forget-all was not accepted: ${JSON.stringify(forgotten)}`).toBe(true);
  // The preview reads below need background reading on, whatever the shipped default is.
  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: true }));
  // The model is loaded before any timing starts, so no video's read time includes the one-off download (the profile's
  // model cache was emptied for this run). The setup time is its own number.
  const setupStart = Date.now();
  const model = await engineMessage<ModelStats>(context, control, { type: "stats", load: true });
  const modelSetupSeconds = (Date.now() - setupStart) / 1000;
  console.log(JSON.stringify({ model, modelSetupSeconds }));
  expect(model.phase, `the model did not load: ${model.message}`).toBe("ready");
  const queries: QueryRow[] = [];
  const videos: VideoRow[] = [];
  const save = (extra: Record<string, unknown> = {}) => writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ ...extra, model: { ...model, setupSeconds: modelSetupSeconds }, videos, queries }, null, 1));

  for (const video of plan.videos) {
    const page = await context.newPage();
    const pageWarnings: string[] = [];
    page.on("console", (m) => {
      if (m.text().startsWith("Moments:") && pageWarnings.length < 20) pageWarnings.push(m.text().slice(0, 240));
    });
    const t0 = Date.now();
    await page.goto(`https://www.youtube.com/watch?v=${video.id}`);
    const host = page.locator("moments-bar");
    // The bar ends up with a preview read, or says there are no preview frames (then the first search reads in full detail).
    const outcome = await page.waitForFunction(
      () => {
        const b = document.querySelector("moments-bar") as HTMLElement | null;
        const status = b?.dataset.status ?? "";
        if (b?.dataset.kind === "preview") return "preview";
        if (status.startsWith("No preview frames")) return "no-previews";
        return status.startsWith("Something went wrong") || status.startsWith("The AI model") ? status : null;
      },
      null,
      { timeout: 600_000, polling: 250 },
    );
    const barSaid = String(await outcome.jsonValue());
    if (barSaid !== "preview" && barSaid !== "no-previews") throw new Error(`the bar stopped: ${barSaid}`);
    const previewAvailable = barSaid === "preview";
    const previewSeconds = previewAvailable ? (Date.now() - t0) / 1000 : null;

    // Preview-only answers, straight from the engine (no full read is triggered this way).
    const qs = video.queries.map((q) => q.q);
    const previewAnswers = previewAvailable ? await engineSearch(control, video.id, qs, 1000) : null;
    const preview = previewAnswers ? previewAnswers.map((r) => r.starts) : qs.map(() => [] as number[]);
    const previewScores = previewAnswers ? previewAnswers.map((r) => r.scores) : qs.map(() => [] as number[]);

    await page.waitForFunction(() => !document.getElementById("movie_player")?.classList.contains("ad-showing"), null, { timeout: 300_000 });
    const t1 = Date.now();
    const input = host.locator("input");
    await input.fill(video.queries[0].q);
    await input.press("Enter");
    // The read ends as "full", or as "partial" when it stopped early or lost frames; anything else is a failure.
    const ended = await page.waitForFunction(
      () => {
        const b = document.querySelector("moments-bar") as HTMLElement | null;
        const status = b?.dataset.status ?? "";
        if (b?.dataset.kind === "full" || b?.dataset.kind === "partial") return b.dataset.kind;
        return status.startsWith("Something went wrong") || status.startsWith("The AI model") ? status : null;
      },
      null,
      { timeout: 1_800_000, polling: 250 },
    );
    const kindAfterRead = String(await ended.jsonValue());
    if (kindAfterRead !== "full" && kindAfterRead !== "partial") throw new Error(`the bar stopped: ${kindAfterRead}`);
    const fullSeconds = (Date.now() - t1) / 1000;
    // The length YouTube reports for the video (the player's own duration is an ad's while an ad plays).
    const durationS = await page.evaluate(() => {
      const w = window as unknown as { ytInitialPlayerResponse?: { videoDetails?: { lengthSeconds?: string } } };
      return Number(w.ytInitialPlayerResponse?.videoDetails?.lengthSeconds) || document.querySelector("video")!.duration;
    });
    // The bar searches the first query again by itself once the read is saved: wait for that search to start (it may
    // already have answered) and for the bar to settle, so the first query is read from the full-detail answer.
    await page.waitForFunction(() => document.querySelector("moments-bar")?.getAttribute("data-status")?.startsWith("Searching"), null, { timeout: 5_000, polling: 25 }).catch(() => undefined);
    await settle(page, 1_800_000);

    for (const [i, q] of video.queries.entries()) {
      if (i > 0) {
        await input.fill(q.q);
        await input.press("Enter");
        await settle(page, 1_800_000);
      }
      const kindAtRead = await host.getAttribute("data-kind"); // "full" or "partial": every answer here is after the read
      const fullHits = JSON.parse((await host.getAttribute("data-hits")) ?? "[]") as number[];
      const [engine] = await engineSearch(control, video.id, [q.q], 2000 + i); // the engine's answer now, to check the bar's against
      queries.push({
        video: video.id,
        kind: video.kind,
        q: q.q,
        answer: q.answer,
        previewAvailable,
        previewRank: rankOf(preview[i], q.answer),
        fullRank: rankOf(fullHits, q.answer),
        previewHits: preview[i],
        previewScores: previewScores[i],
        fullHits,
        kindAtRead,
        engineKind: engine.kind,
        engineReadUntil: engine.readUntil,
        engineViewerStopped: engine.viewerStopped,
        engineHits: engine.starts,
        engineScores: engine.scores, // for the "no clear match" line (EVAL.md)
        barMatchesEngine: JSON.stringify(fullHits) === JSON.stringify(engine.starts),
      });
    }
    videos.push({ video: video.id, kind: video.kind, durationS, previewAvailable, previewSeconds, kindAfterRead, pageWarnings, fullSeconds, fullSecondsPerMinute: fullSeconds / (durationS / 60) });
    console.log(JSON.stringify(videos[videos.length - 1]));
    save();
    await page.close();
  }

  // Stutter: one tab plays; dropped frames without reading, then while another tab's video is read, then quiet again.
  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: false }));
  const watch = await context.newPage();
  await watch.goto(`https://www.youtube.com/watch?v=${WATCH_VIDEO}`);
  await watch.waitForFunction(() => !document.getElementById("movie_player")?.classList.contains("ad-showing"), null, { timeout: 300_000 });
  await watch.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > 1, null, { timeout: 120_000 });
  const gpuBeforeQuiet = gpuSnapshot();
  const quiet = await droppedShare(watch, WINDOW_S);

  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: true }));
  const other = await context.newPage();
  const windowStart = Date.now();
  await other.goto(`https://www.youtube.com/watch?v=${READ_VIDEO}`);
  await watch.bringToFront();
  const otherBar = other.locator("moments-bar");
  let readEndedAtS: number | null = null;
  let gpuWhileReading = "";
  const busy = await droppedShare(watch, WINDOW_S, async (slice) => {
    if (slice === 2) gpuWhileReading = gpuSnapshot();
    if (readEndedAtS === null && (await otherBar.getAttribute("data-kind", { timeout: 1000 }).catch(() => null)) === "preview") {
      readEndedAtS = (Date.now() - windowStart) / 1000;
    }
  });
  const otherStatusAtEnd = await otherBar.getAttribute("data-status", { timeout: 1000 }).catch(() => null);
  const gpuAfterBusy = gpuSnapshot();
  const quietAfter = await droppedShare(watch, WINDOW_S);

  const summary = {
    n: queries.length,
    top5Full: queries.filter((r) => r.fullRank !== null && r.fullRank <= 5).length,
    firstFull: queries.filter((r) => r.fullRank === 1).length,
    top5Preview: queries.filter((r) => r.previewRank !== null && r.previewRank <= 5).length,
    firstPreview: queries.filter((r) => r.previewRank === 1).length,
    searchesWithoutPreviewRead: queries.filter((r) => !r.previewAvailable).length,
    droppedQuiet: quiet.share,
    droppedWhileReading: busy.share,
    droppedQuietAfter: quietAfter.share,
  };
  const stutter = {
    quiet,
    busy,
    quietAfter,
    readEndedAtS,
    otherStatusAtEnd,
    gpuBeforeQuiet,
    gpuWhileReading,
    gpuAfterBusy,
  };
  save({ summary, stutter });
  console.log(JSON.stringify(summary));
  console.log(JSON.stringify(stutter));
  await context.close();
});

// Control for the stutter numbers above, which compare one tab playing alone with the same tab while a second
// YouTube tab (which also plays) is read. Here the second tab is opened twice: once with background reading off, once
// on. Only run on request (MOMENTS_STUTTER_CONTROL=1); it adds its numbers to results.json.
test("stutter control", async () => {
  test.skip(process.env.MOMENTS_STUTTER_CONTROL !== "1", "set MOMENTS_STUTTER_CONTROL=1 to run the stutter control");
  const { context, extensionId } = await launchExtension();
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  const warm = await engineMessage<ModelStats>(context, control, { type: "stats", load: true });
  expect(warm.phase, `the model did not load: ${warm.message}`).toBe("ready");
  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: false }));
  const watch = await context.newPage();
  await watch.goto(`https://www.youtube.com/watch?v=${WATCH_VIDEO}`);
  await watch.waitForFunction(() => !document.getElementById("movie_player")?.classList.contains("ad-showing"), null, { timeout: 300_000 });
  await watch.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > 1, null, { timeout: 120_000 });

  const quiet = await droppedShare(watch, WINDOW_S);
  const secondTab = await context.newPage(); // reading is off: this tab only plays
  await secondTab.goto(`https://www.youtube.com/watch?v=${READ_VIDEO}`);
  await watch.bringToFront();
  const secondTabPlaying = await droppedShare(watch, WINDOW_S);
  await secondTab.close();
  const quietAgain = await droppedShare(watch, WINDOW_S);

  const forgotten = await engineMessage<{ ok?: boolean }>(context, control, { type: "forget-all" }); // the video must be read again
  expect(forgotten?.ok, "forget-all was not accepted").toBe(true);
  await control.evaluate(() => chrome.storage.local.set({ backgroundReading: true }));
  const readingTab = await context.newPage();
  const start = Date.now();
  await readingTab.goto(`https://www.youtube.com/watch?v=${READ_VIDEO}`);
  await watch.bringToFront();
  const bar = readingTab.locator("moments-bar");
  let readEndedAtS: number | null = null;
  const readingTabAtEachSlice: { atS: number; kind: string | null; status: string | null }[] = [];
  const secondTabReading = await droppedShare(watch, WINDOW_S, async () => {
    const kind = await bar.getAttribute("data-kind", { timeout: 1000 }).catch(() => null);
    const status = await bar.getAttribute("data-status", { timeout: 1000 }).catch(() => null);
    readingTabAtEachSlice.push({ atS: (Date.now() - start) / 1000, kind, status });
    if (readEndedAtS === null && kind === "preview") readEndedAtS = (Date.now() - start) / 1000;
  });

  const stutterControl = { quiet, secondTabPlaying, quietAgain, secondTabReading, readEndedAtS, readingTabAtEachSlice };
  const path = new URL("./results.json", import.meta.url);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), stutterControl }, null, 1));
  console.log(JSON.stringify(stutterControl));
  await context.close();
});
