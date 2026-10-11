// Set from the acceptance measurement (Task 11, EVAL.md): on only if playback stutter rises less than 1 point.
// It rose 2.5 points (1.9 in a repeat) while a second tab was read, so it is off.
export const DEFAULT_BACKGROUND_READING = false;

export interface Settings {
  backgroundReading: boolean;
}

export async function readSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get({ backgroundReading: DEFAULT_BACKGROUND_READING });
  return { backgroundReading: s.backgroundReading === true };
}

export async function writeSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set(s);
}
