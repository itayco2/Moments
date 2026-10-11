// One mark per match on YouTube's own progress bar; the current match is white and taller.
import type { Hit } from "../protocol";

const LAYER = "moments-marks";

export function clearMarks(): void {
  document.querySelectorAll(`.ytp-progress-bar > .${LAYER}`).forEach((el) => el.remove());
}

export function drawMarks(hits: Hit[], current: number, duration: number): void {
  const bar = document.querySelector<HTMLElement>(".ytp-progress-bar");
  if (!bar || !(duration > 0)) return;
  let layer = bar.querySelector<HTMLElement>(`:scope > .${LAYER}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = LAYER;
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:40";
    bar.append(layer);
  }
  layer.replaceChildren(
    ...hits.map((hit, i) => {
      const on = i === current;
      const mark = document.createElement("div");
      const w = on ? 6 : 4;
      const h = on ? 14 : 10;
      const left = Math.min(100, Math.max(0, (hit.start / duration) * 100));
      mark.style.cssText = `position:absolute;top:50%;left:${left}%;width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;border-radius:2px;background:${on ? "#ffffff" : "#9d92fa"};box-shadow:0 0 0 1px rgba(0,0,0,0.45)`;
      return mark;
    }),
  );
}
