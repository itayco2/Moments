import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Downloads the real model (about 285 MB at 4-bit), so it runs on request, not on every push:
//   MOMENTS_E2E_CLIP=D:/moments/parity/liftoff-20s.mp4 npx playwright test own-video
const CLIP = process.env.MOMENTS_E2E_CLIP ?? "";

test.skip(!CLIP || !existsSync(CLIP), "set MOMENTS_E2E_CLIP to a short local clip to run this test");
test.setTimeout(15 * 60_000);

test("a dropped clip is indexed in the browser and found by typing", async ({ page }) => {
  await page.goto("http://localhost:5174/");
  await page.getByRole("button", { name: "Your videos" }).click();
  await page.locator("#files").setInputFiles(CLIP);
  await expect(page.locator("#ownStatus")).toContainText("1 videos indexed", { timeout: 14 * 60_000 });

  await page.locator("#q").fill("a rocket lifting off");
  await page.locator("#q").press("Enter");
  await expect(page.locator(".hit").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#nowAt")).toContainText("of 0:");
  console.log(`model: ${await page.locator("#model").textContent()}`);
});
