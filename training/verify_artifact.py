#!/usr/bin/env python
"""Verify the FlavoraLM production artifact end-to-end (checkpoint content, not just existence).

Uses the project's own loaders (FlavoraLM.load_pretrained / BPETokenizer.load)
to prove that config.json, tokenizer.json, model.pt and model_meta.json agree:
  - checkpoint loads without exception
  - tensor dimensions match the stored config
  - tokenizer vocabulary size == model vocabulary dimension
  - metadata parameterCount == actual counted parameters
  - model can enter evaluation mode, run a forward pass, and generate tokens
  - decoded output is valid text

Usage:
    .flavoralm-venv/bin/python -m training.verify_artifact --artifacts models/flavora-lm/v0.1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch  # noqa: E402

from training.flavora_lm.model import FlavoraLM  # noqa: E402
from training.flavora_lm.tokenizer import BPETokenizer  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifacts", default=str(ROOT / "models" / "flavora-lm" / "v0.1"))
    ap.add_argument("--prompt", default="<USER> Find me a quick chicken dinner <ASSISTANT>")
    args = ap.parse_args()

    d = Path(args.artifacts)
    checks: list[tuple[str, bool, str]] = []

    # 1. Required files exist.
    for name in ("config.json", "tokenizer.json", "model.pt", "model_meta.json"):
        checks.append((f"file:{name}", (d / name).is_file(), str(d / name)))

    # 2. Checkpoint loads with the project's own loader.
    try:
        model = FlavoraLM.load_pretrained(d, map_location="cpu")
        checks.append(("checkpoint loads via load_pretrained", True, ""))
    except Exception as e:  # noqa: BLE001
        checks.append(("checkpoint loads via load_pretrained", False, str(e)))
        _report(checks)
        return 1

    tok = BPETokenizer.load(d / "tokenizer.json")
    cfg = model.cfg
    meta = json.loads((d / "model_meta.json").read_text(encoding="utf-8"))
    cfg_disk = json.loads((d / "config.json").read_text(encoding="utf-8"))

    # 3. Tensor dimensions match the stored config.
    emb = model.tok_emb.weight.shape
    pos = model.pos_emb.weight.shape
    n_blocks = len(model.blocks)
    ff_in = model.blocks[0].ff[0].weight.shape
    checks += [
        ("embedding vocab dim == config.vocab_size", emb[0] == cfg.vocab_size, f"{emb[0]} vs {cfg.vocab_size}"),
        ("embedding dim == config.embedding_dim", emb[1] == cfg.embedding_dim, f"{emb[1]} vs {cfg.embedding_dim}"),
        ("positional rows == config.context_length", pos[0] == cfg.context_length, f"{pos[0]} vs {cfg.context_length}"),
        ("block count == config.layers", n_blocks == cfg.layers, f"{n_blocks} vs {cfg.layers}"),
        ("ff dim == config.feed_forward_dim", ff_in[0] == cfg.feed_forward_dim, f"{ff_in[0]} vs {cfg.feed_forward_dim}"),
        ("heads divide embedding dim", cfg.embedding_dim % cfg.attention_heads == 0, f"{cfg.embedding_dim}/{cfg.attention_heads}"),
    ]

    # 4. Tokenizer vocabulary matches the model vocabulary.
    checks.append(("tokenizer vocab size == model vocab dim", tok.vocab_size == cfg.vocab_size,
                   f"{tok.vocab_size} vs {cfg.vocab_size}"))

    # 5. Parameter count is counted, not estimated.
    actual_params = model.num_parameters()
    checks.append(("metadata parameterCount == actual", meta.get("parameterCount") == actual_params,
                   f"{meta.get('parameterCount')} vs {actual_params}"))
    checks.append(("checkpoint config == config.json", cfg.to_dict() == {
        k: v for k, v in cfg_disk.items() if k in cfg.to_dict()}, ""))

    # 6. eval mode + forward pass with finite logits.
    model.eval()
    model.train(False)
    checks.append(("model.eval() ok", not model.training, ""))
    with torch.no_grad():
        idx = torch.tensor([[tok.bos_id if hasattr(tok, "bos_id") else 0, 5, 6, 7]], dtype=torch.long)
        logits, _ = model(idx)
    checks.append(("forward pass finite logits", bool(torch.isfinite(logits).all()) and tuple(logits.shape) == (1, 4, cfg.vocab_size),
                   f"shape {tuple(logits.shape)}"))

    # 7. Generation produces decodable text.
    gen = model.generate(
        torch.tensor([tok.encode(args.prompt, add_special=False)], dtype=torch.long),
        max_new_tokens=24,
        temperature=0.7,
        top_k=40,
        top_p=0.9,
        eos_id=tok.eos_id,
    )
    new_ids = gen[0, 1:].tolist()
    text = tok.decode(new_ids, skip_special=True)
    checks.append(("generation produces text", isinstance(text, str) and len(text) > 0, f"{len(new_ids)} tokens"))

    _report(checks)
    print(f"\nmodel={cfg.model_name} v{cfg.version}  params={actual_params:,}  vocab={cfg.vocab_size}  "
          f"ctx={cfg.context_length}  layers={cfg.layers}  heads={cfg.attention_heads}  ff={cfg.feed_forward_dim}")
    print(f"sample generation: {text[:120]!r}")
    ok = all(p for _, p, _ in checks)
    print("VERIFY:ARTIFACT " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def _report(checks: list[tuple[str, bool, str]]) -> None:
    width = max(len(name) for name, _, _ in checks)
    for name, passed, detail in checks:
        mark = "\x1b[32mPASS\x1b[0m" if passed else "\x1b[31mFAIL\x1b[0m"
        print(f"{name.ljust(width)}  {mark}  {detail}")


if __name__ == "__main__":
    raise SystemExit(main())
