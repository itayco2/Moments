"""Gate: prove the model loads on this GPU and matches text to video before anything expensive runs.

Builds two synthetic clips with ffmpeg (solid red, solid blue), embeds them, and checks that the
query "a red screen" lands on the red clip and "a blue screen" on the blue one. Needs no footage.

    uv run python scripts/gate.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import time
from pathlib import Path

import torch
from sentence_transformers import SentenceTransformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.frames import sample_frames  # noqa: E402

MODEL_ID = "google/embeddinggemma-2"
CLIP_SECONDS = 6
COLOURS = ("red", "blue")


def make_clip(colour: str, out_dir: Path) -> Path:
    path = out_dir / f"{colour}.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", f"color=c={colour}:s=640x360:r=24:d={CLIP_SECONDS}",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return path


def check(name: str, ok: bool, detail: str) -> bool:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return ok


def main() -> int:
    if not check("cuda", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available()
                 else "no CUDA device"):
        return 1

    started = time.perf_counter()
    model = SentenceTransformer(MODEL_ID, device="cuda", model_kwargs={"torch_dtype": torch.bfloat16})
    load_s = time.perf_counter() - started
    check("load", True, f"{load_s:.1f} s, {torch.cuda.memory_allocated() / 2**30:.2f} GiB on GPU")

    queries = [f"a {c} screen" for c in COLOURS]
    with tempfile.TemporaryDirectory() as tmp:
        clips = [make_clip(c, Path(tmp)) for c in COLOURS]
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        clip_emb = model.encode([{"video": sample_frames(p)} for p in clips], convert_to_tensor=True)
        encode_s = time.perf_counter() - started
    query_emb = model.encode_query(queries, convert_to_tensor=True)

    peak = torch.cuda.max_memory_allocated() / 2**30
    check("encode video", True, f"{len(clips)} x {CLIP_SECONDS} s clips in {encode_s:.2f} s, "
          f"peak {peak:.2f} GiB, dim {clip_emb.shape[1]}")

    sims = model.similarity(query_emb, clip_emb).float().cpu()
    for q, row in zip(queries, sims, strict=True):
        cells = "  ".join(f"{c}={s:+.3f}" for c, s in zip(COLOURS, row.tolist(), strict=True))
        print(f"       {q!r:18} {cells}")
    matched = all(int(sims[i].argmax()) == i for i in range(len(COLOURS)))
    margin = min(float(sims[i, i] - sims[i, 1 - i]) for i in range(len(COLOURS)))
    ok = check("text finds video", matched, f"each query picks its own clip, smallest margin {margin:+.3f}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
