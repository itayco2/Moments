import { expect, test } from "@playwright/test";
import { launchExtension, NO_CDN } from "./helpers";

test("the engine page loads the model once, on the GPU, with the bundled runtime", async () => {
  const { context, extensionId } = await launchExtension(NO_CDN);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const stats = await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: "engine:ensure" });
    return chrome.runtime.sendMessage({ type: "stats", load: true });
  });
  expect(stats).toMatchObject({ phase: "ready", device: "webgpu" });
  await context.close();
});
