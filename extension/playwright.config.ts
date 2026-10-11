import { defineConfig } from "@playwright/test";

// The unpacked extension runs in Playwright's own Chromium: branded Chrome no longer loads unpacked extensions
// from the command line. YouTube serves VP9 or AV1 there, which Chromium plays.
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  retries: 0,
  workers: 1,
});
