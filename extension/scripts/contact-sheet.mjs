// extension/scripts/contact-sheet.mjs: renders a video's 320x180 preview frames with their times into one PNG, so
// answers can be written down before any search runs.  node scripts/contact-sheet.mjs <videoId> <out.png>
import { chromium } from "@playwright/test";

const [id, out] = process.argv.slice(2);
const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "accept-language": "en-US" } })).text();
const spec = JSON.parse(`"${/"spec":"(https:\/\/i\.ytimg\.com\/sb\/[^"]+)"/.exec(html)[1]}"`);
const length = Number(/"lengthSeconds":"(\d+)"/.exec(html)[1]);
const [base, ...levels] = spec.split("|");
const top = levels.length - 1;
const [w, h, count, cols, rows, interval, name, sigh] = levels[top].split("#");
const per = cols * rows;
const cells = [];
for (let k = 0; k < Number(count) && (k * interval) / 1000 <= length; k++) {
  const sheet = `${base.replace("$L", top).replace("$N", name.replace("$M", Math.floor(k / per)))}&sigh=${sigh}`;
  const cell = k % per;
  const t = (k * interval) / 1000;
  cells.push(`<figure><div style="width:${w}px;height:${h}px;background:url('${sheet}') -${(cell % cols) * w}px -${Math.floor(cell / cols) * h}px"></div><figcaption>${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}</figcaption></figure>`);
}
const browser = await chromium.launch({ channel: "chromium" }); // new headless mode: works with the full Chromium build alone
const page = await browser.newPage({ viewport: { width: 6 * (Number(w) + 8), height: 800 } });
await page.setContent(`<style>body{margin:0;display:flex;flex-wrap:wrap;font:14px Arial}figure{margin:4px}figcaption{text-align:center}</style>${cells.join("")}`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${cells.length} frames, every ${interval / 1000} s -> ${out}`);
