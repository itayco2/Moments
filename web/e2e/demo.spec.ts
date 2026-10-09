import { expect, test } from "@playwright/test";

const URL = "http://localhost:5174/";

test("an example search finds the hurricane and plays NASA's video from that second", async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator("#stats")).toContainText("of NASA footage");
  await page.getByRole("button", { name: "a hurricane seen from space" }).click();

  const first = page.locator(".hit").first();
  await expect(first).toContainText("Earth from the Space Station");
  await expect(first).toContainText("at 32:");
  await expect(page.locator(".hit")).toHaveCount(6);
  await expect(page.locator("#nowAt")).toContainText("of 52:");
  await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.currentSrc)).toContain(
    "images-assets.nasa.gov",
  );
});

test("one long shot shows up once, not once per frame (PF10)", async ({ page }) => {
  await page.goto(URL);
  await page.getByRole("button", { name: "a hurricane seen from space" }).click();
  await expect(page.locator(".hit")).toHaveCount(6);
  const times = await page.locator(".hit .at").allTextContents();
  const nearHurricane = times.filter((t) => /at 3[23]:\d\d/.test(t));
  expect(nearHurricane).toHaveLength(1);
});

test("a shared link opens on its search, and a new search rewrites the address", async ({ page }) => {
  await page.goto(`${URL}?q=a+hurricane+seen+from+space`);
  await expect(page.locator("#q")).toHaveValue("a hurricane seen from space");
  await expect(page.locator(".hit").first()).toContainText("Earth from the Space Station");
  await expect(page.locator("#share")).toBeVisible();

  await page.getByRole("button", { name: "astronauts on the Moon" }).click();
  await expect(page.locator("#nowName")).toHaveText("Apollo 11");
  await expect(page).toHaveURL(/\?q=astronauts\+on\+the\+Moon$/);

  await page.getByRole("button", { name: "Your videos" }).click();
  await expect(page).toHaveURL(URL);
  await expect(page.locator("#share")).toBeHidden();
});

test("the own-videos tab starts clean and says plainly that nothing is uploaded", async ({ page }) => {
  await page.goto(URL);
  await page.getByRole("button", { name: "astronauts on the Moon" }).click();
  await expect(page.locator("#nowName")).toHaveText("Apollo 11");
  await page.getByRole("button", { name: "Your videos" }).click();
  await expect(page.locator("#drop")).toContainText("Drop videos here");
  await expect(page.locator("#own .privacy")).toContainText("Nothing is uploaded");
  await expect(page.locator("#q")).toHaveValue("");
  await expect(page.locator("#nowName")).toHaveText("Nothing playing yet");
  await expect(page.locator("#model")).toContainText("picture model");
});
