"""Search an index: embed the query, score every window, and return the best non-overlapping moments."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

# A moment grows from its best window through time-adjacent neighbours (gap <= MERGE_GAP_S) whose score
# stays within RUN_MARGIN_FRACTION of the way from the peak down to the median score; the moment and
# HIDE_FRAMES of that video's frames on each side are then hidden from later results. Counted in frames: 16 s
# hid half of a 1-minute game clip sampled every second (PF21), and is still what 4 s spacing gets. A long shot shows up once, and one continuous video still
# yields several moments (PF06, PF10, PF11). The margin is relative: a shot's scores drift more for some
# queries. Chosen by scripts/sweep_merge.py on the demo index: first-place accuracy was the same for every
# setting tried; 0.4 with 16 s gave the best top-5 (0.94) and the fewest repeats (9 of 36 example results).
MERGE_GAP_S = 4.0
RUN_MARGIN_FRACTION = 0.4
HIDE_FRAMES = 4
LONE_FRAME_SPACING_S = 4.0  # a video with one window has no spacing of its own


@dataclass(frozen=True)
class Hit:
    video: str
    start: float
    end: float
    score: float
    thumb: str


class Index:
    def __init__(self, folder: Path):
        meta = json.loads((folder / "windows.json").read_text(encoding="utf-8"))
        self.folder = folder
        self.stats = meta["stats"]
        self.rows = meta["rows"]
        self.vectors = np.load(folder / "vectors.npy")
        if len(self.rows) != len(self.vectors):
            raise ValueError(f"{folder}: {len(self.rows)} rows but {len(self.vectors)} vectors")
        self.prev, self.next = neighbours(self.rows)
        self.spacing = frame_spacing(self.rows)

    def embed_query(self, model: SentenceTransformer, query: str) -> np.ndarray:
        return model.encode_query(query, convert_to_numpy=True, normalize_embeddings=True).astype(np.float32)

    def search(self, query_vec: np.ndarray, k: int = 5) -> list[Hit]:
        rows, prev, nxt = self.rows, self.prev, self.next
        scores = self.vectors @ query_vec
        median = float(np.median(scores))
        hidden = np.zeros(len(rows), dtype=bool)
        hits: list[Hit] = []
        for i in np.argsort(-scores).tolist():
            if hidden[i]:
                continue
            row = rows[i]
            hits.append(Hit(row["video"], row["start"], row["end"], float(scores[i]), row["thumb"]))
            if len(hits) == k:
                break
            floor = scores[i] - RUN_MARGIN_FRACTION * (scores[i] - median)
            lo = hi = i
            while prev[lo] >= 0 and adjacent(rows, prev[lo], lo) and scores[prev[lo]] >= floor:
                lo = prev[lo]
            while nxt[hi] >= 0 and adjacent(rows, hi, nxt[hi]) and scores[nxt[hi]] >= floor:
                hi = nxt[hi]
            start, end = rows[lo]["start"], rows[hi]["end"]
            hide = HIDE_FRAMES * self.spacing[row["video"]]
            j = lo
            while j >= 0 and rows[j]["end"] > start - hide:
                hidden[j], j = True, prev[j]
            j = lo
            while j >= 0 and rows[j]["start"] < end + hide:
                hidden[j], j = True, nxt[j]
        return hits


def neighbours(rows: list[dict]) -> tuple[list[int], list[int]]:
    """Previous and next row of the same video in time order (-1 at the ends)."""
    order = sorted(range(len(rows)), key=lambda j: (rows[j]["video"], rows[j]["start"]))
    prev, nxt = [-1] * len(rows), [-1] * len(rows)
    for a, b in zip(order, order[1:], strict=False):
        if rows[a]["video"] == rows[b]["video"]:
            nxt[a], prev[b] = b, a
    return prev, nxt


def frame_spacing(rows: list[dict]) -> dict[str, float]:
    """Each video's median gap between consecutive window starts."""
    starts: dict[str, list[float]] = {}
    for row in rows:
        starts.setdefault(row["video"], []).append(row["start"])
    out = {}
    for video, times in starts.items():
        gaps = np.diff(sorted(times))
        out[video] = float(np.median(gaps)) if len(gaps) else LONE_FRAME_SPACING_S
    return out


def adjacent(rows: list[dict], a: int, b: int) -> bool:
    return rows[b]["start"] - rows[a]["end"] <= MERGE_GAP_S
