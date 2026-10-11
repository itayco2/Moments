// When the engine is closed to free the model's memory: about 10 minutes after the last YouTube video tab went away.
// A service worker cannot keep a timer, so an alarm checks every minute and the engine closes after 10 checks in a
// row found no video tab (9 to 10 minutes after the last one). Pure, so it is tested without Chrome.
export const IDLE_CHECK_MINUTES = 1;
export const IDLE_CHECKS_BEFORE_UNLOAD = 10;

export function idleStep(checks: number, videoTabOpen: boolean): { checks: number; unload: boolean } {
  const next = videoTabOpen ? 0 : checks + 1;
  return { checks: next, unload: next >= IDLE_CHECKS_BEFORE_UNLOAD };
}
