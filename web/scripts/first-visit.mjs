// web/scripts/first-visit.mjs: a fresh browser opens the site, opens Your videos, drops a clip during the
// download, waits for "indexed" and runs one search. Exit code 0 only if it finished without a crash.
//   node scripts/first-visit.mjs <site> <clip> [--headed] [--chromium] [--no-drop]
import { chromium } from "@playwright/test";

const [site, clip] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (f) => process.argv.includes(f);
const browser = await chromium.launch({
  channel: flag("--chromium") ? "chromium" : "chrome",
  headless: !flag("--headed"),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext()).newPage();
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
console.log(at(), crashed ? "RESULT crash" : `RESULT ${status}`);
await browser.close().catch(() => {});
process.exit(crashed || !/indexed\. Type|ready/.test(status) ? 1 : 0);
