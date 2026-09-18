#!/usr/bin/env python
"""Evaluate a trained FlavoraLM checkpoint on the held-out test set.

Measures: structured intent accuracy, field-level accuracy (allergies,
avoidFoods, cuisine, time, craving signals), invalid JSON rate, schema
validity rate, negation handling, deterministic repeatability.

Validation loss / perplexity are NOT recomputed here — they are recorded
during training in `models/flavora-lm/v0.1/metrics.json` (+ `training_meta.json`).
This script evaluates generation quality (intent extraction) on held-out data.

Never evaluates on training examples — always training/data/test.jsonl
(or --test-file override). Exit code is non-zero when thresholds fail.

Usage:
    .flavoralm-venv/bin/python -m training.evaluate --artifacts models/flavora-lm/v0.1
    npm run evaluate:llm
    npm run eval:full -- --resume          # resume an interrupted full run
    npm run eval:full -- --limit 25        # bounded smoke run (same as --max-examples)

Resumability: every example gets a stable ID (`ex-{index}-{sha8(input)}`).
Each completed example is appended to a JSONL checkpoint immediately, so an
interrupted run can be resumed with --resume without rerunning completed
examples. A single failed example never aborts the run — it is recorded with
its failure category and the runner continues.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
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


RUNNER_VERSION = "1.1.0"


def example_id(index: int, text: str) -> str:
    """Stable ID for one dataset example (position + content hash)."""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
    return f"ex-{index:04d}-{digest}"


def dataset_id(test_file: str, count: int) -> str:
    """Stable dataset identifier (path + line count + content hash)."""
    try:
        h = hashlib.sha256(Path(test_file).read_bytes()).hexdigest()[:12]
    except OSError:
        h = "missing"
    return f"{Path(test_file).name}:{count}:{h}"


def load_checkpoint(path: str | Path) -> dict[str, dict]:
    """Load completed example records from a JSONL checkpoint file."""
    out: dict[str, dict] = {}
    p = Path(path)
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(rec, dict) and rec.get("id"):
            out[rec["id"]] = rec
    return out


def append_record(path: str | Path, rec: dict) -> None:
    """Append one example record to the JSONL checkpoint (incremental)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
        f.flush()


def filter_resume(records: dict[str, dict], ds_id: str) -> tuple[dict[str, dict], int]:
    """Keep only checkpoint records belonging to this dataset run.

    Records without a datasetId predate runner v1.1.0 and are trusted;
    records stamped with another dataset are stale and must be recomputed.
    Returns (kept, stale_count).
    """
    kept = {k: v for k, v in records.items() if v.get("datasetId") in (None, ds_id)}
    return kept, len(records) - len(kept)


def summarize(latencies: list[float]) -> dict:
    """avg/median latency plus the slowest examples (by parallel index list)."""
    if not latencies:
        return {"avgMs": None, "medianMs": None, "slowestMs": []}
    ordered = sorted(latencies)
    n = len(ordered)
    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return {
        "avgMs": sum(ordered) / n,
        "medianMs": median,
        "slowestMs": ordered[-min(5, n):][::-1],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifacts", default=str(ROOT / "models" / "flavora-lm" / "v0.1"))
    ap.add_argument("--test-file", default=str(ROOT / "training" / "data" / "test.jsonl"))
    ap.add_argument("--max-examples", type=int, default=0, help="cap examples (0 = all)")
    ap.add_argument("--limit", type=int, default=0, help="alias for --max-examples (bounded smoke runs)")
    ap.add_argument("--resume", action="store_true", help="skip examples already recorded in --checkpoint")
    ap.add_argument("--checkpoint", default=None, help="JSONL checkpoint path (default: <artifacts>/eval-checkpoint.jsonl)")
    ap.add_argument("--timeout-s", type=float, default=0, help="per-example timeout in seconds (0 = none)")
    ap.add_argument("--max-new-tokens", type=int, default=96)
    ap.add_argument("--out", default=None, help="write JSON report here (default: <artifacts>/eval.json)")
    ap.add_argument("--min-intent-acc", type=float, default=0.0, help="fail if intent accuracy below this")
    args = ap.parse_args()
    cap = args.limit or args.max_examples

    art = Path(args.artifacts)
    model = FlavoraLM.load_pretrained(art, map_location="cpu")
    tok = BPETokenizer.load(art / "tokenizer.json")
    print(f"Evaluating {model.cfg.model_name} v{model.cfg.version} "
          f"({model.num_parameters():,} params) on {args.test_file}", flush=True)

    examples = read_jsonl(args.test_file)
    dataset_total = len(examples)
    if cap and len(examples) > cap:
        examples = examples[:cap]
    skipped = dataset_total - len(examples)
    print(f"  {len(examples)} held-out test examples ({skipped} skipped by cap)", flush=True)

    ckpt_path = Path(args.checkpoint) if args.checkpoint else art / "eval-checkpoint.jsonl"
    ds_id = dataset_id(args.test_file, dataset_total)
    done: dict[str, dict] = {}
    if args.resume:
        raw = load_checkpoint(ckpt_path)
        # Never trust records from a different dataset/run: only IDs that
        # also carry this run's datasetId are skippable.
        done, skipped_stale = filter_resume(raw, ds_id)
        print(f"  resume: {len(done)} already-completed examples in {ckpt_path}"
              + (f" ({skipped_stale} stale records from another dataset ignored)" if skipped_stale else ""),
              flush=True)
    run_started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    n = len(examples)
    exact = 0
    valid_ct = 0
    invalid_json = 0
    errored = 0
    failure_categories: dict[str, int] = {}
    latencies: list[float] = []
    per_example: list[dict] = []
    fields: dict[str, list[bool]] = {
        "allergies": [], "avoidFoods": [], "cuisine": [],
        "timeLimit": [], "cravingSignals": [], "ingredients": [],
        "spicePreference": [], "mode": [],
    }
    negation_total = negation_ok = 0
    repeat_ok = repeat_total = 0
    total_ms = 0

    def note_failure(cat: str) -> None:
        failure_categories[cat] = failure_categories.get(cat, 0) + 1

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        for index, (text, gold) in enumerate(examples):
            eid = example_id(index, text)
            if eid in done:
                rec = done[eid]
                # Fold the resumed record back into the aggregates.
                per_example.append(rec)
                lat = rec.get("latencyMs")
                if isinstance(lat, (int, float)):
                    latencies.append(float(lat))
                    total_ms += float(lat)
                st = rec.get("status")
                if st == "pass":
                    valid_ct += 1
                    if rec.get("exact"):
                        exact += 1
                elif st == "fail":
                    invalid_json += 1
                    note_failure(rec.get("failureCategory", "invalid_json"))
                elif st == "error":
                    errored += 1
                    note_failure(rec.get("failureCategory", "model_error"))
                for f, vals in fields.items():
                    if f in gold and f in (rec.get("fieldResults") or {}):
                        vals.append(bool(rec["fieldResults"][f]))
                if rec.get("negation") is not None:
                    negation_total += 1
                    if rec["negation"]:
                        negation_ok += 1
                continue

            # start → execute → record → checkpoint → continue.
            # One bad example never aborts the run.
            t0 = time.time()
            pred: dict | None = None
            err: str | None = None
            ecat: str | None = None
            try:
                fut = pool.submit(extract_intent, model, tok, text, args.max_new_tokens)
                timeout = args.timeout_s if args.timeout_s and args.timeout_s > 0 else None
                pred = fut.result(timeout=timeout)
            except concurrent.futures.TimeoutError:
                err = f"extract_intent exceeded timeout-s={args.timeout_s}"
                ecat = "timeout"
            except Exception as e:  # noqa: BLE001 — recorded, never raised
                err = f"{type(e).__name__}: {e}"[:300]
                ecat = "model_error"
            ms = (time.time() - t0) * 1000
            total_ms += ms
            latencies.append(ms)

            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            field_results: dict[str, bool] = {}
            neg: bool | None = None
            if err is not None:
                errored += 1
                assert ecat is not None
                note_failure(ecat)
                status = "error"
            elif pred is None:
                invalid_json += 1
                note_failure("invalid_json")
                status = "fail"
                for f in fields:
                    if f in gold:
                        fields[f].append(False)
                        field_results[f] = False
                if _has_negation(text):
                    negation_total += 1
                    neg = False
            else:
                valid_ct += 1
                status = "pass"
                # Exact match after canonicalizing gold keys the same way the
                # model output is canonicalized (tokenizer lowercases words).
                canon_gold = _canon_keys({k: v for k, v in gold.items()})
                is_exact = json.dumps(pred, sort_keys=True) == json.dumps(canon_gold, sort_keys=True)
                if is_exact:
                    exact += 1
                for f in fields:
                    m = _field_match(pred, gold, f)
                    if m is not None:
                        fields[f].append(m)
                        field_results[f] = m
                if _has_negation(text):
                    negation_total += 1
                    # Negation counts when avoid/allergy constraints survive when gold has them.
                    relevant = [k for k in ("allergies", "avoidFoods") if k in gold]
                    if not relevant:
                        negation_ok += 1
                        neg = True
                    elif all(
                        _norm_list(pred.get(k)) == _norm_list(gold.get(k)) for k in relevant
                    ):
                        negation_ok += 1
                        neg = True
                    else:
                        neg = False
            rec = {
                "id": eid,
                "datasetId": ds_id,
                "status": status,
                "latencyMs": ms,
                "timestamp": ts,
                "exact": (status == "pass" and pred is not None and json.dumps(pred, sort_keys=True) == json.dumps(_canon_keys({k: v for k, v in gold.items()}), sort_keys=True)),
                "failureCategory": ecat if status == "error" else ("invalid_json" if status == "fail" else None),
                "error": err,
                "fieldResults": field_results,
                "negation": neg,
            }
            per_example.append(rec)
            append_record(ckpt_path, rec)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

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
    lat = summarize(latencies)
    completed = valid_ct + invalid_json + errored
    slowest_ids = sorted(per_example, key=lambda r: r.get("latencyMs") or 0, reverse=True)[:5]
    try:
        param_count: int | None = model.num_parameters()
    except Exception:  # noqa: BLE001 — metadata only
        param_count = None
    report = {
        "model": model.cfg.model_name,
        "version": model.cfg.version,
        "artifacts": str(art),
        "testFile": args.test_file,
        "datasetId": ds_id,
        "examples": n,
        "total": dataset_total,
        "completed": completed,
        "passed": valid_ct,
        "failed": invalid_json,
        "errored": errored,
        "skipped": skipped,
        "intentExactMatch": exact / max(n, 1),
        "schemaValidityRate": valid_ct / max(n, 1),
        "invalidJsonRate": invalid_json / max(n, 1),
        "fieldAccuracy": field_acc,
        "negationAccuracy": (negation_ok / negation_total) if negation_total else None,
        "negationExamples": negation_total,
        "repeatability": (repeat_ok / repeat_total) if repeat_total else None,
        "avgMsPerExample": total_ms / max(n, 1),
        "medianMsPerExample": lat["medianMs"],
        "slowestExamples": [{"id": r["id"], "latencyMs": r.get("latencyMs")} for r in slowest_ids],
        "failureCategories": failure_categories,
        "config": {
            "maxExamples": cap,
            "maxNewTokens": args.max_new_tokens,
            "timeoutS": args.timeout_s,
            "resumed": bool(args.resume),
            "checkpoint": str(ckpt_path),
        },
        "modelSpec": {"parameterCount": param_count},
        "runnerVersion": RUNNER_VERSION,
        "runStartedAt": run_started,
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
