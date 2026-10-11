// web/scripts/first-visit.mjs: a fresh browser opens the site, opens Your videos, drops a clip during the
// download, waits for "indexed", then runs one search ("a person holding a gun") and needs at least one hit.
// Exit code 0 only if it finished without a crash and the search showed a result (with --no-drop: the model
// is ready; there is no clip to search).
//   node scripts/first-visit.mjs <site> <clip> [--headed] [--chromium] [--no-drop] [--insecure]
// --insecure accepts a self-signed certificate, for a local HTTPS/HTTP/2 server.
import { chromium } from "@playwright/test";

const QUERY = "a person holding a gun";
const [site, clip] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (f) => process.argv.includes(f);
const browser = await chromium.launch({
  channel: flag("--chromium") ? "chromium" : "chrome",
  headless: !flag("--headed"),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: flag("--insecure") })).newPage();
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
let crashed = false;
page.on("crash", () => {
  crashed = true;
  console.log(at(), "PAGE CRASH");
});
page.on("worker", (w) => w.on("console", (m) => console.log(at(), "worker", m.type(), m.text().slice(0, 200))));
page.on("requestfailed", (r) => console.log(at(), "FAILED", r.url().slice(-60), r.failure()?.errorText));
await page.goto(site);
await page.locator("#stats").filter({ hasText: "NASA" }).waitFor();
await page.locator("#tabOwn").click();
if (!flag("--no-drop")) await page.locator("#files").setInputFiles(clip);
let status = "";
while (!crashed && Date.now() - t0 < 240_000) {
  status = await page.locator(flag("--no-drop") ? "#model" : "#ownStatus").textContent().catch(() => "(gone)");
  if (/indexed\. Type|ready|Could not|could not/.test(status)) break;
  await page.waitForTimeout(1000);
}
const ready = !crashed && /indexed\. Type|ready/.test(status);

// One search over the indexed clip: its timing shows "ms" when done, and at least one result must be listed.
let hits = 0;
if (ready && !flag("--no-drop")) {
  await page.locator("#q").fill(QUERY);
  await page.locator("#q").press("Enter");
  await page.locator("#timing").filter({ hasText: "ms" }).waitFor({ timeout: 60_000 }).catch(() => {});
  hits = await page.locator(".hit").count();
  console.log(at(), `SEARCH "${QUERY}": ${(await page.locator("#timing").textContent()) || "no timing"}, ${hits} hits`);
}
const ok = ready && (flag("--no-drop") || hits > 0);
console.log(at(), crashed ? "RESULT crash" : `RESULT ${status}${ready && !ok ? " (the search showed no result)" : ""}`);
await browser.close().catch(() => {});
process.exit(ok ? 0 : 1);
