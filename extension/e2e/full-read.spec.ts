import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the first search reads the video in full detail and puts the player back", async () => {
  const { context, extensionId } = await launchExtension();
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await setup.evaluate(() => chrome.runtime.sendMessage({ type: "forget-all" }));
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const host = page.locator("moments-bar");
  await expect(host).toHaveAttribute("data-kind", "preview", { timeout: 180_000 });
  await page.waitForFunction(() => !document.getElementById("movie_player")?.classList.contains("ad-showing"), null, { timeout: 120_000 });
  const before = await page.evaluate(() => document.querySelector("video")!.currentTime);
  await host.locator("input").fill("a woman with blonde hair");
  await host.locator("input").press("Enter");
  await expect(page.locator("moments-overlay")).toBeAttached({ timeout: 30_000 });
  await expect(host).toHaveAttribute("data-kind", "full", { timeout: 300_000 });
  await expect(page.locator("moments-overlay")).not.toBeAttached();
  await expect(host).not.toHaveAttribute("data-hits", "[]", { timeout: 60_000 });
  const after = await page.evaluate(() => document.querySelector("video")!.currentTime);
  expect(Math.abs(after - before)).toBeLessThan(250); // restored, then jumped to a match inside the video
  await context.close();
});
