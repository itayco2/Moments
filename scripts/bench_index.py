"""Sustained indexing throughput for a few settings, on real footage, in one process.

A single batch hides allocator growth and spill into shared GPU memory, so each setting runs
`--windows` windows back to back and reports windows/s and the memory PyTorch actually reserved.

    uv run python scripts/bench_index.py --video D:/moments/footage/earth-views.mp4
"""

from __future__ import annotations

import argparse
import itertools
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.index import embed, iter_windows  # noqa: E402
from moments.model import load_model  # noqa: E402

SETTINGS = [(8, 140), (4, 140), (8, 70), (4, 70)]  # (batch, vision tokens per frame)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--windows", type=int, default=64)
    args = ap.parse_args()

    wins = list(itertools.islice(iter_windows(args.video, window=8, stride=4), args.windows))
    model = load_model()
    embed(model, wins[:2])  # warm-up
    for batch, tokens in SETTINGS:
        model[0].processor.video_processor.max_soft_tokens = tokens
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        t0 = time.perf_counter()
        for i in range(0, len(wins), batch):
            embed(model, wins[i:i + batch])
        torch.cuda.synchronize()
        dt = time.perf_counter() - t0
        print(f"batch {batch:2d}, {tokens:3d} tokens/frame: {len(wins) / dt:5.2f} windows/s  "
              f"peak alloc {torch.cuda.max_memory_allocated() / 2**30:.2f} GiB, "
              f"reserved {torch.cuda.memory_reserved() / 2**30:.2f} GiB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
