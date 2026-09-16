#!/usr/bin/env python
"""Build the FlavoraLM dataset splits from the synthetic corpus generator.

Usage:
    python -m training.build_dataset --config training/configs/flavora_lm_dev.json
    python -m training.build_dataset --config training/configs/flavora_lm_small.json --out training/data
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.flavora_lm.dataset import DATASET_VERSION, generate_examples, write_jsonl  # noqa: E402


def validate_example(text: str, intent: dict) -> list[str]:
    """Return a list of problems with one example (empty list = valid)."""
    problems: list[str] = []
    if not text or not text.strip():
        problems.append("empty input text")
    if intent.get("intent") != "recommend":
        problems.append("missing/unknown intent")
    if "timeLimit" in intent and not (5 <= intent["timeLimit"] <= 180):
        problems.append(f"timeLimit out of range: {intent['timeLimit']}")
    if "spicePreference" in intent and intent["spicePreference"] not in ("mild", "medium", "hot"):
        problems.append(f"bad spice: {intent['spicePreference']}")
    if "mode" in intent and intent["mode"] not in ("normal", "food_waste", "budget"):
        problems.append(f"bad mode: {intent['mode']}")
    for key in ("ingredients", "allergies", "avoidFoods"):
        if key in intent and (not isinstance(intent[key], list) or not all(isinstance(x, str) and x for x in intent[key])):
            problems.append(f"{key} must be a non-empty string list")
    unknown = set(intent) - {
        "intent", "ingredients", "timeLimit", "cuisine", "spicePreference",
        "craving", "cravingSignals", "allergies", "avoidFoods", "mode", "mealType",
    }
    if unknown:
        problems.append(f"unknown fields: {sorted(unknown)}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default="training/data")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    ds = cfg["dataset"]
    seed = ds.get("seed", 42)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    n_train, n_val, n_test = ds["train_examples"], ds["validation_examples"], ds["test_examples"]
    total = n_train + n_val + n_test

    # Draw one deterministic stream, then split by index — no leakage, no overlaps.
    stream = list(generate_examples(total, seed=seed))
    splits = {
        "train.jsonl": stream[:n_train],
        "validation.jsonl": stream[n_train : n_train + n_val],
        "test.jsonl": stream[n_train + n_val :],
    }

    problems = 0
    for name, examples in splits.items():
        bad = [(t, i, p) for t, i in examples for p in [validate_example(t, i)] if p]
        if bad:
            for t, _i, ps in bad[:5]:
                print(f"  INVALID: {ps} in {t!r}", file=sys.stderr)
            problems += len(bad)
        write_jsonl(out / name, examples)
        print(f"  wrote {out / name} ({len(examples)} examples)")

    manifest = {
        "datasetVersion": DATASET_VERSION,
        "seed": seed,
        "splits": {k: len(v) for k, v in splits.items()},
        "config": args.config,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"  dataset version {DATASET_VERSION}, seed {seed}")

    if problems:
        print(f"VALIDATION FAILED: {problems} invalid examples", file=sys.stderr)
        return 1
    print("dataset OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
