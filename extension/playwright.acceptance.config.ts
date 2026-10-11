import { defineConfig } from "@playwright/test";

// The acceptance run reads three real videos in full detail and then measures stutter: it takes a long time.
export default defineConfig({ testDir: "acceptance", timeout: 3_600_000, retries: 0, workers: 1 });
