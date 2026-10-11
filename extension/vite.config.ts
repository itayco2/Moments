// Unit tests only; the extension itself is built by build.mjs.
import { defineConfig } from "vite";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
