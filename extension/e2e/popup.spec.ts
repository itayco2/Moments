import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the popup shows the model and saved space, forgets on request, and remembers the setting", async () => {
  const { context, extensionId } = await launchExtension();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("#space")).toContainText("of 200 MB");
  await page.locator("#forget").click();
  await expect(page.locator("#space")).toContainText("Saved: 0 videos");
  const toggle = page.locator("#background");
  const was = await toggle.isChecked();
  await toggle.click();
  await page.reload();
  await expect(toggle).toBeChecked({ checked: !was });
  await toggle.click();
  await context.close();
});

test("the shortcut's message focuses the bar", async () => {
  const { context } = await launchExtension();
  const page = await context.newPage();
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(page.locator("moments-bar")).toBeAttached({ timeout: 30_000 });
  const [worker] = context.serviceWorkers();
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://www.youtube.com/watch*" });
    await chrome.tabs.sendMessage(tab.id!, { type: "focus" });
  });
  await expect.poll(() => page.evaluate(() => document.querySelector("moments-bar")?.shadowRoot?.activeElement?.tagName)).toBe("INPUT");
  await context.close();
});
