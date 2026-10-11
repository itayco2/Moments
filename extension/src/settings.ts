// Set from the acceptance measurement (Task 11): on only if playback stutter rises less than 1 point.
export const DEFAULT_BACKGROUND_READING = true;

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
