#!/usr/bin/env python
"""Train the FlavoraLM BPE tokenizer standalone (no model training).

Trains on the *training corpus only* (no validation/test leakage) using the
same deterministic `train_tokenizer()` that `training/train.py` uses, then
writes a versioned `tokenizer.json` artifact plus metadata.

Usage:
    .flavoralm-venv/bin/python -m training.train_tokenizer --config training/configs/flavora_lm_dev.json
    npm run train:tokenizer
    npm run train:tokenizer -- --config training/configs/flavora_lm_small.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.flavora_lm.dataset import read_jsonl  # noqa: E402
from training.flavora_lm.tokenizer import (  # noqa: E402
    SPECIAL_TOKENS,
    TOKENIZER_VERSION,
    BPETokenizer,
    train_tokenizer,
)

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True, help="training config JSON (tokenizer.vocab_size is used)")
    ap.add_argument("--data-dir", default=str(ROOT / "training" / "data"))
    ap.add_argument("--out", default=None, help="output tokenizer.json path (default: <artifacts>/tokenizer.json)")
    args = ap.parse_args()

    full = json.loads(Path(args.config).read_text(encoding="utf-8"))
    vocab_target = int(full.get("tokenizer", {}).get("vocab_size", 768))
    version = str(full.get("version", "0.1"))

    data_dir = Path(args.data_dir)
    train_raw = read_jsonl(data_dir / "train.jsonl")
    corpus = [t for t, _ in train_raw]
    if not corpus:
        print("ERROR: empty training corpus", file=sys.stderr)
        return 1

    corpus_hash = hashlib.sha256("\n".join(corpus).encode("utf-8")).hexdigest()
    t0 = time.time()
    trained = train_tokenizer(corpus, vocab_size=vocab_target)
    tok = BPETokenizer(trained.vocab, trained.merges)
    dt = time.time() - t0

    out = Path(args.out) if args.out else ROOT / "models" / "flavora-lm" / f"v{version}" / "tokenizer.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    tok.save(out)
    meta = {
        "type": "flavora-tokenizer-train",
        "tokenizerVersion": TOKENIZER_VERSION,
        "vocabSize": tok.vocab_size,
        "vocabTarget": vocab_target,
        "specialTokens": list(SPECIAL_TOKENS),
        "normalization": "lowercase, whitespace split, edge-strip of .,!?;()'",
        "preTokenization": "JSON structural singletons ({ } [ ] \" : ,) split to own pieces, never merged",
        "trainingCorpus": {"examples": len(corpus), "sha256": corpus_hash, "source": str(data_dir / "train.jsonl")},
        "config": args.config,
        "trainSeconds": round(dt, 1),
    }
    (out.parent / "tokenizer_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"tokenizer v{TOKENIZER_VERSION}: {tok.vocab_size} tokens → {out} ({dt:.1f}s)")
    print(f"meta → {out.parent / 'tokenizer_meta.json'}")
    # Determinism self-check: re-encode a probe twice.
    probe = tok.encode("quick spicy chicken, no peanuts")
    assert probe == tok.encode("quick spicy chicken, no peanuts"), "non-deterministic encode"
    assert tok.decode(probe), "round-trip decode failed"
    print("determinism check OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
