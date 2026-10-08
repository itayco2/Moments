"""Score an index against the pre-registered queries in eval/queries.json.

A result counts as correct when its window overlaps any labelled range for that query (with a small
tolerance, since labels were written from frames 12 s apart). Reports hit@1, hit@5 and MRR@10, overall
and per query, optionally at shorter Matryoshka sizes (the first N dimensions, renormalized).

    uv run python scripts/evaluate.py --index D:/moments/index/w8s4-t140 --dims 768 256 128
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.model import load_model  # noqa: E402
from moments.search import Index  # noqa: E402

QUERIES = Path(__file__).resolve().parents[1] / "eval" / "queries.json"
# A hit is correct when its centre lies within a labelled range widened by this much. For an 8 s window
# that is exactly "the window overlaps the range with 2 s to spare"; stated by centre it also scores
# a 1-frame index by the same standard instead of a stricter one.
CENTRE_TOLERANCE_S = 6.0
DEPTH = 10


def is_relevant(hit, labels: list[dict]) -> bool:
    centre = (hit.start + hit.end) / 2
    return any(hit.video == lab["video"] and lab["start"] - CENTRE_TOLERANCE_S < centre
               < lab["end"] + CENTRE_TOLERANCE_S for lab in labels)


def truncated(index: Index, dims: int) -> Index:
    view = object.__new__(Index)
    view.__dict__.update(index.__dict__)
    cut = index.vectors[:, :dims]
    view.vectors = cut / np.linalg.norm(cut, axis=1, keepdims=True)
    return view


def cut(vec: np.ndarray, dims: int) -> np.ndarray:
    return vec[:dims] / np.linalg.norm(vec[:dims])


def metrics(rows: list[dict]) -> dict:
    n = len(rows)
    return {
        "n": n,
        "hit@1": round(sum(r["rank"] == 1 for r in rows) / n, 3),
        "hit@5": round(sum(r["rank"] is not None and r["rank"] <= 5 for r in rows) / n, 3),
        "mrr@10": round(sum(1 / r["rank"] for r in rows if r["rank"]) / n, 3),
    }


def score(index: Index, qvecs: np.ndarray, queries: list[dict]) -> tuple[dict, list[dict]]:
    dims = index.vectors.shape[1]
    per_query = []
    for q, vec in zip(queries, qvecs, strict=True):
        hits = index.search(cut(vec, dims), DEPTH)
        rank = next((i + 1 for i, h in enumerate(hits) if is_relevant(h, q["relevant"])), None)
        per_query.append({"id": q["id"], "kind": q["kind"], "query": q["query"], "rank": rank,
                          "top_score": round(hits[0].score, 4),
                          "top": f"{hits[0].video}@{int(hits[0].start)}s" if hits else "-"})
    summary = {"all": metrics(per_query)}
    for kind in sorted({r["kind"] for r in per_query}):
        summary[kind] = metrics([r for r in per_query if r["kind"] == kind])
    return summary, per_query


def negative_scores(index: Index, nvecs: np.ndarray) -> list[float]:
    dims = index.vectors.shape[1]
    return [round(index.search(cut(v, dims), 1)[0].score, 4) for v in nvecs]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--dims", type=int, nargs="*", default=[768])
    ap.add_argument("--show", action="store_true", help="print every query's rank")
    args = ap.parse_args()

    spec = json.loads(QUERIES.read_text(encoding="utf-8"))
    queries, negatives = spec["queries"], spec["negatives"]
    index, model = Index(args.index), load_model()

    def encode(texts: list[str]) -> np.ndarray:
        return model.encode_query(texts, convert_to_numpy=True, normalize_embeddings=True).astype(np.float32)

    qvecs, nvecs = encode([q["query"] for q in queries]), encode(negatives)
    report = {"index": args.index.name, "stats": index.stats, "by_dims": {}}
    for dims in args.dims:
        view = truncated(index, dims)
        summary, per_query = score(view, qvecs, queries)
        neg = negative_scores(view, nvecs)
        pos_top1 = sorted(r["top_score"] for r in per_query if r["rank"] == 1)
        report["by_dims"][dims] = {"summary": summary, "negative_top_scores": neg,
                                   "correct_top1_scores": pos_top1, "per_query": per_query}
        for name, m in summary.items():
            print(f"{args.index.name} @ {dims:3d} dims  {name:6} n={m['n']:2d}  hit@1 {m['hit@1']:.2f}  "
                  f"hit@5 {m['hit@5']:.2f}  MRR@10 {m['mrr@10']:.3f}")
        if pos_top1:
            print(f"   correct #1 scores {pos_top1[0]:.3f}..{pos_top1[-1]:.3f} "
                  f"(median {pos_top1[len(pos_top1) // 2]:.3f}); negatives' best wrong match {neg}")
        if args.show and dims == args.dims[0]:
            for r in per_query:
                print(f"   {r['id']} {r['kind']:6} rank {r['rank'] or '>10':>3}  {r['top_score']:.3f}  "
                      f"top {r['top']:32} {r['query']}")
    (args.index / "eval.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
