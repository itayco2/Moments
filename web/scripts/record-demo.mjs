// Record the feed video for the post: three NASA searches, then a dropped video indexed and searched in the
// browser, with a caption band (LinkedIn plays videos muted) and an end card naming the site.
// Google Chrome (plays H.264) with a persistent profile, so the model loads from cache, not the network.
// Frames come from Chrome's screencast and ffmpeg stitches them at their real timestamps: nothing is sped up.
// A still for the post's cover is saved next to the video.
//   node scripts/record-demo.mjs http://localhost:5173/ D:/moments/parity/mars-landing.mp4 D:/moments/pw-profile \
//        D:/moments/demo/moments-web-4x5.mp4 github.com/itayco2/Moments
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , url, clip, profile, out, site = "github.com/itayco2/Moments", size = "1080x1350"] = process.argv;
if (!url || !clip || !profile || !out) {
  console.error("usage: node scripts/record-demo.mjs <url> <clip> <profile dir> <out.mp4> [site shown at the end] [WxH]");
  process.exit(2);
}
const [width, height] = size.split("x").map(Number);
const HOLD_MS = 2500;
const END_CARD_MS = 3000;
const TYPE_DELAY_MS = 55;
const FPS = 30;
const HOOK = "3 hours of video. Type <b>one sentence</b>.";

// The band stays opaque and only its text fades, so the page header never shows through a caption change.
// The text sits in one span: a flex container drops the spaces around a bare <b>.
const OVERLAY = `
#rec-cap { position: fixed; z-index: 50; inset: 0 0 auto; height: 118px; display: flex; align-items: center; padding: 0 40px;
  background: #f7f6f3; border-bottom: 1px solid #e4e2dc; color: #16161a; font: 600 44px/1.08 Geist, sans-serif;
  letter-spacing: -0.03em; }
#rec-cap span { text-wrap: balance; transition: opacity 0.2s ease; }
#rec-cap b, #rec-end b { color: #4b3fd6; font-weight: 600; }
#rec-end { position: fixed; z-index: 60; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 34px;
  padding: 0 90px; background: #f7f6f3; color: #16161a; font-family: Geist, sans-serif; opacity: 0;
  transition: opacity 0.35s ease; pointer-events: none; }
#rec-end .logo { display: flex; align-items: center; gap: 16px; font-size: 40px; font-weight: 600; letter-spacing: -0.02em; }
#rec-end .big { font-size: 128px; line-height: 1; font-weight: 600; letter-spacing: -0.05em; }
#rec-end .sub { font-size: 42px; line-height: 1.25; color: #3a3a40; letter-spacing: -0.02em; }
#rec-end .facts { font: 30px "Geist Mono", monospace; color: #6b6a72; }
#rec-end .url { align-self: flex-start; padding: 18px 28px; border: 2px solid #d9d5fb; border-radius: 16px; background: #f6f5fe;
  font: 500 38px "Geist Mono", monospace; color: #4b3fd6; }`;

const LOGO = `<svg width="60" height="60" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#16161A"/><path d="M6.5 18.5h15"
  stroke="#F7F6F3" stroke-width="2" stroke-linecap="round"/><rect x="15" y="8.5" width="3.2" height="13" rx="1.6" fill="#9D92FA"/></svg>`;

const endCard = (address) => `
  <div class="logo">${LOGO}<span>Moments</span></div>
  <div class="big">Ctrl+F<br>for video.</div>
  <div class="sub">Type what you remember.<br>It jumps to that second.</div>
  <div class="facts">Free. Open source. Runs in your browser.</div>
  <div class="url">${address}</div>`;

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
await page.locator("#tabOwn").click();
// The status line is hidden in the portrait layout, so wait on its text rather than its visibility.
await page.waitForFunction(() => document.getElementById("model")?.textContent?.includes("ready"), null, {
  timeout: 300_000,
});
await page.waitForTimeout(1500);
if (await page.locator("#clear").isVisible()) await page.locator("#clear").click();
await page.locator("#tabDemo").click();

await page.evaluate(
  ([css, hook, card]) => {
    document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
    const text = Object.assign(document.createElement("span"), { innerHTML: hook });
    const cap = Object.assign(document.createElement("div"), { id: "rec-cap" });
    const end = Object.assign(document.createElement("div"), { id: "rec-end", innerHTML: card });
    cap.append(text);
    document.body.append(cap, end);
    window.__cap = (html) => {
      text.style.opacity = "0";
      setTimeout(() => {
        text.innerHTML = html;
        text.style.opacity = "1";
      }, 200);
    };
  },
  [OVERLAY, HOOK, endCard(site)],
);
await page.waitForTimeout(1200);
const caption = (html) => page.evaluate((h) => window.__cap(h), html);

// An example search types itself into the box (the example buttons are hidden in portrait; click from script).
async function example(query, after) {
  await page.evaluate((q) => [...document.querySelectorAll(".chip")].find((c) => c.textContent === q)?.click(), query);
  await page.waitForFunction(
    (q) => document.getElementById("q").value === q && /\d ms/.test(document.getElementById("timing").textContent),
    query,
  );
  if (after) await caption(after);
  await page.waitForTimeout(HOLD_MS);
}

const dir = mkdtempSync(join(tmpdir(), "moments-rec-"));
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", async (e) => {
  const path = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
  writeFileSync(path, Buffer.from(e.data, "base64"));
  frames.push({ t: e.metadata.timestamp, path, arrived: Date.now() / 1000 });
  await cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width, maxHeight: height });
await page.waitForTimeout(600);

// 1. The NASA library: the first jump lands inside two seconds.
await example("a rocket lifting off", "It plays from that <b>exact second</b>.");
await example("astronauts on the Moon", "No tags, no transcript. It <b>looks at the pictures</b>.");
await example("a hurricane seen from space", "Anything you can <b>describe</b>.");

// 2. Your own video: drop it, watch it index at real speed, search it by typing.
await caption("Now <b>your own video</b>. Nothing is uploaded.");
await page.locator("#tabOwn").click();
await page.waitForTimeout(1600);
await page.locator("#files").setInputFiles(clip);
await page.locator("#ownStatus").filter({ hasText: "Indexing" }).waitFor({ timeout: 60_000 });
await caption("Your GPU reads it. <b>Real speed</b>, not sped up.");
await page.locator("#ownStatus").filter({ hasText: " indexed. Type" }).waitFor({ timeout: 300_000 });
await caption("Then search it the same way.");
await page.waitForTimeout(600);
await page.locator("#q").click();
await page.locator("#q").pressSequentially("the rover hanging from cables", { delay: TYPE_DELAY_MS });
await page.locator("#q").press("Enter");
await page.locator("#nowAt").filter({ hasText: " of " }).waitFor();
await caption("Found in <b>your own video</b>.");
// The upload panel pushes the results below the frame: bring them into view.
await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
await page.waitForTimeout(HOLD_MS + 800);

// 3. The end card.
await page.evaluate(() => (document.getElementById("rec-end").style.opacity = "1"));
await page.waitForTimeout(END_CARD_MS);
const stoppedAt = Date.now() / 1000;
await cdp.send("Page.stopScreencast");

// The cover still: the Apollo result under the opening line, staged after recording stopped.
await page.evaluate(() => {
  document.getElementById("rec-end").style.opacity = "0";
  window.scrollTo({ top: 0, behavior: "instant" });
});
await page.locator("#tabDemo").click();
await example("astronauts on the Moon", HOOK);
await page.screenshot({ path: out.replace(/\.mp4$/, "-cover.png") });
await context.close();

const lines = [];
for (let i = 0; i < frames.length; i++) {
  // A still end card sends no new frames, so the last frame lasts until the recording stopped.
  const seconds = i === frames.length - 1 ? stoppedAt - frames[i].arrived : Math.max(frames[i + 1].t - frames[i].t, 1 / FPS);
  lines.push(`file '${frames[i].path.replaceAll("\\", "/")}'`, `duration ${seconds.toFixed(4)}`);
}
lines.push(`file '${frames.at(-1).path.replaceAll("\\", "/")}'`);
const listing = join(dir, "frames.txt");
writeFileSync(listing, lines.join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, "-vf",
  `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", out]);
rmSync(dir, { recursive: true, force: true });
console.log(`${frames.length} frames -> ${out}`);
