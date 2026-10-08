"""One place that loads the embedding model, so every script uses the same dtype and device."""

from __future__ import annotations

import torch
from sentence_transformers import SentenceTransformer

MODEL_ID = "google/embeddinggemma-2"


def load_model(device: str | None = None) -> SentenceTransformer:
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    # The model card warns float16 can silently return NaN or degraded embeddings; bfloat16 is safe.
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    return SentenceTransformer(MODEL_ID, device=device, model_kwargs={"torch_dtype": dtype})
