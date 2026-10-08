"""Make an index folder from vectors computed by the browser stack (web/scripts/embed-frames.mjs).

Rows and thumbnails are taken from the Python index the frames were exported from, so the two indexes
differ only in who computed the vectors.

    uv run python scripts/import_browser_index.py --rows-from D:/moments/index/img-s4-t70 \
        --vectors D:/moments/parity/js-q4-t70.bin --out D:/moments/index/browser-q4-t70
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-from", type=Path, required=True)
    ap.add_argument("--vectors", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    meta = json.loads((args.rows_from / "windows.json").read_text(encoding="utf-8"))
    vectors = np.fromfile(args.vectors, dtype="<f4").reshape(-1, 768)
    if len(vectors) != len(meta["rows"]):
        raise SystemExit(f"{len(vectors)} vectors for {len(meta['rows'])} rows")
    args.out.mkdir(parents=True, exist_ok=True)
    np.save(args.out / "vectors.npy", vectors)
    meta["stats"] = {**meta["stats"], "vectors_from": args.vectors.name}
    (args.out / "windows.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    if not (args.out / "thumbs").exists():
        shutil.copytree(args.rows_from / "thumbs", args.out / "thumbs")
    print(f"{len(vectors)} browser vectors -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
