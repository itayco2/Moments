"""Index every .mp4 in a folder.

    uv run python scripts/build_index.py --footage D:/moments/footage --out D:/moments/index/w8s4
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.index import build  # noqa: E402
from moments.model import load_model  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--footage", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--window", type=int, default=8, help="seconds (= frames at 1 fps) per window")
    ap.add_argument("--stride", type=int, default=4, help="seconds between window starts")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--tokens", type=int, choices=(70, 140, 280), default=70,
                    help="vision tokens per frame; 70 matched 140 on the eval at 1.5x the speed (PF08)")
    ap.add_argument("--as-image", action="store_true",
                    help="embed each window's middle frame as a picture, as the browser tool does")
    ap.add_argument("--only", nargs="*", help="index only these file names")
    args = ap.parse_args()

    videos = sorted(p for p in args.footage.glob("*.mp4") if not args.only or p.name in args.only)
    if not videos:
        print(f"no .mp4 files in {args.footage}")
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    stats = build(load_model(), videos, args.out, args.window, args.stride, args.batch, args.tokens,
                  args.as_image)
    print(json.dumps(stats, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
