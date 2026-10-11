import { chromium, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
// A fixed profile keeps the 402 MB model cached between test runs. MOMENTS_PROFILE points a run at another folder
// (an empty one is a cold start, which must still load the model from the website).
const PROFILE = process.env.MOMENTS_PROFILE ?? fileURLToPath(new URL("../.pw-profile", import.meta.url));

export async function launchExtension(extraArgs: string[] = []): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Without these YouTube treats the browser as a bot: after about a minute of a video its media requests are
    // refused (403) and the player drops its source (PREFLIGHT PF32). A viewer's Chrome never has them.
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      ...extraArgs,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, extensionId: new URL(worker.url()).host };
}

// The runtime can only come from the bundle and the weights only from the website's copy:
// the runtime's CDN and Hugging Face both fail to resolve.
export const ONLY_BUNDLE_AND_WEBSITE = ["--host-resolver-rules=MAP cdn.jsdelivr.net 0.0.0.0, MAP huggingface.co 0.0.0.0, MAP *.hf.co 0.0.0.0"];
