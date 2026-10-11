// YouTube's preview frames ("storyboards"): the player response holds a spec string describing sprite sheets of
// small frames taken at a fixed interval. Pure functions: spec text in; sheet URLs, frame times and crop boxes out.

export interface Level {
  index: number;
  width: number;
  height: number;
  count: number;
  cols: number;
  rows: number;
  intervalMs: number;
  name: string;
  sigh: string;
}

export interface Storyboard {
  videoId: string;
  base: string;
  levels: Level[];
}

export interface Tile {
  t: number;
  sheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const BASE = /^https:\/\/i\.ytimg\.com\/sb\/([A-Za-z0-9_-]{11})\/storyboard3_L\$L\/\$N\.jpg\?/;
const MIN_WIDTH = 160; // smaller previews (48x27, 80x45) carry too little to search
// A level name and signature go into sheet URLs: letters, digits, _, $ and - only, as in every spec seen.
const TOKEN = /^[\w$-]+$/;

export function parseSpec(spec: string): Storyboard | null {
  const [base, ...parts] = spec.split("|");
  const match = BASE.exec(base ?? "");
  if (!match || parts.length === 0) return null;
  const levels: Level[] = [];
  for (const [index, part] of parts.entries()) {
    const fields = part.split("#");
    if (fields.length < 8 || !TOKEN.test(fields[6]) || !TOKEN.test(fields[7])) return null;
    const numbers = fields.slice(0, 6).map(Number);
    if (!numbers.every((n) => Number.isInteger(n) && n >= 0)) return null;
    const [width, height, count, cols, rows, intervalMs] = numbers;
    levels.push({ index, width, height, count, cols, rows, intervalMs, name: fields[6], sigh: fields[7] });
  }
  return { videoId: match[1], base, levels };
}

export function bestLevel(sb: Storyboard): Level | null {
  const usable = sb.levels.filter((l) => l.intervalMs > 0 && l.width >= MIN_WIDTH && l.cols > 0 && l.rows > 0);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

export function sheetUrl(sb: Storyboard, level: Level, sheet: number): string {
  // Function replacers: a "$$" or "$&" in the text is inserted as it is, never read as a replacement pattern.
  const name = level.name.replace("$M", () => String(sheet));
  return `${sb.base.replace("$L", () => String(level.index)).replace("$N", () => name)}&sigh=${level.sigh}`;
}

export function tiles(sb: Storyboard, level: Level, duration: number): Tile[] {
  const perSheet = level.cols * level.rows;
  const out: Tile[] = [];
  for (let k = 0; k < level.count; k++) {
    const t = (k * level.intervalMs) / 1000;
    if (t > duration) break;
    const cell = k % perSheet;
    out.push({
      t,
      sheet: sheetUrl(sb, level, Math.floor(k / perSheet)),
      x: (cell % level.cols) * level.width,
      y: Math.floor(cell / level.cols) * level.height,
      width: level.width,
      height: level.height,
    });
  }
  return out;
}
