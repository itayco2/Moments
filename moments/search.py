"""Search an index: embed the query, score every window, and return the best non-overlapping moments."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

# A moment is a run of consecutive matching windows: neighbours closer than this gap join one run, so a long
# shot shows up once (PF06, PF10). It suits both 8 s windows every 4 s and single frames every 4 s.
MERGE_GAP_S = 4.0
# Runs are built from the best-scoring windows only; a shot's frames rank close together, so 400 is plenty.
CANDIDATE_POOL = 400


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
        pool = np.argsort(-scores)[: max(CANDIDATE_POOL, k)]
        # Walk the candidates in time order and cut a new run wherever the gap to the previous one is too big.
        runs: list[list[int]] = []
        run_end = 0.0
        for i in sorted(pool.tolist(), key=lambda j: (self.rows[j]["video"], self.rows[j]["start"])):
            row = self.rows[i]
            same_video = bool(runs) and self.rows[runs[-1][-1]]["video"] == row["video"]
            if same_video and row["start"] - run_end <= MERGE_GAP_S:
                runs[-1].append(i)
                run_end = max(run_end, row["end"])
            else:
                runs.append([i])
                run_end = row["end"]
        best = sorted((max(run, key=lambda j: scores[j]) for run in runs), key=lambda j: -scores[j])
        return [Hit(self.rows[i]["video"], self.rows[i]["start"], self.rows[i]["end"], float(scores[i]),
                    self.rows[i]["thumb"]) for i in best[:k]]
