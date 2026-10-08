"""Decode video into evenly spaced RGB frames with PyAV (bundles its own FFmpeg, so no system DLLs)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import av
import numpy as np

# The model resizes each frame to ~70 vision tokens (about 530x300 for 16:9), so 360p loses nothing.
DECODE_SHORT_SIDE = 360


def iter_frames(path: str | Path, fps: float = 1.0, size: int | None = DECODE_SHORT_SIDE,
                start: float = 0.0, end: float | None = None) -> Iterator[tuple[float, np.ndarray]]:
    """Yield (timestamp_seconds, HxWx3 uint8 frame), one every 1/fps seconds within [start, end)."""
    step = 1.0 / fps
    wanted = start
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        if start > 0:
            container.seek(int(start / stream.time_base), stream=stream, backward=True)
        for frame in container.decode(stream):
            if frame.time is None or frame.time + 1e-6 < wanted:
                continue
            if end is not None and frame.time >= end:
                break
            if size is not None:
                scale = size / min(frame.width, frame.height)
                frame = frame.reformat(width=round(frame.width * scale / 2) * 2,
                                       height=round(frame.height * scale / 2) * 2)
            yield frame.time, frame.to_ndarray(format="rgb24")
            wanted += step


def sample_frames(path: str | Path, fps: float = 1.0, start: float = 0.0, end: float | None = None,
                  size: int | None = DECODE_SHORT_SIDE) -> np.ndarray:
    """All frames of iter_frames stacked into a (T, H, W, 3) array. For short clips only."""
    frames = [f for _, f in iter_frames(path, fps=fps, size=size, start=start, end=end)]
    if not frames:
        raise ValueError(f"no frames decoded from {path} in [{start}, {end})")
    return np.stack(frames)


def duration_seconds(path: str | Path) -> float:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        if stream.duration is not None:
            return float(stream.duration * stream.time_base)
        return float(container.duration / av.time_base)
