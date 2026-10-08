"""Search an index: embed the query, score every window, and return the best non-overlapping moments."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

# Windows within this many seconds of a kept moment belong to it; adjacent windows of one shot
# otherwise fill the whole list with the same scene.
MERGE_GAP_S = 4.0


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

    def embed_query(self, model: SentenceTransformer, query: str) -> np.ndarray:
        return model.encode_query(query, convert_to_numpy=True, normalize_embeddings=True).astype(np.float32)

    def search(self, query_vec: np.ndarray, k: int = 5) -> list[Hit]:
        scores = self.vectors @ query_vec
        hits: list[Hit] = []
        spans: list[list] = []  # [video, lo, hi] per hit, grown as the shot's other windows are absorbed
        for i in np.argsort(-scores):
            row = self.rows[i]
            near = next((s for s in spans if s[0] == row["video"] and row["start"] < s[2] + MERGE_GAP_S
                         and s[1] < row["end"] + MERGE_GAP_S), None)
            if near is not None:
                near[1], near[2] = min(near[1], row["start"]), max(near[2], row["end"])
                continue
            hits.append(Hit(row["video"], row["start"], row["end"], float(scores[i]), row["thumb"]))
            spans.append([row["video"], row["start"], row["end"]])
            if len(hits) == k:
                break
        return hits
