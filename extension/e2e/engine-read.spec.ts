import { expect, test } from "@playwright/test";
import short from "../tests/fixtures/spec_short.json" with { type: "json" };
import { launchExtension } from "./helpers";

test("the engine reads a video from its previews, saves it and answers a search", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const outcome = await page.evaluate(async (fixture) => {
    type Message = { type: string; kind?: string; phase?: string; hits?: { start: number }[]; problem?: string | null; message?: string };
    // "engine:ensure" answers only once the engine page has announced that it is listening, so the first message
    // and the first port below are accepted without any retrying.
    const ensured = await chrome.runtime.sendMessage({ type: "engine:ensure" });
    if (!ensured?.ok) throw new Error(`the engine did not start: ${ensured?.message}`);
    const forgotten = await chrome.runtime.sendMessage({ type: "forget-all" });
    if (!forgotten?.ok) throw new Error(`forget-all was not accepted: ${JSON.stringify(forgotten)}`);

    const connect = () => chrome.runtime.connect({ name: "moments" });
    const trace: string[] = [];
    const waitFor = (port: chrome.runtime.Port, label: string, pred: (m: Message) => boolean) =>
      new Promise<Message>((resolve, reject) => {
        // Say what was missing and what did arrive, instead of leaving the test to its 5 minute timeout.
        const timer = setTimeout(() => reject(new Error(`no ${label} within 90 s; seen: ${trace.slice(-12).join(" | ")}`)), 90_000);
        port.onDisconnect.addListener(() => reject(new Error(`the engine closed the port: ${chrome.runtime.lastError?.message}`)));
        port.onMessage.addListener(function on(m: Message) {
          if (m.type !== "model" || m.phase !== "loading") trace.push(`${label}:${m.type}/${m.kind ?? m.phase ?? ""}`); // not the download progress
          // A read that failed never reaches "preview": say why now.
          if (m.type === "state" && m.problem) reject(new Error(`engine reported ${m.problem}: ${m.message}`));
          if (pred(m)) {
            clearTimeout(timer);
            port.onMessage.removeListener(on);
            resolve(m);
          }
        });
      });
    const isPreview = (m: Message) => m.type === "state" && m.kind === "preview";

    // Two tabs open the same video at once: one read, and both hear that it is done.
    const first = connect();
    const second = connect();
    const firstDone = waitFor(first, "first tab: preview", isPreview);
    const secondDone = waitFor(second, "second tab: preview", isPreview);
    const t0 = performance.now();
    const open = { type: "open", videoId: fixture.videoId, duration: fixture.lengthSeconds, spec: fixture.spec, autoRead: true };
    first.postMessage(open);
    second.postMessage(open);
    await firstDone;
    const readSeconds = (performance.now() - t0) / 1000;
    await secondDone;

    first.postMessage({ type: "search", id: 1, videoId: fixture.videoId, query: "a man singing into a microphone" });
    const results = await waitFor(first, "search results", (m) => m.type === "results");
    const stats = await chrome.runtime.sendMessage({ type: "stats" });

    // Opening a video the engine already holds in memory still refreshes its date in storage (the 200 MB cap evicts
    // the longest unopened video). The popup shares the engine page's origin, so it can read the saved dates.
    const lastOpened = () =>
      new Promise<number>((resolve, reject) => {
        const opening = indexedDB.open("moments");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const get = opening.result.transaction("meta").objectStore("meta").get(fixture.videoId);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result?.lastOpened);
        };
      });
    const before = await lastOpened();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reopened = waitFor(second, "reopened state", isPreview);
    second.postMessage(open);
    await reopened;
    const after = await lastOpened();
    return { readSeconds, hits: results.hits ?? [], stats, refreshedDate: after > before };
  }, short);
  expect(outcome.hits.length).toBeGreaterThan(0);
  expect(outcome.hits[0].start).toBeLessThanOrEqual(213);
  expect(outcome.stats.videos).toBe(1);
  expect(outcome.refreshedDate).toBe(true);
  console.log(`preview read of a 3.5-minute video: ${outcome.readSeconds.toFixed(1)} s`);
  await context.close();
});
