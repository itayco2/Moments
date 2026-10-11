// Replaced by the full engine in Task 7.
import { Embedder } from "../../../web/src/embedder";

type Phase = "idle" | "loading" | "ready" | "error";
let embedder: Embedder | null = null;
let phase: Phase = "idle";
let message = "";
let loading: Promise<void> | null = null;

function ensureModel(): Promise<void> {
  loading ??= (async () => {
    embedder ??= new Embedder();
    phase = "loading";
    await embedder.load(true);
    phase = "ready";
  })().catch((err: unknown) => {
    phase = "error";
    message = String(err);
    loading = null;
  });
  return loading;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "stats") return false;
  const answer = () => reply({ phase, device: embedder?.device ?? null, message, videos: 0, bytes: 0 });
  if (msg.load) void ensureModel().then(answer);
  else answer();
  return true;
});
