import { expect, test } from "@playwright/test";
import { launchExtension } from "./helpers";

test("the page reader reports the video and follows in-page navigation", async () => {
  const { context } = await launchExtension();
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { seen: string[] }).seen = [];
    window.addEventListener("message", (e) => {
      if (e.data?.source === "moments-page") (window as unknown as { seen: string[] }).seen.push(e.data.info.videoId);
    });
  });
  const lastSeen = () => page.evaluate(() => (window as unknown as { seen: string[] }).seen.at(-1));
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect.poll(lastSeen, { timeout: 30_000 }).toBe("dQw4w9WgXcQ");

  // Click a suggested video: YouTube navigates inside the page, without a reload. (YouTube's current layout
  // lists them as yt-lockup-view-model items.)
  const next = page.locator("ytd-item-section-renderer yt-lockup-view-model a[href^='/watch?v=']").first();
  const nextId = new URL((await next.getAttribute("href", { timeout: 30_000 })) ?? "", "https://www.youtube.com").searchParams.get("v");
  expect(nextId).toMatch(/^[A-Za-z0-9_-]{11}$/);
  expect(nextId).not.toBe("dQw4w9WgXcQ");
  await next.click();
  await expect.poll(lastSeen, { timeout: 30_000 }).toBe(nextId);
  // The list was not reset, so the page did not reload: this really was in-page navigation.
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toContain("dQw4w9WgXcQ");
  await context.close();
});
