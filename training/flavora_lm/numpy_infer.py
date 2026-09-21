#!/usr/bin/env python
"""Inference adapter: NumPy core predictions -> validated structured intent.

Decodes minimal-head argmax outputs into the real Flavora intent schema
(dietaryPreference / mealType / cuisine / spiceLevel / mode). Ingredients,
allergies and avoidFoods are NEVER predicted here — they stay deterministic
(Node merges heuristic extraction; the engine hard filter owns safety).

valid = finite probs AND confidence >= threshold (validated on held-out:
in-domain 0.93-1.00, gibberish 0.80-0.82; threshold 0.90). Anything else
returns None so the server responds valid:false and Node falls back honestly.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np

CONFIDENCE_THRESHOLD = 0.90


def decode_intent(core, token_ids: np.ndarray, pad_id: int | None = None
                  ) -> Tuple[Dict | None, float, Dict[str, List[float]]]:
    """Returns (intent_dict_or_None, confidence, probs_per_head)."""
    try:
        probs = core.forward(token_ids, pad_id)
    except (ValueError, IndexError):
        return None, 0.0, {}
    if not all(np.all(np.isfinite(p)) for p in probs.values()):
        return None, 0.0, {}
    conf = float(np.mean([float(np.max(p, axis=1)[0]) for p in probs.values()]))
    if not np.isfinite(conf) or conf < CONFIDENCE_THRESHOLD:
        return None, conf, {k: v[0].tolist() for k, v in probs.items()}
    pred = {name: core.config.heads[name][int(np.argmax(p[0]))] for name, p in probs.items()}
    intent: Dict = {"intent": "recommend", "mode": pred.get("mode", "normal")}
    if pred.get("diet", "none") != "none":
        intent["dietaryPreference"] = pred["diet"]
    if pred.get("meal", "none") != "none":
        intent["mealType"] = pred["meal"]
    cuisine = pred.get("cuisine", "none")
    intent["cuisine"] = None if cuisine == "none" else cuisine
    if pred.get("spice", "none") != "none":
        intent["spiceLevel"] = pred["spice"]
    return intent, conf, {k: v[0].tolist() for k, v in probs.items()}


SELF_TEST_INPUTS = [
    "I want something spicy",
    "I want vegan food",
    "I have tomatoes and onions",
    "I want a snack",
    "I want something Mexican",
]


def self_test(core, tokenizer) -> Dict:
    """Startup/verification self-test: shapes, finite probs, no NaN/Inf."""
    results = []
    ok = True
    for text in SELF_TEST_INPUTS:
        try:
            ids = np.array([tokenizer.encode(text, add_special=False) or [tokenizer.unk_id]],
                           dtype=np.int64)
            probs = core.forward(ids)
            finite = all(np.all(np.isfinite(p)) for p in probs.values())
            shapes = {k: list(v.shape) for k, v in probs.items()}
            conf = float(np.mean([float(np.max(p)) for p in probs.values()]))
            entry = {"input": text, "ok": bool(finite), "confidence": round(conf, 3),
                     "shapes": shapes}
        except Exception as e:  # never crash startup; report honestly
            entry = {"input": text, "ok": False, "error": str(e)[:200]}
            ok = False
        else:
            ok = ok and entry["ok"]
        results.append(entry)
    return {"ok": ok, "results": results}
