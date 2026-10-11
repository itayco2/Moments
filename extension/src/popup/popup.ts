// Replaced in Task 10.
const app = document.getElementById("app");
chrome.runtime
  .sendMessage({ type: "engine:ensure" })
  .then(() => chrome.runtime.sendMessage({ type: "stats" }))
  .then((s: { phase: string }) => {
    if (app) app.textContent = `Moments model: ${s.phase}`;
  })
  .catch((err: unknown) => {
    if (app) app.textContent = `Moments could not start: ${String(err)}`;
  });
