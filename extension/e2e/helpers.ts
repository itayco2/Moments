import { chromium, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
// A fixed profile keeps the 402 MB model cached between test runs.
const PROFILE = fileURLToPath(new URL("../.pw-profile", import.meta.url));

export async function launchExtension(extraArgs: string[] = []): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--autoplay-policy=no-user-gesture-required", ...extraArgs],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return { context, extensionId: new URL(worker.url()).host };
}

// Any request to the runtime's CDN fails to resolve: the model can only load if the runtime is bundled.
export const NO_CDN = ["--host-resolver-rules=MAP cdn.jsdelivr.net 0.0.0.0"];
