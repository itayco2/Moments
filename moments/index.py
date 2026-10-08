"""Cut each video into overlapping windows, embed every window, and save vectors plus thumbnails.

A window is `window` seconds of video sampled at 1 frame per second; windows start every `stride`
seconds, so with window=8 and stride=4 every moment is covered by two windows.
"""

from __future__ import annotations

import json
import queue
import threading
import time
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

from moments.frames import iter_frames

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

THUMB_WIDTH = 320
LOG_EVERY_BATCHES = 25
PREFETCH_BATCHES = 2
# Batch 8 at 140 tokens peaks at 3.6 GiB; with less free than this, Windows spills into system memory
# and indexing runs several times slower instead of failing (PREFLIGHT PF04, PF09).
MIN_FREE_GPU_GIB = 4.0


@dataclass(frozen=True)
class Window:
    video: str
    start: float
    end: float
    frames: np.ndarray


def iter_windows(path: Path, window: int, stride: int) -> Iterator[Window]:
    buffer: deque[tuple[float, np.ndarray]] = deque(maxlen=window)
    next_start = 0.0
    last_t = -1.0
    for t, frame in iter_frames(path):
        buffer.append((t, frame))
        last_t = t
        if len(buffer) == window and buffer[0][0] + 1e-6 >= next_start:
            yield Window(path.name, buffer[0][0], t + 1.0, np.stack([f for _, f in buffer]))
            next_start = buffer[0][0] + stride
    # The tail shorter than a full window still deserves a vector, or the last seconds are unsearchable.
    tail = [(t, f) for t, f in buffer if t + 1e-6 >= next_start]
    if tail and len(tail) >= 2:
        yield Window(path.name, tail[0][0], last_t + 1.0, np.stack([f for _, f in tail]))


def save_thumb(win: Window, thumbs: Path) -> str:
    mid = Image.fromarray(win.frames[len(win.frames) // 2])
    mid.thumbnail((THUMB_WIDTH, THUMB_WIDTH))
    name = f"{Path(win.video).stem}_{int(win.start):06d}.jpg"
    mid.save(thumbs / name, quality=80)
    return name


def embed(model: SentenceTransformer, batch: list[Window], as_image: bool = False) -> np.ndarray:
    # as_image embeds a window's middle frame as a picture, which is what the browser tool does.
    inputs = ([{"image": Image.fromarray(w.frames[len(w.frames) // 2])} for w in batch] if as_image
              else [{"video": w.frames} for w in batch])
    vectors = model.encode(inputs, convert_to_numpy=True, normalize_embeddings=True, batch_size=len(batch))
    return vectors.astype(np.float32)


def iter_batches(videos: list[Path], window: int, stride: int, batch_size: int,
                 thumbs: Path) -> Iterator[list[tuple[Window, str]]]:
    batch: list[tuple[Window, str]] = []
    for path in videos:
        for win in iter_windows(path, window, stride):
            batch.append((win, save_thumb(win, thumbs)))
            if len(batch) == batch_size:
                yield batch
                batch = []
    if batch:
        yield batch


def prefetch(source: Iterator, depth: int) -> Iterator:
    """Run `source` on a thread so decoding the next batch overlaps the GPU working on this one."""
    box: queue.Queue = queue.Queue(maxsize=depth)
    done = object()

    def produce() -> None:
        try:
            for item in source:
                box.put(item)
        except BaseException as exc:  # handed to the consumer, which re-raises it
            box.put(exc)
        box.put(done)

    threading.Thread(target=produce, daemon=True).start()
    while (item := box.get()) is not done:
        if isinstance(item, BaseException):
            raise item
        yield item


def build(model: SentenceTransformer, videos: list[Path], out: Path, window: int, stride: int,
          batch_size: int, tokens_per_frame: int | None = None, as_image: bool = False) -> dict:
    import torch  # deferred: keeps the fast test tier free of a multi-second torch import

    processor = model[0].processor.image_processor if as_image else model[0].processor.video_processor
    if tokens_per_frame is not None:
        processor.max_soft_tokens = tokens_per_frame
    if torch.cuda.is_available():
        free = torch.cuda.mem_get_info()[0] / 2**30
        print(f"   GPU memory free after loading the model: {free:.2f} GiB", flush=True)
        if free < MIN_FREE_GPU_GIB:
            print(f"   WARNING: under {MIN_FREE_GPU_GIB} GiB free. Another process (the search server?) "
                  "holds GPU memory; expect a large slowdown. Stop it and restart indexing.", flush=True)
    thumbs = out / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    vectors, rows = [], []
    started = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    for n, batch in enumerate(prefetch(iter_batches(videos, window, stride, batch_size, thumbs),
                                       PREFETCH_BATCHES), start=1):
        vectors.append(embed(model, [w for w, _ in batch], as_image))
        rows.extend({"video": w.video, "start": w.start, "end": w.end, "thumb": t} for w, t in batch)
        if n % LOG_EVERY_BATCHES == 0:
            rate = len(rows) / (time.perf_counter() - started)
            reserved = torch.cuda.memory_reserved() / 2**30 if torch.cuda.is_available() else 0.0
            print(f"   {len(rows)} windows, {rate:.2f}/s, now in {rows[-1]['video']} at "
                  f"{rows[-1]['start'] / 60:.1f} min, reserved {reserved:.2f} GiB", flush=True)
    matrix = np.concatenate(vectors)
    np.save(out / "vectors.npy", matrix)
    peak = torch.cuda.max_memory_allocated() / 2**30 if torch.cuda.is_available() else None
    wall = time.perf_counter() - started
    stats = {
        "window_s": window, "stride_s": stride, "windows": len(rows), "dim": int(matrix.shape[1]),
        "tokens_per_frame": processor.max_soft_tokens, "as_image": as_image,
        "seconds_indexed": round(sum(max(r["end"] for r in rows if r["video"] == p.name) for p in videos)),
        "index_wall_s": round(wall, 1), "windows_per_s": round(len(rows) / wall, 2),
        "peak_gpu_gib": round(peak, 2) if peak is not None else None,
    }
    (out / "windows.json").write_text(json.dumps({"stats": stats, "rows": rows}, indent=1), encoding="utf-8")
    return stats
