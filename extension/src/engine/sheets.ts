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

// A sheet is about 50 KB; one that has not arrived in this long is not coming, and the read queue must move on.
const SHEET_TIMEOUT_MS = 30_000;
// Full-detail frames are 360 px on the short side (about 0.23 MP for 16:9). Anything far larger is not one of ours
// and is refused before it is decoded: a small JPEG can claim a huge picture.
export const MAX_FRAME_PIXELS = 2_000_000;
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(SHEET_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`preview sheet answered HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

// The picture size a JPEG declares in its frame header, or null when the bytes are not a JPEG with one.
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the end, or image data before any frame header
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (i + 9 > b.length) return null;
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

// Why a full-detail frame is refused, or null when it is fine.
export function frameProblem(bytes: Uint8Array): string | null {
  const size = jpegSize(bytes);
  if (!size || size.width === 0 || size.height === 0) return "a frame is not a readable JPEG";
  if (size.width * size.height > MAX_FRAME_PIXELS) return `a frame of ${size.width}x${size.height} is larger than the full-detail read sends`;
  return null;
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
      const blob = await (await fetch(f.jpeg)).blob();
      const problem = frameProblem(new Uint8Array(await blob.arrayBuffer()));
      if (problem) throw new Error(problem);
      const bitmap = await createImageBitmap(blob);
      try {
        if (bitmap.width * bitmap.height > MAX_FRAME_PIXELS) throw new Error("a frame decoded larger than its header said");
        return pixels(bitmap, 0, 0, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }),
  );
}
