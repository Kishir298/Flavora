#!/usr/bin/env python
"""Train FlavoraLM from scratch.

Pipeline: load dataset → validate → train tokenizer on the corpus →
encode examples → batch → initialize model with random weights →
train (cross-entropy, causal mask, LR schedule, grad clip) →
evaluate on validation → save checkpoint + final artifacts + metadata.

Usage:
    .flavoralm-venv/bin/python -m training.train --config training/configs/flavora_lm_dev.json
    .flavoralm-venv/bin/python -m training.train --config training/configs/flavora_lm_small.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch  # noqa: E402

from training.flavora_lm.dataset import DATASET_VERSION, format_example, read_jsonl  # noqa: E402
from training.flavora_lm.model import FlavoraLM, FlavoraLMConfig  # noqa: E402
from training.flavora_lm.checkpoint import (  # noqa: E402
    TrainingMeta,
    hardware_description,
    save_checkpoint,
    set_seed,
)
from training.flavora_lm.tokenizer import BPETokenizer, TOKENIZER_VERSION, train_tokenizer  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "training" / "data"
MODELS_DIR = ROOT / "models" / "flavora-lm"


def _unpack(item: list | tuple) -> tuple[list[int], int]:
    """Accept (ids, target_start) pairs or bare id lists (target_start=1)."""
    if isinstance(item, tuple):
        return item[0], item[1]
    return item, 1


def epoch_batches(ids_list: list, batch_size: int, pad_id: int, rng: torch.Generator):
    """Yield (x, y) batches for one epoch; y is x shifted by one (next-token targets).

    Positions before each example's target_start are masked (-100) so the
    loss trains the structured completion, not the unpredictable prompt.
    """
    order = torch.randperm(len(ids_list), generator=rng).tolist()
    for i in range(0, len(order), batch_size):
        chunk = [_unpack(ids_list[j]) for j in order[i : i + batch_size]]
        maxlen = max(len(c) for c, _ in chunk)
        x = torch.full((len(chunk), maxlen), pad_id, dtype=torch.long)
        for bi, (seq, _start) in enumerate(chunk):
            x[bi, : len(seq)] = torch.tensor(seq, dtype=torch.long)
        # Pad positions in targets get -100 so they are ignored by the loss.
        y = torch.full_like(x, -100)
        for bi, (seq, start) in enumerate(chunk):
            for t in range(max(len(seq) - 1, 0)):
                # y[b,t] predicts x[b,t+1]; mask prompt positions (t+1 < start).
                if t + 1 >= start:
                    y[bi, t] = seq[t + 1]
        yield x, y


def evaluate_loss(model: FlavoraLM, ids_list: list, batch_size: int, pad_id: int) -> float:
    model.eval()
    total, count = 0.0, 0
    with torch.no_grad():
        for i in range(0, len(ids_list), batch_size):
            chunk = [_unpack(s) for s in ids_list[i : i + batch_size]]
            maxlen = max(len(c) for c, _ in chunk)
            x = torch.full((len(chunk), maxlen), pad_id, dtype=torch.long)
            y = torch.full((len(chunk), maxlen), -100, dtype=torch.long)
            for bi, (seq, start) in enumerate(chunk):
                x[bi, : len(seq)] = torch.tensor(seq, dtype=torch.long)
                for t in range(max(len(seq) - 1, 0)):
                    if t + 1 >= start:
                        y[bi, t] = seq[t + 1]
            _, loss = model(x, y)
            # Weight by number of real target positions.
            n = sum(max(len(s) - 1 - st, 0) for s, st in chunk)
            total += loss.item() * n
            count += n
    return total / max(count, 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True)
    ap.add_argument("--data-dir", default=str(DEFAULT_DATA))
    ap.add_argument("--out-dir", default=None, help="override artifact dir (default models/flavora-lm/<version>)")
    ap.add_argument("--max-steps-per-epoch", type=int, default=0, help="cap steps per epoch (debug)")
    args = ap.parse_args()

    cfg_path = Path(args.config)
    full = json.loads(cfg_path.read_text(encoding="utf-8"))
    mcfg = FlavoraLMConfig.from_dict(full)
    tcfg = full.get("training", {})
    ds_cfg = full.get("dataset", {})
    tok_target = full.get("tokenizer", {}).get("vocab_size", mcfg.vocab_size)
    seed = int(tcfg.get("seed", 42))

    print(f"Training {mcfg.model_name} v{mcfg.version} (seed {seed})")
    data_dir = Path(args.data_dir)
    train_raw = read_jsonl(data_dir / "train.jsonl")
    val_raw = read_jsonl(data_dir / "validation.jsonl")
    print(f"  dataset: {len(train_raw)} train / {len(val_raw)} val examples")

    # 1-2. Validate dataset (the builder validates too; this re-checks).
    problems = sum(1 for t, i in train_raw if not t.strip() or not isinstance(i, dict))
    if problems:
        print(f"ERROR: {problems} malformed training examples", file=sys.stderr)
        return 1

    # 3. Train tokenizer on the *training corpus only* (no leakage).
    corpus = [t for t, _ in train_raw]
    t0 = time.time()
    trained = train_tokenizer(corpus, vocab_size=tok_target)
    tok = BPETokenizer(trained.vocab, trained.merges)
    print(f"  tokenizer: {tok.vocab_size} tokens (trained in {time.time() - t0:.1f}s)")

    # The model width must equal the REALIZED vocabulary (not the config
    # target): otherwise embedding/head rows sit untrained and dilute the
    # softmax with dead ids.
    if mcfg.vocab_size != tok.vocab_size:
        print(f"  vocab: config target {mcfg.vocab_size} → realized {tok.vocab_size}")
        mcfg.vocab_size = tok.vocab_size

    # 4. Encode (with target-start masks so the loss trains the completion).
    from training.flavora_lm.dataset import target_start_index

    train_ids = [
        (format_example(tok, t, i, mcfg.context_length), target_start_index(tok, t, mcfg.context_length))
        for t, i in train_raw
    ]
    val_ids = [
        (format_example(tok, t, i, mcfg.context_length), target_start_index(tok, t, mcfg.context_length))
        for t, i in val_raw
    ]

    # 5-6. Batches + model initialized from scratch (random weights).
    model = FlavoraLM(mcfg)
    print(f"  model: {model.num_parameters():,} parameters, context {mcfg.context_length}")

    epochs = int(tcfg.get("epochs", 6))
    batch_size = int(tcfg.get("batch_size", 32))
    lr = float(tcfg.get("learning_rate", 6e-4))
    warmup = int(tcfg.get("warmup_steps", 100))
    grad_clip = float(tcfg.get("grad_clip", 1.0))

    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)

    def lr_at(step: int) -> float:
        if step < warmup:
            return lr * (step + 1) / max(warmup, 1)
        # Cosine decay to 10% of peak.
        progress = (step - warmup) / max(1, (epochs * max(len(train_ids) // batch_size, 1) - warmup))
        return lr * (0.1 + 0.45 * (1 + math.cos(math.pi * min(progress, 1.0))))

    scheduler = torch.optim.lr_scheduler.LambdaLR(opt, lr_at)
    rng = torch.Generator().manual_seed(seed + 1)

    meta = TrainingMeta(
        model=mcfg.model_name,
        version=mcfg.version,
        seed=seed,
        dataset_version=DATASET_VERSION,
        tokenizer_version=TOKENIZER_VERSION,
        epochs=epochs,
        steps=0,
        learning_rate=lr,
        batch_size=batch_size,
        optimizer="adamw+cosine-warmup",
        hardware=hardware_description(),
        python_version=sys.version.split()[0],
        pytorch_version=torch.__version__,
        platform=sys.platform,
    )

    out_dir = Path(args.out_dir) if args.out_dir else MODELS_DIR / f"v{mcfg.version}"
    step = 0
    t0 = time.time()
    best_val = float("inf")

    for epoch in range(epochs):
        model.train()
        running = 0.0
        steps_this = 0
        for x, y in epoch_batches(train_ids, batch_size, tok.pad_id, rng):
            _, loss = model(x, y)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            opt.step()
            scheduler.step()
            step += 1
            steps_this += 1
            running += loss.item()
            if args.max_steps_per_epoch and steps_this >= args.max_steps_per_epoch:
                break

        val_loss = evaluate_loss(model, val_ids, batch_size, tok.pad_id)
        ppl = math.exp(min(val_loss, 20))
        best_val = min(best_val, val_loss)
        meta.steps = step
        meta.final_train_loss = running / max(steps_this, 1)
        meta.final_val_loss = val_loss
        meta.final_val_perplexity = ppl
        print(
            f"  epoch {epoch + 1}/{epochs}  train {meta.final_train_loss:.3f}  "
            f"val {val_loss:.3f}  ppl {ppl:.1f}  ({time.time() - t0:.0f}s)"
        )

        # 9. Checkpoint each epoch (resumable).
        save_checkpoint(
            out_dir / "training_state.pt", model, opt, scheduler, step, epoch + 1, meta,
            val_metrics={"valLoss": val_loss, "valPerplexity": ppl, "trainLoss": meta.final_train_loss},
        )

    # 10-11. Final artifacts: config, tokenizer, model, metadata.
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg_out = dict(full)
    cfg_out["vocab_size"] = tok.vocab_size  # vocab realized from corpus
    (out_dir / "config.json").write_text(json.dumps(cfg_out, indent=2), encoding="utf-8")
    tok.save(out_dir / "tokenizer.json")
    trained_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    model.save_pretrained(out_dir, tokenizer_version=TOKENIZER_VERSION, extra={"trainedAt": trained_at})
    meta.to_dict  # noqa: B018 (keep attribute; metadata saved below)
    (out_dir / "training_meta.json").write_text(json.dumps(meta.to_dict(), indent=2), encoding="utf-8")
    print(f"  artifacts → {out_dir}")
    print(f"  final val loss {best_val:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
