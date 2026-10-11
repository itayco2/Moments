import { expect, test } from "@playwright/test";
import { launchExtension, ONLY_BUNDLE_AND_WEBSITE } from "./helpers";

test("the engine page loads the model once, on the GPU, with the bundled runtime", async () => {
  const { context, extensionId } = await launchExtension(ONLY_BUNDLE_AND_WEBSITE);
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const ensured = await page.evaluate(() => chrome.runtime.sendMessage({ type: "engine:ensure" }));
    expect(ensured).toEqual({ ok: true });
    const stats = await page.evaluate(() => chrome.runtime.sendMessage({ type: "stats", load: true }));
    expect(stats).toMatchObject({ phase: "ready", device: "webgpu" });
  } finally {
    await context.close();
  }
});
