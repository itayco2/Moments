// Wakes the engine (one offscreen document for the whole browser) and passes nothing else. Stateless.

const ENGINE_URL = "offscreen.html";
let creating: Promise<void> | null = null;

async function engineExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

export async function ensureEngine(): Promise<void> {
  if (await engineExists()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: ENGINE_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the Moments search model once for all YouTube tabs.",
    })
    .finally(() => (creating = null));
  await creating;
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== "engine:ensure") return false;
  ensureEngine().then(
    () => reply({ ok: true }),
    (err: unknown) => reply({ ok: false, message: String(err) }),
  );
  return true;
});
