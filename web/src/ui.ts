// DOM helpers: building result cards and small widgets. No state lives here.

import { clock } from "./format";
import type { VideoInfo } from "./library";
import type { Hit } from "./search";

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setBar(bar: HTMLElement, fraction: number): void {
  const fill = bar.querySelector("i");
  if (fill) fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export function renderHits(
  box: HTMLElement,
  hits: Hit[],
  videos: Record<string, VideoInfo>,
  onPick: (hit: Hit, row: HTMLElement) => void,
): HTMLElement[] {
  box.replaceChildren();
  if (!hits.length) {
    box.append(el("p", "empty", "Nothing found."));
    return [];
  }
  const best = hits[0].score;
  const worst = hits[hits.length - 1].score;
  return hits.map((hit) => {
    const row = el("div", "hit");
    const img = el("img");
    img.src = hit.thumb;
    img.alt = "";
    img.loading = "lazy";
    const info = el("div");
    const name = videos[hit.video]?.display ?? hit.video;
    // A single frame has no meaningful end; an 8 s window does.
    const when = hit.end - hit.start <= 1.5 ? `at ${clock(hit.start)}` : `${clock(hit.start)} to ${clock(hit.end)}`;
    info.append(el("div", "name", name), el("div", "at mono", when));
    const bar = el("div", "bar");
    bar.append(el("i"));
    setBar(bar, 0.4 + (0.6 * (hit.score - worst)) / Math.max(best - worst, 1e-6));
    info.append(bar);
    row.append(img, info);
    row.addEventListener("click", () => onPick(hit, row));
    box.append(row);
    return row;
  });
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
