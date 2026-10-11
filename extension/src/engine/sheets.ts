// Turns preview sheets and full-detail JPEG frames into the ImageData the model reads.
import type { Frame } from "../protocol";
import { type Level, type Storyboard, type Tile, tiles } from "../storyboard";

// Limits on what a preview spec may ask the engine to download and embed. The spec comes through a content script
// from a web page, so it is checked here as well.
export const MAX_PREVIEW_FRAMES = 20_000;
const MAX_TILE_WIDTH = 640;
const MAX_TILE_HEIGHT = 360;
const MIN_PREVIEW_FRAMES = 2; // one frame (or none) is not a preview: it would be saved and then find nothing

// How many frames tiles() would list, worked out from the numbers alone so a spec that promises billions of
// frames is refused before the list is built.
export function plannedFrames(level: Level, duration: number): number {
  return Math.min(level.count, Math.floor((duration * 1000) / level.intervalMs) + 1);
}

export function usableTiles(list: Tile[]): Tile[] | null {
  if (list.length < MIN_PREVIEW_FRAMES || list.length > MAX_PREVIEW_FRAMES) return null;
  const sane = list.every((t) => t.width > 0 && t.height > 0 && t.width <= MAX_TILE_WIDTH && t.height <= MAX_TILE_HEIGHT);
  return sane ? list : null;
}

export function previewTiles(sb: Storyboard, level: Level, duration: number): Tile[] | null {
  if (plannedFrames(level, duration) > MAX_PREVIEW_FRAMES) return null;
  return usableTiles(tiles(sb, level, duration));
}

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`preview sheet answered HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

function pixels(source: CanvasImageSource, sx: number, sy: number, w: number, h: number): ImageData {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas in the engine page");
  ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Sheets come in order; each is downloaded once and cut into its tiles.
export async function* readSheets(list: Tile[], batchSize: number): AsyncGenerator<{ times: number[]; images: ImageData[] }> {
  let current = "";
  let bitmap: ImageBitmap | null = null;
  let batch = { times: [] as number[], images: [] as ImageData[] };
  try {
    for (const tile of list) {
      if (tile.sheet !== current) {
        bitmap?.close();
        bitmap = await fetchBitmap(tile.sheet);
        current = tile.sheet;
      }
      batch.times.push(tile.t);
      batch.images.push(pixels(bitmap as ImageBitmap, tile.x, tile.y, tile.width, tile.height));
      if (batch.images.length === batchSize) {
        yield batch;
        batch = { times: [], images: [] };
      }
    }
    if (batch.images.length) yield batch;
  } finally {
    bitmap?.close();
  }
}

export async function decodeFrames(frames: Frame[]): Promise<ImageData[]> {
  return Promise.all(
    frames.map(async (f) => {
      const bitmap = await createImageBitmap(await (await fetch(f.jpeg)).blob());
      try {
        return pixels(bitmap, 0, 0, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }),
  );
}
