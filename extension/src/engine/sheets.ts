// Turns preview sheets and full-detail JPEG frames into the ImageData the model reads.
import type { Frame } from "../protocol";
import type { Tile } from "../storyboard";

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
