"""Compare browser (transformers.js) picture embeddings with Python's on the same frames.

Reports cosine similarity per frame, and whether each frame's nearest neighbours among the other frames
stay the same, which is what search actually depends on.

    uv run python scripts/compare_parity.py --frames D:/moments/parity/frames \
        --js js-q4-t70.json --python python-t70.npy
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def unit(m: np.ndarray) -> np.ndarray:
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=Path, required=True)
    ap.add_argument("--js", required=True)
    ap.add_argument("--python", required=True)
    args = ap.parse_args()

    js = json.loads((args.frames / args.js).read_text(encoding="utf-8"))
    names = json.loads((args.frames / "names.json").read_text(encoding="utf-8"))
    if js["names"] != names:
        raise SystemExit("the browser run used a different frame list")
    a = unit(np.asarray(js["vectors"], dtype=np.float32))
    b = unit(np.load(args.frames / args.python))
    cos = np.sum(a * b, axis=1)
    print(f"{args.js} vs {args.python}: {len(names)} frames, cosine min {cos.min():.4f}, "
          f"mean {cos.mean():.4f}, 5th percentile {np.percentile(cos, 5):.4f}")

    # Nearest other frame by each side's own vectors: does the browser agree with Python on what looks alike?
    sa, sb = a @ a.T, b @ b.T
    np.fill_diagonal(sa, -1)
    np.fill_diagonal(sb, -1)
    same_nn = float(np.mean(sa.argmax(1) == sb.argmax(1)))
    print(f"same nearest neighbour for {same_nn:.1%} of frames")
    return 0


if __name__ == "__main__":
    sys.exit(main())
