import { expect, test } from "@playwright/test";
import short from "../tests/fixtures/spec_short.json" with { type: "json" };
import { launchExtension } from "./helpers";

test("the engine reads a video from its previews, saves it and answers a search", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const outcome = await page.evaluate(async (fixture) => {
    // For a few milliseconds after the engine page exists, Chrome can still refuse a page's first message or port
    // ("Receiving end does not exist"), and a refused port never delivers anything. So: try again until it takes.
    const settle = async <T>(attempt: () => Promise<T | undefined>): Promise<T> => {
      for (let i = 0; i < 40; i++) {
        const got = await attempt();
        if (got !== undefined) return got;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("the engine never accepted a message");
    };
    await chrome.runtime.sendMessage({ type: "engine:ensure" });
    // Forget only once the engine is there: with no engine page the message has no receiver, saved videos stay, and
    // the read below would be answered from storage instead of being read.
    await settle(async () => ((await chrome.runtime.sendMessage({ type: "forget-all" }))?.ok ? true : undefined));
    const port = await settle(
      () =>
        new Promise<chrome.runtime.Port | undefined>((resolve) => {
          const p = chrome.runtime.connect({ name: "moments" });
          p.onMessage.addListener(function greeted() {
            p.onMessage.removeListener(greeted); // the engine greets every new port with the model state
            resolve(p);
          });
          p.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            resolve(undefined);
          });
        }),
    );
    const seen: { type: string; kind?: string; hits?: unknown[] }[] = [];
    const next = (pred: (m: { type: string; kind?: string; hits?: unknown[] }) => boolean) =>
      new Promise<{ type: string; kind?: string; hits?: { start: number }[] }>((resolve, reject) => {
        port.onMessage.addListener(function on(m) {
          seen.push(m);
          // A read that failed never reaches "preview": say why now instead of waiting for the test's timeout.
          if (m.type === "state" && m.problem) reject(new Error(`engine reported ${m.problem}: ${m.message}`));
          if (pred(m)) {
            port.onMessage.removeListener(on);
            resolve(m);
          }
        });
      });
    const t0 = performance.now();
    port.postMessage({ type: "open", videoId: fixture.videoId, duration: fixture.lengthSeconds, spec: fixture.spec, autoRead: true });
    await next((m) => m.type === "state" && m.kind === "preview");
    const readSeconds = (performance.now() - t0) / 1000;
    port.postMessage({ type: "search", id: 1, videoId: fixture.videoId, query: "a man singing into a microphone" });
    const results = await next((m) => m.type === "results");
    const stats = await chrome.runtime.sendMessage({ type: "stats" });
    return { readSeconds, hits: results.hits ?? [], stats };
  }, short);
  expect(outcome.hits.length).toBeGreaterThan(0);
  expect(outcome.hits[0].start).toBeLessThanOrEqual(213);
  expect(outcome.stats.videos).toBe(1);
  console.log(`preview read of a 3.5-minute video: ${outcome.readSeconds.toFixed(1)} s`);
  await context.close();
});
