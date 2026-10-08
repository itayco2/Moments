"""Save sample frames and their Python picture embeddings, so the browser's picture model can be compared.

Frames are taken evenly across every video at 360p (what the browser tool decodes) and saved as PNG, so
both sides see identical pixels. Run web/scripts/embed-images.mjs on the folder afterwards.

    uv run python scripts/export_parity_frames.py --footage D:/moments/footage --out D:/moments/parity/frames
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moments.frames import duration_seconds, iter_frames  # noqa: E402
from moments.model import load_model  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--footage", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--per-video", type=int, default=17)
    ap.add_argument("--tokens", type=int, nargs="+", default=[70, 280])
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    names: list[str] = []
    images: list[Image.Image] = []
    for video in sorted(args.footage.glob("*.mp4")):
        length = duration_seconds(video)
        for t in np.linspace(5, length - 5, args.per_video):
            _, frame = next(iter_frames(video, start=float(t), end=float(t) + 2))
            name = f"{video.stem}_{int(t):05d}.png"
            Image.fromarray(frame).save(args.out / name)
            names.append(name)
            images.append(Image.fromarray(frame))
    model = load_model()
    for tokens in args.tokens:
        model[0].processor.image_processor.max_soft_tokens = tokens
        vecs = model.encode([{"image": im} for im in images], convert_to_numpy=True, normalize_embeddings=True,
                            batch_size=8)
        np.save(args.out / f"python-t{tokens}.npy", vecs.astype(np.float32))
    (args.out / "names.json").write_text(json.dumps(names), encoding="utf-8")
    print(f"{len(names)} frames -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
