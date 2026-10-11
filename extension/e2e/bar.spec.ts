import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the bar appears under the player, reads previews, finds a moment and marks it", async () => {
  const { context, extensionId } = await launchExtension();
  // Start from nothing saved: the profile is shared, and an earlier full read would answer "full" at once.
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(await setup.evaluate(() => chrome.runtime.sendMessage({ type: "forget-all" }))).toEqual({ ok: true });
  await setup.evaluate(() => chrome.storage.local.set({ backgroundReading: true })); // the default is off (EVAL.md)
  await setup.close();
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const host = page.locator("moments-bar");
  expect(await page.evaluate(() => navigator.webdriver)).toBe(false); // YouTube sees an ordinary browser (helpers.ts)
  await expect(host).toHaveAttribute("data-place", "below", { timeout: 30_000 });
  await expect(host).toHaveAttribute("data-kind", "preview", { timeout: 180_000 });
  const input = host.locator("input");
  await input.fill("a man in a trench coat dancing");
  await input.press("Enter");
  await expect(host).not.toHaveAttribute("data-hits", "[]", { timeout: 60_000 });
  const first = JSON.parse((await host.getAttribute("data-hits")) ?? "[]")[0] as number;
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.currentTime ?? -1)).toBeGreaterThanOrEqual(first - 1);
  await expect(page.locator(".ytp-progress-bar > .moments-marks > div").first()).toBeAttached();
  await input.press("Enter");
  await expect(host).toHaveAttribute("data-current", "1");
  await context.close();
});
