#!/usr/bin/env python
"""FlavoraLM v0.2 NumPy neural core.

Real trainable neural network implemented with NumPy primitives only
(no torch/tf/jax). Architecture:

    text -> BPETokenizer -> token IDs [B,T]
      -> embedding lookup E[V,d] -> masked mean -> sentence vector [B,d]
      -> Dense(d->h) + ReLU -> Dense(h->h) + ReLU
      -> minimal softmax heads: diet / meal / cuisine / spice / mode
      -> decoder -> validated structured intent (via intentSchema bounds on
         the Node side; service layer validates before responding)

Heads are minimal-first (locked scope): ingredients/allergies/avoidFoods
stay deterministic (extractor + engine hard filter own safety). Calories
stay with the pending-question parser / numeric bounds.

All parameters are np.ndarray; forward uses vectorized ops (x @ W, maximum,
exp/sum/mean). Deterministic inference (argmax, no sampling).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Sequence

import numpy as np

MODEL_NAME = "FlavoraLM-numpy"
MODEL_VERSION = "0.2"
ARCHITECTURE = "embed-mean-mlp-multihead"

# Minimal head label maps (index 0 = none/absent except mode).
DIET_LABELS = ["none", "vegetarian", "non-vegetarian", "vegan"]
MEAL_LABELS = ["none", "breakfast", "lunch", "dinner", "snack"]
CUISINE_LABELS = ["none", "italian", "mexican", "chinese", "indian",
                  "japanese", "thai", "french", "spanish", "greek", "american"]
SPICE_LABELS = ["none", "mild", "medium", "hot"]
MODE_LABELS = ["normal", "food_waste", "budget"]

HEAD_LABELS: Dict[str, List[str]] = {
    "diet": DIET_LABELS,
    "meal": MEAL_LABELS,
    "cuisine": CUISINE_LABELS,
    "spice": SPICE_LABELS,
    "mode": MODE_LABELS,
}


@dataclass
class NumpyConfig:
    vocab_size: int = 558
    pad_id: int = 0
    d_embed: int = 64
    hidden: int = 128
    seed: int = 42
    version: str = MODEL_VERSION

    heads: Dict[str, List[str]] = field(default_factory=lambda: dict(HEAD_LABELS))


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(x, 0.0)


def stable_softmax(logits: np.ndarray) -> np.ndarray:
    m = np.max(logits, axis=-1, keepdims=True)
    e = np.exp(logits - m)
    s = np.sum(e, axis=-1, keepdims=True)
    return e / np.maximum(s, 1e-12)


class FlavoraNeuralCore:
    """NumPy multi-head classifier core. All params are np.ndarray."""

    def __init__(self, config: NumpyConfig | None = None):
        self.config = config or NumpyConfig()
        rng = np.random.default_rng(self.config.seed)
        V, d, h = self.config.vocab_size, self.config.d_embed, self.config.hidden
        # He-style init for ReLU layers; small init for embeddings/heads.
        self.embeddings: np.ndarray = (rng.standard_normal((V, d)).astype(np.float64) * 0.02)
        self.W1: np.ndarray = (rng.standard_normal((d, h)).astype(np.float64) * np.sqrt(2.0 / d))
        self.b1: np.ndarray = np.zeros((h,), dtype=np.float64)
        self.W2: np.ndarray = (rng.standard_normal((h, h)).astype(np.float64) * np.sqrt(2.0 / h))
        self.b2: np.ndarray = np.zeros((h,), dtype=np.float64)
        self.head_W: Dict[str, np.ndarray] = {}
        self.head_b: Dict[str, np.ndarray] = {}
        for name, labels in self.config.heads.items():
            self.head_W[name] = (rng.standard_normal((h, len(labels))).astype(np.float64)
                                 * np.sqrt(1.0 / h))
            self.head_b[name] = np.zeros((len(labels),), dtype=np.float64)
        self._cache: Dict[str, np.ndarray] = {}

    # -- introspection -----------------------------------------------------
    def parameters(self) -> Dict[str, np.ndarray]:
        params: Dict[str, np.ndarray] = {
            "embeddings": self.embeddings, "W1": self.W1, "b1": self.b1,
            "W2": self.W2, "b2": self.b2,
        }
        for name in self.config.heads:
            params[f"head_W/{name}"] = self.head_W[name]
            params[f"head_b/{name}"] = self.head_b[name]
        return params

    def param_count(self) -> int:
        return int(sum(np.prod(p.shape) for p in self.parameters().values()))

    # -- forward -----------------------------------------------------------
    def forward(self, token_ids: np.ndarray, pad_id: int | None = None
                ) -> Dict[str, np.ndarray]:
        """Vectorized forward pass. token_ids: [B,T] int. Returns probs per head."""
        pad = self.config.pad_id if pad_id is None else pad_id
        ids = np.asarray(token_ids, dtype=np.int64)
        if ids.ndim == 1:
            ids = ids[None, :]
        B, T = ids.shape
        V = self.embeddings.shape[0]
        safe = np.clip(ids, 0, V - 1)
        mask = (safe != pad).astype(np.float64)  # [B,T]
        counts = np.maximum(np.sum(mask, axis=1, keepdims=True), 1.0)
        emb = self.embeddings[safe]  # [B,T,d]
        sent = np.sum(emb * mask[:, :, None], axis=1) / counts  # masked mean [B,d]
        h1_pre = sent @ self.W1 + self.b1
        h1 = relu(h1_pre)
        h2_pre = h1 @ self.W2 + self.b2
        h2 = relu(h2_pre)
        out: Dict[str, np.ndarray] = {}
        for name in self.config.heads:
            logits = h2 @ self.head_W[name] + self.head_b[name]
            out[name] = stable_softmax(logits)
        for v in [sent, h1, h2, *out.values()]:
            if not np.all(np.isfinite(v)):
                raise ValueError("non-finite values in forward pass")
        self._cache = {"ids": safe, "mask": mask, "sent": sent,
                       "h1_pre": h1_pre, "h1": h1, "h2_pre": h2_pre, "h2": h2,
                       "probs": np.concatenate([out[k] for k in self.config.heads], axis=1)}
        self._cache.update({f"prob/{k}": v for k, v in out.items()})
        return out

    def predict(self, token_ids: np.ndarray, pad_id: int | None = None
                ) -> Dict[str, List[str]]:
        probs = self.forward(token_ids, pad_id)
        return {name: [self.config.heads[name][int(i)] for i in np.argmax(p, axis=1)]
                for name, p in probs.items()}

    def confidence(self, token_ids: np.ndarray, pad_id: int | None = None) -> np.ndarray:
        """Mean head max-probability per example. Derived from outputs, never constant."""
        probs = self.forward(token_ids, pad_id)
        stacked = np.stack([np.max(p, axis=1) for p in probs.values()], axis=1)
        return np.mean(stacked, axis=1)

    # -- serialization -----------------------------------------------------
    def save_npz(self, path) -> None:
        from pathlib import Path
        path = Path(path)
        arrays: Dict[str, np.ndarray] = {k.replace("/", "__"): v for k, v in self.parameters().items()}
        meta = np.array([str(self.config.vocab_size), str(self.config.pad_id),
                         str(self.config.d_embed), str(self.config.hidden),
                         str(self.config.seed), self.config.version,
                         ",".join(self.config.heads.keys())], dtype="<U64")
        label_lens = np.array([len(v) for v in self.config.heads.values()], dtype=np.int64)
        np.savez(path, **arrays, __meta__=meta, __label_lens__=label_lens)

    @classmethod
    def load_npz(cls, path) -> "FlavoraNeuralCore":
        data = np.load(path, allow_pickle=False)
        meta = [str(x) for x in data["__meta__"]]
        vocab_size, pad_id, d_embed, hidden, seed, version = (
            int(meta[0]), int(meta[1]), int(meta[2]), int(meta[3]), int(meta[4]), meta[5])
        names = meta[6].split(",") if meta[6] else []
        heads = {n: HEAD_LABELS[n] for n in names if n in HEAD_LABELS}
        core = cls(NumpyConfig(vocab_size=vocab_size, pad_id=pad_id,
                               d_embed=d_embed, hidden=hidden, seed=seed,
                               version=version, heads=heads or dict(HEAD_LABELS)))
        params = core.parameters()
        for key, arr in params.items():
            zkey = key.replace("/", "__")
            if zkey in data:
                params[key][...] = np.asarray(data[zkey], dtype=np.float64)
        # Rebind (in-place already, but keep refs consistent).
        core.embeddings = params["embeddings"]
        core.W1, core.b1 = params["W1"], params["b1"]
        core.W2, core.b2 = params["W2"], params["b2"]
        return core

    def head_names(self) -> Sequence[str]:
        return list(self.config.heads.keys())
