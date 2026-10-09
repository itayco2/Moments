// Time the whole your-videos path in Google Chrome: grab frames, embed them on the GPU, save the library.
// A persistent profile keeps the model cached, so the first run downloads it and later runs measure indexing.
//   node scripts/measure-indexing.mjs http://localhost:5173/ D:/moments/footage/perseverance-landing.mp4 D:/moments/pw-profile
import { chromium } from "@playwright/test";

const [, , url, clip, profile] = process.argv;
if (!url || !clip || !profile) {
  console.error("usage: node scripts/measure-indexing.mjs <page url> <video file> <profile dir>");
  process.exit(2);
}

const context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url);
await page.getByRole("button", { name: "Your videos" }).click();
// The page restores a saved library asynchronously; wait for it, then forget it so the file is indexed again.
await page.waitForTimeout(2000);
if (await page.locator("#clear").isVisible()) {
  await page.locator("#clear").click();
  await page.locator("#clear").waitFor({ state: "hidden" });
}

const t0 = Date.now();
await page.locator("#files").setInputFiles(clip);
let firstFrameAt = null;
let lastStatus = "";
for (;;) {
  const status = (await page.locator("#ownStatus").textContent()) ?? "";
  if (status !== lastStatus) {
    if (firstFrameAt === null && /: \d+ of \d+ frames/.test(status)) firstFrameAt = Date.now();
    lastStatus = status;
  }
  if (/ indexed\. Type|Could not index/.test(status)) break;
  await page.waitForTimeout(500);
}
const total = (Date.now() - t0) / 1000;
const indexing = (Date.now() - (firstFrameAt ?? t0)) / 1000;
const frames = Number((await page.locator("#stats").textContent())?.match(/([\d,]+) moments/)?.[1].replace(",", ""));
const model = await page.locator("#model").textContent();
console.log(`${model}`);
console.log(`${frames} frames: ${total.toFixed(1)} s from drop to done (includes model load), ` +
  `${indexing.toFixed(1)} s indexing, ${(frames / indexing).toFixed(1)} frames/s`);

// Then search the fresh library, to check the result as well as the speed.
for (const query of process.argv.slice(5)) {
  await page.locator("#q").fill(query);
  await page.locator("#q").press("Enter");
  await page.locator(".hit").first().waitFor();
  await page.waitForTimeout(300);
  const top = (await page.locator(".hit .at").allTextContents()).slice(0, 3).join(", ");
  console.log(`${JSON.stringify(query)} (${await page.locator("#timing").textContent()}): ${top}`);
}
await context.close();
