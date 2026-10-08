"""Sweep the moment-merging settings: accuracy on the eval queries against repeated shots in the results.

A "repeat" is a result less than 60 s from a better result in the same video, among the top 6 of the demo's
example searches: what a visitor would read as the same shot twice.

    uv run python scripts/sweep_merge.py --index D:/moments/index/img-s4-t70 \
        --query-vectors D:/moments/parity/queries-q4.json
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import moments.search as S  # noqa: E402
from scripts.evaluate import metrics, score  # noqa: E402

DEMO = ROOT / "web" / "public" / "demo" / "library.json"
REPEAT_S = 60


def example_vectors() -> list[np.ndarray]:
    import base64

    lib = json.loads(DEMO.read_text(encoding="utf-8"))
    decode = base64.b64decode
    return [np.frombuffer(decode(e["vector"]), dtype="<f2").astype(np.float32) for e in lib["examples"]]


def repeats(index: S.Index, vecs: list[np.ndarray]) -> int:
    count = 0
    for v in vecs:
        hits = index.search(v, 6)
        for j, h in enumerate(hits):
            count += any(g.video == h.video and abs(g.start - h.start) < REPEAT_S for g in hits[:j])
    return count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--query-vectors", type=Path, required=True)
    args = ap.parse_args()

    spec = json.loads((ROOT / "eval" / "queries.json").read_text(encoding="utf-8"))
    external = json.loads(args.query_vectors.read_text(encoding="utf-8"))
    qvecs = np.asarray(external["vectors"][: len(spec["queries"])], dtype=np.float32)
    index, examples = S.Index(args.index), example_vectors()
    print("fraction  hide_s  hit@1  hit@5  MRR@10  repeats in 6 examples x top 6")
    for fraction, hide in itertools.product((0.0, 0.1, 0.25, 0.4), (4.0, 8.0, 16.0)):
        S.RUN_MARGIN_FRACTION, S.HIDE_S = fraction, hide
        m = metrics(score(index, qvecs, spec["queries"])[1])
        print(f"  {fraction:4.2f}    {hide:4.0f}   {m['hit@1']:.2f}   {m['hit@5']:.2f}   {m['mrr@10']:.3f}   "
              f"{repeats(index, examples)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
