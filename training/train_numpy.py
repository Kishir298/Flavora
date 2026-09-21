#!/usr/bin/env python
"""Train FlavoraLM v0.2 NumPy core (dev-scale default, real pipeline).

Pipeline: generate deterministic dataset -> train word-level tokenizer on
the train corpus -> encode batches -> init NumPy core -> minibatch Adam
(forward -> softmaxCE loss -> backprop -> update) -> validate on held-out
split -> save .npz checkpoint + metrics -> print report.

Usage:
    .flavoralm-venv/bin/python -m training.train_numpy --examples 2000 --epochs 15
    npm run train:llm-numpy        # dev-scale (untracked dev-numpy/)
    npm run train:llm-numpy:full   # larger run (still NumPy core)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from training.flavora_lm.numpy_data import (
    NUMPY_DATASET_VERSION,
    class_balance,
    encode_batch,
    generate_numpy_examples,
    label_indices,
    make_splits,
)
from training.flavora_lm.numpy_model import (
    ARCHITECTURE,
    FlavoraNeuralCore,
    MODEL_NAME,
    MODEL_VERSION,
    NumpyConfig,
)
from training.flavora_lm.numpy_train import AdamState, TrainConfig, evaluate, train_step
from training.flavora_lm.tokenizer import TOKENIZER_VERSION, BPETokenizer, train_tokenizer

ROOT = Path(__file__).resolve().parents[1]


def build_tokenizer(texts, vocab_size: int = 1500) -> BPETokenizer:
    trained = train_tokenizer(texts, vocab_size=vocab_size)
    return BPETokenizer(trained.vocab, trained.merges)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--examples", type=int, default=2000)
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--vocab-size", type=int, default=1500)
    ap.add_argument("--d-embed", type=int, default=64)
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--out-dir", default="models/flavora-lm/dev-numpy")
    args = ap.parse_args()

    t0 = time.time()
    print(f"Training {MODEL_NAME} v{MODEL_VERSION} ({ARCHITECTURE}, NumPy core, seed {args.seed})")
    train_ex, val_ex, test_ex = make_splits(args.examples, seed=args.seed)
    print(f"  dataset: {len(train_ex)} train / {len(val_ex)} val / {len(test_ex)} test "
          f"(v{NUMPY_DATASET_VERSION}, seed {args.seed})")

    tok = build_tokenizer([t for t, _ in train_ex], vocab_size=args.vocab_size)
    print(f"  tokenizer: v{TOKENIZER_VERSION} {tok.vocab_size} tokens")

    cfg = NumpyConfig(vocab_size=tok.vocab_size, pad_id=tok.pad_id,
                      d_embed=args.d_embed, hidden=args.hidden, seed=args.seed)
    core = FlavoraNeuralCore(cfg)
    print(f"  model: {core.param_count():,} params "
          f"(E {tok.vocab_size}x{args.d_embed}, h {args.hidden}, heads {len(cfg.heads)})")

    tcfg = TrainConfig(lr=args.lr, batch_size=args.batch_size, seed=args.seed)
    opt = AdamState(core.parameters())
    brng = np.random.default_rng(args.seed + 1)

    train_texts = [t for t, _ in train_ex]
    train_labels = [label_indices(l, cfg.heads) for _, l in train_ex]
    Xtr = encode_batch(tok, train_texts, tok.pad_id)
    val_texts = [t for t, _ in val_ex]
    val_labels = [label_indices(l, cfg.heads) for _, l in val_ex]
    Xva = encode_batch(tok, val_texts, tok.pad_id) if val_texts else np.zeros((0, 1), dtype=np.int64)

    def to_targets(idxs: list, names) -> dict:
        arr = np.array(idxs, dtype=np.int64)
        return {name: arr[:, i] for i, name in enumerate(names)}

    head_names = list(cfg.heads.keys())
    Ytr_all = to_targets([[d[name] for name in head_names] for d in train_labels], head_names)
    Yva_all = to_targets([[d[name] for name in head_names] for d in val_labels], head_names) if val_labels else {}

    n = len(train_ex)
    for epoch in range(args.epochs):
        order = brng.permutation(n)
        running = 0.0
        steps = 0
        for i in range(0, n, tcfg.batch_size):
            idx = order[i: i + tcfg.batch_size]
            # Per-example pad: re-pad the batch slice to its own max length.
            seqs = [Xtr[j] for j in idx]
            T = max(int(np.sum(Xtr[j] != tok.pad_id)) for j in idx)
            T = max(T, 1)
            B = len(idxs := idx)
            batch = np.full((B, T), tok.pad_id, dtype=np.int64)
            for b, j in enumerate(idx):
                row = Xtr[j][Xtr[j] != tok.pad_id][:T]
                batch[b, :len(row)] = row
            tgt = {name: Ytr_all[name][idx] for name in head_names}
            running += train_step(core, batch, tgt, opt, tcfg)
            steps += 1
        val_m = evaluate(core, Xva, Yva_all) if len(val_ex) else {"loss": float("nan"), "macro_acc": 0.0}
        print(f"  epoch {epoch + 1}/{args.epochs}  train_loss {running / max(steps, 1):.4f}  "
              f"val_loss {val_m['loss']:.4f}  val_macro_acc {val_m['macro_acc']:.3f}")

    out_dir = ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    core.save_npz(out_dir / "model.npz")
    tok.save(out_dir / "tokenizer.json")
    final_val = evaluate(core, Xva, Yva_all) if len(val_ex) else {"loss": 0.0, "macro_acc": 0.0}
    test_texts = [t for t, _ in test_ex]
    test_labels = [label_indices(l, cfg.heads) for _, l in test_ex]
    Xte = encode_batch(tok, test_texts, tok.pad_id) if test_texts else np.zeros((0, 1), dtype=np.int64)
    Yte = to_targets([[d[name] for name in head_names] for d in test_labels], head_names) if test_labels else {}
    final_test = evaluate(core, Xte, Yte) if len(test_ex) else {"loss": 0.0, "macro_acc": 0.0}
    report = {
        "model": MODEL_NAME, "version": MODEL_VERSION, "architecture": ARCHITECTURE,
        "tokenizer_version": TOKENIZER_VERSION, "vocab_size": tok.vocab_size,
        "param_count": core.param_count(), "dataset_version": NUMPY_DATASET_VERSION,
        "examples": args.examples, "seed": args.seed, "epochs": args.epochs,
        "batch_size": args.batch_size, "lr": args.lr,
        "optimizer": "adam", "d_embed": args.d_embed, "hidden": args.hidden,
        "train_size": len(train_ex), "val_size": len(val_ex), "test_size": len(test_ex),
        "val_loss": final_val["loss"], "val_macro_acc": final_val["macro_acc"],
        "test_loss": final_test["loss"], "test_macro_acc": final_test["macro_acc"],
        "test_per_head": {k: v for k, v in final_test.items() if k.startswith("acc/")},
        "class_balance_train": class_balance(train_ex),
        "elapsed_s": round(time.time() - t0, 1),
    }
    (out_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"  artifacts -> {out_dir} (model.npz, tokenizer.json, metrics.json)")
    print(f"  test macro_acc {final_test['macro_acc']:.3f} loss {final_test['loss']:.4f} "
          f"({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
