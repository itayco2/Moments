// Wakes the engine (one offscreen document for the whole browser) and passes nothing else. Stateless.
import { ReadyGate } from "./ready-gate";

const ENGINE_URL = "offscreen.html";
const READY_TIMEOUT_MS = 10_000;
let creating: Promise<void> | null = null;
// The engine page announces itself as the last thing it does. A document that exists is not yet one that listens:
// Chrome can refuse a message or port sent before the page has finished evaluating its module.
const engineReady = new ReadyGate(READY_TIMEOUT_MS, "the engine page");

async function engineExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function createEngine(): Promise<void> {
  engineReady.reset();
  await chrome.offscreen.createDocument({
    url: ENGINE_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Runs the Moments search model once for all YouTube tabs.",
  });
  await engineReady.wait();
}

export async function ensureEngine(): Promise<void> {
  // A document that is being created already counts as existing, so a caller must wait for the creation as well,
  // also when the creation started while it was still looking.
  if (creating) return creating;
  const exists = await engineExists();
  if (creating) return creating;
  if (exists) return;
  creating = createEngine().finally(() => (creating = null));
  await creating;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "engine:ready") {
    // Only the engine page itself can announce readiness.
    if (sender.id === chrome.runtime.id && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(ENGINE_URL))) engineReady.announce();
    return false;
  }
  if (message?.type !== "engine:ensure") return false;
  ensureEngine().then(
    () => reply({ ok: true }),
    (err: unknown) => reply({ ok: false, message: String(err) }),
  );
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "focus-search") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined && tab.url?.startsWith("https://www.youtube.com/watch")) {
    await chrome.tabs.sendMessage(tab.id, { type: "focus" }).catch((err: unknown) => console.warn("Moments: focus not delivered", err));
  }
});

// Free the model's memory after 10 minutes without a YouTube video tab (two checks 5 minutes apart).
const IDLE_ALARM = "idle-check";
const IDLE_CHECK_MINUTES = 5;
const IDLE_CHECKS_BEFORE_UNLOAD = 2;
const startIdleCheck = () => void chrome.alarms.create(IDLE_ALARM, { periodInMinutes: IDLE_CHECK_MINUTES });
chrome.runtime.onInstalled.addListener(startIdleCheck);
chrome.runtime.onStartup.addListener(startIdleCheck);
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== IDLE_ALARM) return;
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/watch*" });
  const { idleChecks = 0 } = await chrome.storage.session.get("idleChecks");
  const next = tabs.length ? 0 : (idleChecks as number) + 1;
  await chrome.storage.session.set({ idleChecks: next });
  if (next >= IDLE_CHECKS_BEFORE_UNLOAD && (await engineExists())) await chrome.offscreen.closeDocument();
});
