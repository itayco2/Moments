// Renders the site's logo at the sizes Chrome asks for.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#16161A"/><path d="M6.5 18.5h15" stroke="#F7F6F3" stroke-width="2" stroke-linecap="round"/><rect x="15" y="8.5" width="3.2" height="13" rx="1.6" fill="#9D92FA"/></svg>`;
mkdirSync("icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${SVG.replace("<svg ", `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: `icons/${size}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log("icons written");
