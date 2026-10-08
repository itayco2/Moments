"""Export an index as the browser demo library (web/public/demo) plus golden results for the web tests.

Writes library.json (videos, compact rows, example queries as fp16 base64), vectors.bin (fp16,
little-endian), thumbs/<row>.webp (240 px), and web/tests/golden.json: the top results Python returns for
each example over the same fp16 vectors the browser will load, so the TypeScript search can be checked.

    uv run python scripts/export_web_demo.py --index D:/moments/index/img-s4-t70 --footage D:/moments/footage
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from moments.frames import duration_seconds  # noqa: E402
from moments.model import load_model  # noqa: E402
from moments.search import Index  # noqa: E402

EXAMPLES = [
    "a rocket lifting off",
    "astronauts on the Moon",
    "a hurricane seen from space",
    "a red and white parachute",
    "a capsule floating in the ocean",
    "a crowd watching a launch",
]
THUMB_WIDTH = 240
GOLDEN_K = 6


def fp16_b64(vec: np.ndarray) -> str:
    return base64.b64encode(vec.astype("<f2").tobytes()).decode("ascii")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--footage", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "demo")
    ap.add_argument("--golden", type=Path, default=ROOT / "web" / "tests" / "golden.json")
    args = ap.parse_args()

    index = Index(args.index)
    entries = json.loads((args.footage / "manifest.json").read_text(encoding="utf-8"))
    manifest = {e["file"]: e for e in entries}
    keys = sorted({r["video"] for r in index.rows})
    videos = [{"key": k, "display": manifest[k]["display"], "src": manifest[k]["url"],
               "duration": round(duration_seconds(args.footage / k), 2)} for k in keys]
    position = {k: i for i, k in enumerate(keys)}
    rows = [[position[r["video"]], round(r["start"], 2), round(r["end"], 2)] for r in index.rows]

    (args.out / "thumbs").mkdir(parents=True, exist_ok=True)
    for i, r in enumerate(index.rows):
        img = Image.open(args.index / "thumbs" / r["thumb"]).convert("RGB")
        img.thumbnail((THUMB_WIDTH, THUMB_WIDTH))
        img.save(args.out / "thumbs" / f"{i}.webp", quality=70)

    half = index.vectors.astype("<f2")
    (args.out / "vectors.bin").write_bytes(half.tobytes())

    model = load_model()
    qvecs = model.encode_query(EXAMPLES, convert_to_numpy=True, normalize_embeddings=True).astype(np.float32)
    library = {
        "name": "NASA demo", "dim": int(index.vectors.shape[1]), "source_index": args.index.name,
        "stats": index.stats, "videos": videos, "rows": rows,
        "examples": [{"query": q, "vector": fp16_b64(v)} for q, v in zip(EXAMPLES, qvecs, strict=True)],
    }
    (args.out / "library.json").write_text(json.dumps(library, separators=(",", ":")), encoding="utf-8")

    # Golden results over exactly what the browser sees: fp16 vectors, fp16 example queries, and times
    # rounded as in library.json (an unrounded 2740.0039 against the page's 2740.0 failed 4 of 6 checks).
    index.vectors = half.astype(np.float32)
    for r in index.rows:
        r["start"], r["end"] = round(r["start"], 2), round(r["end"], 2)
    golden = []
    for q, v in zip(EXAMPLES, qvecs, strict=True):
        hits = index.search(v.astype("<f2").astype(np.float32), GOLDEN_K)
        golden.append({"query": q, "hits": [[h.video, round(h.start, 2)] for h in hits]})
    args.golden.write_text(json.dumps(golden, indent=1), encoding="utf-8")

    size = sum(p.stat().st_size for p in args.out.rglob("*") if p.is_file())
    print(f"{len(rows)} moments from {len(videos)} videos -> {args.out} ({size / 2**20:.1f} MiB)")
    for g in golden:
        print(f"  {g['query']!r}: {g['hits'][0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
