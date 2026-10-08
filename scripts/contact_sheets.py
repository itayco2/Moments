"""Lay the index thumbnails out as labelled grids, for writing the eval queries by eye.

Reads the thumbnails the indexer already saved (the middle frame of each window), so it costs no
second pass of video decoding. Each tile is labelled with that frame's time in the video.

    uv run python scripts/contact_sheets.py --index D:/moments/index/w8s4-t140 --out D:/moments/sheets
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

COLS, ROWS = 6, 8
TILE_W, TILE_H, LABEL_H = 256, 144, 22


def clock(s: float) -> str:
    m, sec = divmod(int(s), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{sec:02d}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--every", type=int, default=3, help="use every Nth window (stride 4 s -> 12 s apart)")
    ap.add_argument("--videos", nargs="*", help="only these video file names")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    by_video: dict[str, list[dict]] = defaultdict(list)
    meta_file = args.index / "windows.json"
    if meta_file.is_file():
        for row in json.loads(meta_file.read_text(encoding="utf-8"))["rows"]:
            by_video[row["video"]].append(row)
    else:  # index still building: rebuild rows from thumbnail names (<stem>_<start>.jpg, 8 s windows)
        for thumb in sorted((args.index / "thumbs").glob("*.jpg")):
            stem, start = thumb.stem.rsplit("_", 1)
            by_video[f"{stem}.mp4"].append({"start": int(start), "end": int(start) + 8, "thumb": thumb.name})
    if args.videos:
        by_video = {v: r for v, r in by_video.items() if v in args.videos}

    for video, rows in by_video.items():
        picked = rows[:: args.every]
        per_sheet = COLS * ROWS
        for page in range(0, len(picked), per_sheet):
            sheet = Image.new("RGB", (COLS * TILE_W, ROWS * (TILE_H + LABEL_H)), "white")
            draw = ImageDraw.Draw(sheet)
            for i, row in enumerate(picked[page:page + per_sheet]):
                img = Image.open(args.index / "thumbs" / row["thumb"])
                img.thumbnail((TILE_W, TILE_H))
                x, y = (i % COLS) * TILE_W, (i // COLS) * (TILE_H + LABEL_H)
                sheet.paste(img, (x, y + LABEL_H))
                mid = row["start"] + (row["end"] - row["start"]) / 2
                draw.text((x + 4, y + 4), clock(mid), fill="black")
            sheet.save(args.out / f"{Path(video).stem}_{page // per_sheet:02d}.jpg", quality=85)
        print(f"{video}: {-(-len(picked) // per_sheet)} sheets", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
