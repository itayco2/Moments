import { defineConfig } from "@playwright/test";

// Google Chrome, not Playwright's Chromium: only Chrome plays the H.264 MP4s that NASA serves.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  use: { channel: "chrome", headless: true, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
});
