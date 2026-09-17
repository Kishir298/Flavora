# FlavoraLM training

FlavoraLM is Flavora's own small language model: a decoder-only Transformer
(`flavora_lm/model.py`) with a custom BPE tokenizer (`flavora_lm/tokenizer.py`),
randomly initialized and trained on a Flavora-specific synthetic corpus.
No pretrained weights, no pretrained tokenizer, no external data.

## Commands (repo root)

```bash
npm run train:tokenizer # standalone BPE training → tokenizer.json + tokenizer_meta.json
npm run train:llm:dev   # fast dev model → models/flavora-lm/dev/ (minutes, CI-sized)
npm run train:llm       # full small model → models/flavora-lm/v0.1/ (1–3h CPU)
npm run evaluate:llm    # held-out evaluation → models/flavora-lm/v0.1/eval.json
npm run verify:llm:init # prove weights are freshly initialized (no pretrained content)
npm run lm:serve        # run the inference service manually (127.0.0.1:5000)
```

Direct (venv) equivalents:

```bash
.flavoralm-venv/bin/python -m training.build_dataset --config training/configs/flavora_lm_dev.json
.flavoralm-venv/bin/python -m training.train --config training/configs/flavora_lm_dev.json
.flavoralm-venv/bin/python -m training.evaluate --artifacts models/flavora-lm/v0.1
.flavoralm-venv/bin/python -m training.flavora_lm.service
```

## Pipeline (`train.py`)

1. Load dataset (`training/data/{train,validation}.jsonl`) + validate.
2. Train tokenizer on the **training corpus only** (no leakage) → `tokenizer.json`.
3. Encode examples as `<BOS><USER> {input} <ASSISTANT> {json} <EOS>`.
4. Initialize the Transformer from scratch (random weights, seed recorded).
5. Train with causal next-token prediction; the cross-entropy loss is **masked
   to the completion** (`<ASSISTANT>` onward) so gradient focuses on the
   structured JSON suffix, not the unpredictable prompt words. AdamW +
   cosine warmup schedule, gradient clipping, per-epoch validation.
6. Checkpoint every epoch (`training_state.pt`: weights, optimizer,
   scheduler, step/epoch, config, tokenizer version, metrics, seed).
7. Save final artifacts + `training_meta.json` (seed, dataset/tokenizer
   versions, hyperparams, hardware, Python/PyTorch versions).

## Data (`flavora_lm/dataset.py`, `build_dataset.py`)

Synthetic, original-to-Flavora examples: ingredients/time/cuisine requests,
cravings, spice preferences, allergy + avoid-food safety examples, modes,
misspellings, negation, filler/irrelevant words. Split deterministically by
seed (no train/val/test overlap). `test.jsonl` is held out for `evaluate.py`
only — never train on it.

## Inference (`flavora_lm/service.py`)

Stdlib HTTP service (no web-framework dependency), binds `127.0.0.1`:

- `GET /health` → `{status, model, version, parameterCount, contextLength,
  tokenizerVersion, loaded, device}` (all measured).
- `GET /metadata` → `training_meta.json` sidecar (reproducibility record).
- `GET /metrics` → `metrics.json` sidecar (latest training loss/perplexity).
- `POST /generate` → autoregressive sampling (`temperature`, `topK/topP`,
  `maxNewTokens`, repetition handling).
- `POST /intent` → greedy (near-deterministic) generation → JSON parse →
  schema validation/normalization (`flavora_lm/intent.py`). Invalid output
  yields `{"intent": null, "valid": false}` — never a crash, never a safety
  verdict. The deterministic engine remains the safety authority.

## Reproducibility

Every run records seed, dataset/tokenizer versions, config, optimizer, LR,
batch size, epochs/steps, hardware, and Python/PyTorch versions in
`training_meta.json`. Same seed + same corpus → same tokenizer + same init.
