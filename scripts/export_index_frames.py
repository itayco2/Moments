"""Save every frame an index was built from (360p JPEG, named by row), for rebuilding it in the browser stack.

    uv run python scripts/export_index_frames.py --index D:/moments/index/img-s4-t70 \
        --footage D:/moments/footage --out D:/moments/parity/index-frames
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.frames import iter_frames  # noqa: E402

TIME_MATCH_S = 0.6


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--footage", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    rows = json.loads((args.index / "windows.json").read_text(encoding="utf-8"))["rows"]
    wanted: dict[str, list[tuple[float, int]]] = defaultdict(list)
    for i, r in enumerate(rows):
        wanted[r["video"]].append((r["start"], i))

    saved = 0
    for video, items in wanted.items():
        items.sort()
        k = 0
        for t, frame in iter_frames(args.footage / video, fps=1.0):
            while k < len(items) and items[k][0] < t - TIME_MATCH_S:
                k += 1  # a frame the decoder skipped; it stays missing and is reported below
            if k < len(items) and abs(items[k][0] - t) <= TIME_MATCH_S:
                Image.fromarray(frame).save(args.out / f"{items[k][1]:05d}.jpg", quality=95)
                saved += 1
                k += 1
        print(f"{video}: done", flush=True)
    (args.out / "count.json").write_text(json.dumps({"rows": len(rows), "saved": saved}), encoding="utf-8")
    print(f"saved {saved} of {len(rows)} frames -> {args.out}")
    return 0 if saved == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
