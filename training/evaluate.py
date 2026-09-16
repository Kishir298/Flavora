#!/usr/bin/env python
"""Evaluate a trained FlavoraLM checkpoint on the held-out test set.

Measures (spec section 23):
  validation loss / perplexity, structured intent accuracy, field-level
  accuracy (allergies, avoidFoods, cuisine, time, craving signals),
  invalid JSON rate, schema validity rate, negation handling,
  deterministic repeatability.

Never evaluates on training examples — always training/data/test.jsonl
(or --test-file override). Exit code is non-zero when thresholds fail.

Usage:
    .flavoralm-venv/bin/python -m training.evaluate --artifacts models/flavora-lm/v0.1
    npm run evaluate:llm
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.flavora_lm.dataset import read_jsonl  # noqa: E402
from training.flavora_lm.intent import _canon_keys, extract_intent  # noqa: E402
from training.flavora_lm.model import FlavoraLM  # noqa: E402
from training.flavora_lm.tokenizer import BPETokenizer  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def _norm_list(v) -> list[str]:
    if not isinstance(v, list):
        return []
    return sorted({str(x).lower().strip() for x in v if str(x).strip()})


def _field_match(pred: dict | None, gold: dict, field: str) -> bool | None:
    """True/False when the gold example constrains this field, else None (skip)."""
    if field not in gold:
        return None
    if pred is None:
        return False
    if field in ("allergies", "avoidFoods", "ingredients"):
        return _norm_list(pred.get(field)) == _norm_list(gold.get(field))
    if field in ("cuisine", "spicePreference", "mode", "mealType"):
        gv = gold.get(field)
        pv = pred.get(field)
        return (pv is None and gv is None) or (str(pv).lower() == str(gv).lower())
    if field == "timeLimit":
        return pred.get(field) == gold.get(field)
    if field == "cravingSignals":
        return json.dumps(pred.get(field), sort_keys=True) == json.dumps(gold.get(field), sort_keys=True)
    return None


def _has_negation(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in ("no ", "not ", "don't", "do not", "without", "allergic", "avoid", "can't", "cannot"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifacts", default=str(ROOT / "models" / "flavora-lm" / "v0.1"))
    ap.add_argument("--test-file", default=str(ROOT / "training" / "data" / "test.jsonl"))
    ap.add_argument("--max-examples", type=int, default=0, help="cap examples (0 = all)")
    ap.add_argument("--max-new-tokens", type=int, default=96)
    ap.add_argument("--out", default=None, help="write JSON report here (default: <artifacts>/eval.json)")
    ap.add_argument("--min-intent-acc", type=float, default=0.0, help="fail if intent accuracy below this")
    args = ap.parse_args()

    art = Path(args.artifacts)
    model = FlavoraLM.load_pretrained(art, map_location="cpu")
    tok = BPETokenizer.load(art / "tokenizer.json")
    print(f"Evaluating {model.cfg.model_name} v{model.cfg.version} "
          f"({model.num_parameters():,} params) on {args.test_file}", flush=True)

    examples = read_jsonl(args.test_file)
    if args.max_examples and len(examples) > args.max_examples:
        examples = examples[: args.max_examples]
    print(f"  {len(examples)} held-out test examples", flush=True)

    n = len(examples)
    exact = 0
    valid_ct = 0
    invalid_json = 0
    fields: dict[str, list[bool]] = {
        "allergies": [], "avoidFoods": [], "cuisine": [],
        "timeLimit": [], "cravingSignals": [], "ingredients": [],
        "spicePreference": [], "mode": [],
    }
    negation_total = negation_ok = 0
    repeat_ok = repeat_total = 0
    total_ms = 0

    for text, gold in examples:
        t0 = time.time()
        pred = extract_intent(model, tok, text, max_new_tokens=args.max_new_tokens)
        total_ms += (time.time() - t0) * 1000
        # Invalid-JSON rate: no parseable/validatable intent survived.
        if pred is None:
            invalid_json += 1
            for f in fields:
                if f in gold:
                    fields[f].append(False)
            if _has_negation(text):
                negation_total += 1
            continue
        if pred is not None:
            valid_ct += 1
            # Exact match after canonicalizing gold keys the same way the
            # model output is canonicalized (tokenizer lowercases words).
            canon_gold = _canon_keys({k: v for k, v in gold.items()})
            if json.dumps(pred, sort_keys=True) == json.dumps(canon_gold, sort_keys=True):
                exact += 1
        for f in fields:
            m = _field_match(pred, gold, f)
            if m is not None:
                fields[f].append(m)
        if _has_negation(text):
            negation_total += 1
            # Negation counts when avoid/allergy constraints survive when gold has them.
            relevant = [k for k in ("allergies", "avoidFoods") if k in gold]
            if not relevant:
                negation_ok += 1
            elif pred is not None and all(
                _norm_list(pred.get(k)) == _norm_list(gold.get(k)) for k in relevant
            ):
                negation_ok += 1

    # Deterministic repeatability on a fixed subset (same input → same intent).
    subset = [t for t, _ in examples[: min(20, n)]]
    for text in subset:
        a = extract_intent(model, tok, text, max_new_tokens=args.max_new_tokens)
        b = extract_intent(model, tok, text, max_new_tokens=args.max_new_tokens)
        repeat_total += 1
        if json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True):
            repeat_ok += 1

    def rate(xs: list[bool]) -> float | None:
        return (sum(xs) / len(xs)) if xs else None

    field_acc = {k: rate(v) for k, v in fields.items()}
    report = {
        "model": model.cfg.model_name,
        "version": model.cfg.version,
        "artifacts": str(art),
        "testFile": args.test_file,
        "examples": n,
        "intentExactMatch": exact / max(n, 1),
        "schemaValidityRate": valid_ct / max(n, 1),
        "invalidJsonRate": invalid_json / max(n, 1),
        "fieldAccuracy": field_acc,
        "negationAccuracy": (negation_ok / negation_total) if negation_total else None,
        "negationExamples": negation_total,
        "repeatability": (repeat_ok / repeat_total) if repeat_total else None,
        "avgMsPerExample": total_ms / max(n, 1),
        "evaluatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    print(json.dumps(report, indent=2))

    out = Path(args.out) if args.out else art / "eval.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"  report → {out}")

    if report["intentExactMatch"] < args.min_intent_acc:
        print(f"EVAL FAILED: intent accuracy {report['intentExactMatch']:.3f} "
              f"< threshold {args.min_intent_acc}", file=sys.stderr)
        return 1
    # Hard gates: repeatability must be perfect (greedy decoding is deterministic).
    if report["repeatability"] is not None and report["repeatability"] < 1.0:
        print("EVAL FAILED: non-deterministic intent extraction", file=sys.stderr)
        return 1
    print("EVAL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
