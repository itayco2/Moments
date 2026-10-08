"""Search from the terminal.

    uv run python scripts/search.py --index D:/moments/index/w8s4 "an astronaut floating inside the station"
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.model import load_model  # noqa: E402
from moments.search import Index  # noqa: E402


def clock(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("queries", nargs="+")
    args = ap.parse_args()

    index, model = Index(args.index), load_model()
    for query in args.queries:
        t0 = time.perf_counter()
        hits = index.search(index.embed_query(model, query), args.k)
        print(f"\n{query!r}  ({(time.perf_counter() - t0) * 1000:.0f} ms)")
        for h in hits:
            print(f"  {h.score:.3f}  {h.video:28} {clock(h.start)}-{clock(h.end)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
