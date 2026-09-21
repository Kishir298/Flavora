#!/usr/bin/env python
"""Training for the FlavoraLM v0.2 NumPy core: real backprop + Adam/SGD.

Losses: softmax cross-entropy per head (all minimal heads are categorical).
Backward: exact analytic gradients for Dense/ReLU/softmax-CE/masked-mean/
embedding-lookup, vectorized over the batch. No autograd frameworks.

Update rule: Adam (default) or SGD, applied to W/b/embeddings/heads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np

from .numpy_model import FlavoraNeuralCore


@dataclass
class TrainConfig:
    lr: float = 3e-3
    batch_size: int = 32
    epochs: int = 10
    optimizer: str = "adam"  # adam | sgd
    seed: int = 42
    grad_clip: float = 1.0


class AdamState:
    def __init__(self, params: Dict[str, np.ndarray]):
        self.m = {k: np.zeros_like(v) for k, v in params.items()}
        self.v = {k: np.zeros_like(v) for k, v in params.items()}
        self.t = 0


def softmax_ce_loss(probs: np.ndarray, targets: np.ndarray) -> Tuple[float, np.ndarray]:
    """Mean softmax cross-entropy + dlogits. Numerically stable (log(max(p,eps)))."""
    B = probs.shape[0]
    eps = 1e-12
    correct = probs[np.arange(B), targets]
    loss = float(-np.mean(np.log(np.maximum(correct, eps))))
    dlogits = probs.copy()
    dlogits[np.arange(B), targets] -= 1.0
    dlogits /= B
    return loss, dlogits


def backward(core: FlavoraNeuralCore, targets: Dict[str, np.ndarray]) -> Tuple[Dict[str, np.ndarray], float]:
    """Analytic gradients for one cached forward pass. Returns (grads, loss)."""
    cache = core._cache
    ids, mask = cache["ids"], cache["mask"]
    sent, h1_pre, h1, h2_pre, h2 = (cache["sent"], cache["h1_pre"], cache["h1"],
                                    cache["h2_pre"], cache["h2"])
    B = ids.shape[0]
    counts = np.maximum(np.sum(mask, axis=1, keepdims=True), 1.0)
    grads: Dict[str, np.ndarray] = {}
    total_loss = 0.0
    dh2 = np.zeros_like(h2)
    n_heads = max(len(core.head_names()), 1)
    for name in core.head_names():
        probs = cache[f"prob/{name}"]
        loss, dlogits = softmax_ce_loss(probs, np.asarray(targets[name]).reshape(B))
        total_loss += loss
        # Mean over heads (matches the averaged loss below).
        grads[f"head_W/{name}"] = (h2.T @ dlogits) / n_heads
        grads[f"head_b/{name}"] = np.sum(dlogits, axis=0) / n_heads
        dh2 += (dlogits @ core.head_W[name].T) / n_heads
    dh2_pre = dh2 * (h2_pre > 0).astype(np.float64)  # ReLU'
    grads["W2"] = h1.T @ dh2_pre
    grads["b2"] = np.sum(dh2_pre, axis=0)
    dh1 = dh2_pre @ core.W2.T
    dh1_pre = dh1 * (h1_pre > 0).astype(np.float64)
    grads["W1"] = sent.T @ dh1_pre
    grads["b1"] = np.sum(dh1_pre, axis=0)
    dsent = dh1_pre @ core.W1.T  # [B,d]
    # masked-mean backward: each present token gets dsent/count.
    demb = (dsent[:, None, :] * (mask[:, :, None] / counts[:, :, None]))  # [B,T,d]
    demb_full = np.zeros_like(core.embeddings)
    np.add.at(demb_full, ids, demb)
    grads["embeddings"] = demb_full
    # grad clipping (global norm) for stability.
    return grads, total_loss / max(len(core.head_names()), 1)


def apply_grads(core: FlavoraNeuralCore, grads: Dict[str, np.ndarray],
                opt: AdamState | None, cfg: TrainConfig) -> None:
    params = core.parameters()
    if opt is None or cfg.optimizer == "sgd":
        for k, g in grads.items():
            g = np.asarray(g, dtype=np.float64)
            n = float(np.sqrt(np.sum(g * g)))
            if n > cfg.grad_clip:
                g = g * (cfg.grad_clip / max(n, 1e-12))
            params[k] -= cfg.lr * g
            if not np.all(np.isfinite(params[k])):
                raise ValueError(f"non-finite parameter after SGD update: {k}")
        return
    # Adam.
    opt.t += 1
    b1, b2, eps = 0.9, 0.999, 1e-8
    for k, g in grads.items():
        g = np.asarray(g, dtype=np.float64)
        n = float(np.sqrt(np.sum(g * g)))
        if n > cfg.grad_clip:
            g = g * (cfg.grad_clip / max(n, 1e-12))
        opt.m[k] = b1 * opt.m[k] + (1 - b1) * g
        opt.v[k] = b2 * opt.v[k] + (1 - b2) * (g * g)
        mhat = opt.m[k] / (1 - b1 ** opt.t)
        vhat = opt.v[k] / (1 - b2 ** opt.t)
        params[k] -= cfg.lr * mhat / (np.sqrt(vhat) + eps)
        if not np.all(np.isfinite(params[k])):
            raise ValueError(f"non-finite parameter after Adam update: {k}")


def train_step(core: FlavoraNeuralCore, batch_ids: np.ndarray,
               targets: Dict[str, np.ndarray], opt: AdamState | None,
               cfg: TrainConfig) -> float:
    core.forward(batch_ids)
    grads, loss = backward(core, targets)
    apply_grads(core, grads, opt, cfg)
    return loss


def evaluate(core: FlavoraNeuralCore, ids: np.ndarray,
             targets: Dict[str, np.ndarray]) -> Dict[str, float]:
    """Held-out metrics: loss + per-head accuracy + macro accuracy."""
    probs = core.forward(ids)
    B = ids.shape[0]
    losses, accs = [], {}
    for name in core.head_names():
        loss, _ = softmax_ce_loss(probs[name], np.asarray(targets[name]).reshape(B))
        losses.append(loss)
        pred = np.argmax(probs[name], axis=1)
        accs[name] = float(np.mean(pred == np.asarray(targets[name]).reshape(B)))
    out = {f"acc/{k}": v for k, v in accs.items()}
    out["loss"] = float(np.mean(losses))
    out["macro_acc"] = float(np.mean(list(accs.values()))) if accs else 0.0
    return out


def numerical_grad_check(core: FlavoraNeuralCore, batch_ids: np.ndarray,
                         targets: Dict[str, np.ndarray], param_key: str = "W1",
                         idx: Tuple[int, ...] = (0, 0), eps: float = 1e-5
                         ) -> Tuple[float, float, float]:
    """Finite-difference check of one parameter element vs analytic gradient."""
    params = core.parameters()
    orig = float(params[param_key][idx])
    params[param_key][idx] = orig + eps
    core.forward(batch_ids)
    _, loss_p = backward(core, targets)
    params[param_key][idx] = orig - eps
    core.forward(batch_ids)
    _, loss_m = backward(core, targets)
    params[param_key][idx] = orig
    core.forward(batch_ids)
    grads, _ = backward(core, targets)
    analytic = float(grads[param_key][idx])
    numeric = (loss_p - loss_m) / (2 * eps)
    denom = max(1e-8, abs(analytic) + abs(numeric))
    rel = abs(analytic - numeric) / denom
    return analytic, numeric, rel
