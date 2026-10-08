// Record the website demo for the post: two NASA searches, then a dropped video indexed and searched in the
// browser. Google Chrome (plays H.264) with a persistent profile, so the model loads from cache, not the network.
// Frames come from Chrome's screencast at high JPEG quality and ffmpeg stitches them at their real timestamps.
//   node scripts/record-demo.mjs http://localhost:5173/ D:/moments/parity/mars-landing.mp4 D:/moments/pw-profile \
//        D:/moments/demo/moments-web-4x5.mp4
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , url, clip, profile, out, size = "1080x1350"] = process.argv;
if (!url || !clip || !profile || !out) {
  console.error("usage: node scripts/record-demo.mjs <url> <clip> <profile dir> <out.mp4> [WxH]");
  process.exit(2);
}
const [width, height] = size.split("x").map(Number);
const HOLD_MS = 5500;
const TYPE_DELAY_MS = 55;
const FPS = 30;

const context = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: true,
  viewport: { width, height },
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url);
await page.locator("#stats").filter({ hasText: "NASA" }).waitFor();

// Warm up off camera: load both halves of the model from cache and forget any saved library.
await page.getByRole("button", { name: "Your videos" }).click();
// The status line is hidden in the portrait layout, so wait on its text rather than its visibility.
await page.waitForFunction(() => document.getElementById("model")?.textContent?.includes("ready"), null, {
  timeout: 300_000,
});
await page.waitForTimeout(1500);
if (await page.locator("#clear").isVisible()) await page.locator("#clear").click();
await page.getByRole("button", { name: "NASA footage" }).click();
await page.waitForTimeout(1500);

const dir = mkdtempSync(join(tmpdir(), "moments-rec-"));
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", async (e) => {
  const path = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
  writeFileSync(path, Buffer.from(e.data, "base64"));
  frames.push([e.metadata.timestamp, path]);
  await cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width, maxHeight: height });
await page.waitForTimeout(900);

// 1. Two searches over the NASA library (the example buttons are hidden in portrait; click them from script).
for (const query of ["a rocket lifting off", "a hurricane seen from space"]) {
  await page.evaluate((q) => [...document.querySelectorAll(".chip")].find((c) => c.textContent === q)?.click(), query);
  await page.locator("#nowAt").filter({ hasText: " of " }).waitFor();
  await page.waitForTimeout(HOLD_MS);
}

// 2. Your own video: drop it, watch it index, search it by typing.
await page.getByRole("button", { name: "Your videos" }).click();
await page.waitForTimeout(1200);
await page.locator("#files").setInputFiles(clip);
await page.locator("#ownStatus").filter({ hasText: "videos indexed" }).waitFor({ timeout: 300_000 });
await page.waitForTimeout(700);
await page.locator("#q").click();
await page.locator("#q").pressSequentially("a red and white parachute", { delay: TYPE_DELAY_MS });
await page.locator("#q").press("Enter");
await page.locator("#nowAt").filter({ hasText: " of " }).waitFor();
await page.waitForTimeout(HOLD_MS + 1000);

await cdp.send("Page.stopScreencast");
await context.close();

const listing = join(dir, "frames.txt");
const lines = [];
for (let i = 0; i < frames.length - 1; i++) {
  lines.push(`file '${frames[i][1].replaceAll("\\", "/")}'`, `duration ${Math.max(frames[i + 1][0] - frames[i][0], 1 / FPS).toFixed(4)}`);
}
const last = frames.at(-1)[1].replaceAll("\\", "/");
lines.push(`file '${last}'`, "duration 1.0", `file '${last}'`);
writeFileSync(listing, lines.join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, "-vf",
  `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", out]);
rmSync(dir, { recursive: true, force: true });
console.log(`${frames.length} frames over ${(frames.at(-1)[0] - frames[0][0]).toFixed(1)} s -> ${out}`);
