import { count, megabytes } from "../../../web/src/format";
import { readSettings, writeSettings } from "../settings";
import { CAP_BYTES } from "../store-policy";

interface Stats {
  phase: "idle" | "loading" | "ready" | "error";
  device: "webgpu" | "wasm" | null;
  message: string;
  videos: number;
  bytes: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function wakeEngine(): Promise<void> {
  const answer = await chrome.runtime.sendMessage({ type: "engine:ensure" });
  if (!answer?.ok) throw new Error(answer?.message ?? "the Moments engine did not start");
}

async function stats(): Promise<Stats> {
  await wakeEngine();
  return chrome.runtime.sendMessage({ type: "stats" });
}

function modelText(s: Stats): string {
  if (s.phase === "error") return `The AI model could not load: ${s.message}`;
  if (s.phase === "loading") return "The AI model is loading.";
  if (s.phase === "ready") return `The AI model is ready, running ${s.device === "webgpu" ? "on your GPU" : "on your CPU (slower)"}.`;
  return "The AI model loads when you open a YouTube video.";
}

async function render(): Promise<void> {
  try {
    const s = await stats();
    $("model").textContent = modelText(s);
    $("space").textContent = `Saved: ${count(s.videos, "video")}, ${megabytes(s.bytes)} of ${megabytes(CAP_BYTES)}`;
  } catch (err) {
    $("model").textContent = `Moments could not start: ${String(err)}`;
  }
}

// Anything but { ok: true } is a failure, including no answer at all.
async function forgetAll(): Promise<string | null> {
  try {
    await wakeEngine();
    const answer = await chrome.runtime.sendMessage({ type: "forget-all" });
    return answer?.ok === true ? null : String(answer?.message ?? "no answer");
  } catch (err) {
    return String(err);
  }
}

const toggle = $<HTMLInputElement>("background");
void readSettings().then((s) => (toggle.checked = s.backgroundReading));
toggle.addEventListener("change", () => void writeSettings({ backgroundReading: toggle.checked }));
$("forget").addEventListener("click", async () => {
  const failure = await forgetAll();
  await render();
  if (failure !== null) $("space").textContent = `Could not forget: ${failure}`;
});
void render();
