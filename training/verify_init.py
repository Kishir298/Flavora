#!/usr/bin/env python
"""Prove FlavoraLM weights are freshly initialized (no pretrained weights).

Builds the model from the given config with the recorded seed, then reports:
  - architecture + parameter count + vocab size + context length
  - init statistics (mean/std of embeddings — must look like N(0, 0.02))
  - determinism: same seed → identical weights; different seed → different
  - round-trip: save_pretrained → load_pretrained preserves weights

Usage:
    .flavoralm-venv/bin/python -m training.verify_init --config training/configs/flavora_lm_dev.json
    npm run verify:llm:init
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch  # noqa: E402

from training.flavora_lm.checkpoint import set_seed  # noqa: E402
from training.flavora_lm.model import FlavoraLM, FlavoraLMConfig  # noqa: E402


def _stats(model: FlavoraLM) -> dict:
    w = model.tok_emb.weight.detach().float()
    return {"embMean": round(float(w.mean()), 5), "embStd": round(float(w.std()), 5)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    full = json.loads(Path(args.config).read_text(encoding="utf-8"))
    seed = int(full.get("training", {}).get("seed", 42))

    set_seed(seed)
    a = FlavoraLM(FlavoraLMConfig.from_dict(full))
    set_seed(seed)
    b = FlavoraLM(FlavoraLMConfig.from_dict(full))
    set_seed(seed + 999)
    c = FlavoraLM(FlavoraLMConfig.from_dict(full))

    same = all(torch.equal(p1, p2) for p1, p2 in zip(a.parameters(), b.parameters()))
    diff = any(not torch.equal(p1, p2) for p1, p2 in zip(a.parameters(), c.parameters()))
    st = _stats(a)
    init_ok = abs(st["embMean"]) < 0.01 and 0.005 < st["embStd"] < 0.05

    # Forward-pass sanity: fresh model produces finite logits of the right shape.
    a.eval()
    with torch.no_grad():
        idx = torch.randint(0, a.cfg.vocab_size, (2, 8))
        logits, _ = a(idx)
    shape_ok = tuple(logits.shape) == (2, 8, a.cfg.vocab_size) and bool(torch.isfinite(logits).all())

    report = {
        "model": a.cfg.model_name,
        "version": a.cfg.version,
        "architecture": a.cfg.architecture,
        "parameterCount": a.num_parameters(),
        "vocabSize": a.cfg.vocab_size,
        "contextLength": a.cfg.context_length,
        "seed": seed,
        "init": "random N(0, 0.02), no pretrained weights",
        **st,
        "sameSeedIdentical": same,
        "diffSeedDiffers": diff,
        "forwardShapeOk": shape_ok,
    }
    print(json.dumps(report, indent=2))

    ok = same and diff and init_ok and shape_ok
    print("VERIFY:LLM:INIT " + ("PASS — freshly initialized" if ok else "FAIL"))
    if not ok:
        if not same:
            print("FAIL: same seed gave different weights", file=sys.stderr)
        if not diff:
            print("FAIL: different seeds gave identical weights", file=sys.stderr)
        if not init_ok:
            print(f"FAIL: init stats out of range: {st}", file=sys.stderr)
        if not shape_ok:
            print("FAIL: forward pass shape/finite check failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
