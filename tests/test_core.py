"""Fast checks for the parts that need no model: frame sampling, windowing, and result merging."""

from __future__ import annotations

import json
from pathlib import Path

import av
import numpy as np
import pytest

from moments.frames import duration_seconds, iter_frames
from moments.index import iter_windows, prefetch
from moments.search import Index

SECONDS, FPS = 10, 24


@pytest.fixture(scope="module")
def clip(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("clip") / "ten.mp4"
    with av.open(str(path), "w") as out:
        stream = out.add_stream("libx264", rate=FPS)
        stream.width, stream.height, stream.pix_fmt = 64, 48, "yuv420p"
        for i in range(SECONDS * FPS):
            img = np.full((48, 64, 3), (i * 255) // (SECONDS * FPS), dtype=np.uint8)
            for packet in stream.encode(av.VideoFrame.from_ndarray(img, format="rgb24")):
                out.mux(packet)
        for packet in stream.encode():
            out.mux(packet)
    return path


def test_one_frame_per_second(clip):
    times = [t for t, _ in iter_frames(clip, size=None)]
    assert len(times) == SECONDS
    assert np.allclose(np.diff(times), 1.0, atol=0.05)


def test_decode_resizes_short_side(clip):
    _, frame = next(iter_frames(clip, size=24))
    assert frame.shape == (24, 32, 3)


def test_duration(clip):
    assert duration_seconds(clip) == pytest.approx(SECONDS, abs=0.1)


def test_windows_cover_every_second(clip):
    wins = list(iter_windows(clip, window=4, stride=2))
    assert [round(w.start) for w in wins] == [0, 2, 4, 6, 8]
    assert [len(w.frames) for w in wins] == [4, 4, 4, 4, 2]
    covered = {s for w in wins for s in range(round(w.start), round(w.end))}
    assert covered == set(range(SECONDS))


def test_prefetch_keeps_order():
    assert list(prefetch(iter(range(50)), depth=2)) == list(range(50))


def test_prefetch_reraises_producer_errors():
    def broken():
        yield 1
        raise OSError("disk went away")

    with pytest.raises(OSError, match="disk went away"):
        list(prefetch(broken(), depth=2))


def make_index(folder: Path, rows: list[dict], vectors: np.ndarray) -> Index:
    folder.mkdir(parents=True, exist_ok=True)
    np.save(folder / "vectors.npy", vectors.astype(np.float32))
    (folder / "windows.json").write_text(json.dumps({"stats": {}, "rows": rows}), encoding="utf-8")
    return Index(folder)


def top_starts(folder: Path, rows: list[dict], scores: list[float], k: int) -> list[float]:
    s = np.array(scores)
    index = make_index(folder, rows, np.stack([s, np.sqrt(1 - s**2)], axis=1))
    return [h.start for h in index.search(np.array([1.0, 0.0], dtype=np.float32), k=k)]


def frames(starts, video="a.mp4", length=1):
    return [{"video": video, "start": s, "end": s + length, "thumb": ""} for s in starts]


def test_search_keeps_one_hit_per_moment(tmp_path):
    rows = frames((0, 4, 8, 40), length=8) + frames((0,), video="b.mp4", length=8)
    s = np.array([0.9, 0.95, 0.8, 0.5, 0.7])
    hits = make_index(tmp_path / "idx", rows, np.stack([s, np.sqrt(1 - s**2)], axis=1)).search(
        np.array([1.0, 0.0], dtype=np.float32), k=3)
    assert [(h.video, h.start) for h in hits] == [("a.mp4", 4), ("b.mp4", 0), ("a.mp4", 40)]


def test_search_merges_adjacent_windows_of_one_shot(tmp_path):
    rows = frames((0, 8, 16, 60), length=8)
    assert top_starts(tmp_path / "adj", rows, [0.9, 0.89, 0.88, 0.5], 3) == [0, 60]


def test_search_merges_a_shot_of_frames_visited_out_of_order(tmp_path):
    # The far end of the shot ranks second, before the middle: it must still join the first result (PF10).
    # Like a real library, most frames are unrelated background (the margin is relative to the median).
    starts = (1948, 1952, 1956, 1960, 1964, 1968, 2400)
    rows = frames(starts) + frames(range(0, 80, 4), video="b.mp4")
    scores = [0.90, 0.88, 0.885, 0.875, 0.88, 0.895, 0.5] + [0.3] * 20
    assert top_starts(tmp_path / "run", rows, scores, 3)[:2] == [1948, 2400]


def test_search_finds_several_moments_in_one_continuous_video(tmp_path):
    # Frames every 4 s with no gaps: a match, a dip, another match. Not one moment for the video (PF11).
    starts = list(range(0, 48, 4))
    scores = [0.90, 0.89, 0.70, 0.60, 0.61, 0.62, 0.60, 0.70, 0.86, 0.87, 0.60, 0.59]
    assert top_starts(tmp_path / "one", frames(starts), scores, 2) == [0, 36]


def test_index_rejects_mismatched_files(tmp_path):
    with pytest.raises(ValueError, match="rows but"):
        make_index(tmp_path / "bad", [{"video": "a", "start": 0, "end": 1, "thumb": ""}], np.zeros((2, 2)))
