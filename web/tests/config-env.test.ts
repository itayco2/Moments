import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("where the worker loads the model and its runtime from", () => {
  it("uses Hugging Face and the runtime's CDN by default", async () => {
    const config = await import("../src/config");
    expect(config.MODEL_BASE).toBeNull();
    expect(config.ORT_BASE).toBeNull();
  });

  it("uses the site's own copy when the site is built self-hosted", async () => {
    vi.stubEnv("VITE_SELF_HOSTED_MODEL", "1");
    const config = await import("../src/config");
    expect(config.MODEL_BASE).toBe(`/models/${config.MODEL_REVISION.slice(0, 7)}/`);
  });

  it("lets the extension point at the website's copy and its own bundled runtime", async () => {
    vi.stubEnv("VITE_MODEL_BASE", "https://moments-video.vercel.app/models/daa72c5/");
    vi.stubEnv("VITE_ORT_BASE", "/ort/");
    const config = await import("../src/config");
    expect(config.MODEL_BASE).toBe("https://moments-video.vercel.app/models/daa72c5/");
    expect(config.ORT_BASE).toBe("/ort/");
  });
});
