# FlavoraLM Training

How FlavoraLM was produced, end to end. Someone cloning the repo should be able
to reproduce every artifact from the commands below. No downloads, no pretrained
anything — training runs locally from the synthetic corpus generator.

## Corpus preparation

```bash
.flavoralm-venv/bin/python -m training.build_dataset --config training/configs/flavora_lm_dev.json
# or: npm run train:llm:dev (builds dataset first if training/data is stale)
```

`training/flavora_lm/dataset.py:generate_examples(n, seed)` synthesizes
original-to-Flavora examples: ingredient/time/cuisine requests, cravings
(flavor/texture/temperature/spice/mood), dietary preferences, allergies +
avoid-foods safety examples, budget/food-waste modes, meal planning, grocery
lists, substitutions, saved recipes, negative constraints, compound + ambiguous
requests, misspellings, filler words. No copyrighted scraping; no copied recipes.

`build_dataset.py` draws one deterministic stream and splits by index (no
train/val/test overlap), validates every example (intent=time bounds/spice/mode
enums/list types/no unknown fields), writes
`training/data/{train,validation,test}.jsonl` + `manifest.json`:

- dev: 1200 train / 150 validation / 150 test, seed 42, dataset v0.1
- small: 12000 / 1200 / 1000, seed 42
- `manifest.json` records `datasetVersion`, `seed`, split counts, and **SHA256
  per split** (current dev hashes: `train 7aba70b7…`, `validation b33d6dee…`,
  `test fe905f64…`).

## Tokenizer training

```bash
npm run train:tokenizer
npm run train:tokenizer -- --config training/configs/flavora_lm_small.json
# venv equivalent:
.flavoralm-venv/bin/python -m training.train_tokenizer --config training/configs/flavora_lm_dev.json
```

Trains on the **training corpus only** (no validation/test leakage) with the
same deterministic `train_tokenizer()` that `train.py` uses. Output:
`models/flavora-lm/v0.1/tokenizer.json` + `tokenizer_meta.json` recording
vocab size/target, special tokens, normalization (`lowercase, whitespace split,
edge-strip .,!?;()'`), pre-tokenization (JSON singletons split, never merged),
corpus SHA256, config path, seconds, plus a determinism self-check
(double-encode equality + decode round-trip).

Documented values (dev): tokenizer v0.2, target 768 → **realized 540** (the
corpus only supports 540 distinct BPE merges; the model width follows the
realized vocab — see below). Repro: same seed + same corpus → same tokenizer.

## Dataset creation (structured intent)

Intent examples carry structured targets matching `server/src/ai/intentSchema.ts`
— there is exactly one intent schema, shared by model output, heuristic parser,
and Express validation:

```json
{ "text": "I want something spicy, quick, high protein and I don't want peanuts",
  "intent": { "spiceLevel": "hot", "maxCookingTime": 30,
              "preferences": { "highProtein": true }, "avoidFoods": ["peanuts"] } }
```

Covered: recipe/ingredient/cuisine search, cravings, flavor/texture/temperature/
spice/mood, dietary preferences, allergies, avoid-foods, time, skill, nutrition,
budget, food waste, inventory, meal planning, groceries, substitutions, saved
recipes, negative constraints, compound + ambiguous requests.

## Model initialization

```bash
npm run verify:llm:init
```

`training/verify_init.py` rebuilds from the config seed and asserts:
same-seed-identical weights, different-seed-differs, embedding stats in
`N(0, 0.02)` range, finite forward logits of shape `(B, T, vocab)`.
Measured (dev, seed 42): `embMean -0.00005, embStd 0.01997`, 882,944 params (540-vocab checkpoint, 2026-09-17) —
textbook fresh random init, zero pretrained content.

## Training command

```bash
npm run train:llm:dev   # fast dev model → models/flavora-lm/dev/ (minutes, CI-sized, untracked)
npm run train:llm       # full small model → models/flavora-lm/v0.1/ (1–3h CPU, 4,947,456 params measured)
```

`training/train.py` pipeline: load + validate splits → train tokenizer on train
corpus → adjust model width to **realized** vocab → encode with
`<BOS><USER>…<ASSISTANT>…<EOS>` + `target_start_index` masks → random-init
`FlavoraLM` → AdamW + cosine-warmup, grad clip, per-epoch validation →
per-epoch `training_state.pt (intentionally untracked)` → final artifacts.

Committed dev checkpoint (`training_meta.json`): seed 42, 80 epochs, 3040
steps, LR 0.003 (warmup 50), batch 32, AdamW+cosine, CPU x86_64, Python 3.11.15,
Torch 2.2.2, darwin; `train 2.685 / val 2.544 / ppl 12.73`.
Note: the dev config now specifies 120 epochs while the committed artifact
records 80 (an interrupted/older run) — the next full `train:llm:dev` run will
also record `dataset_sha256` + `created_at` (fields added after this artifact
was written). Retrain to refresh; `npm run start` never retrains on its own.

## Checkpoint generation

Per-epoch `save_checkpoint()` + final `save_pretrained()` write
`models/flavora-lm/v0.1/`: `config.json` (realized `vocab_size` 540),
`tokenizer.json`, `tokenizer_meta.json`, `model.pt`, `training_state.pt (intentionally untracked)`,
`metrics.json`, `training_meta.json`, `model_meta.json` (`trainedAt`).

## Evaluation

```bash
npm run evaluate:llm   # → models/flavora-lm/v0.1/eval.json
```

`training/evaluate.py` reports intent exact-match, schema validity,
invalid-JSON rate, per-field accuracy, negation accuracy, repeatability
(hard gate: must be 1.0), avg ms/example. Validation loss/perplexity come from
`metrics.json` (recorded during training), not recomputed here. Full numbers in
`docs/FLAVORALM_EVALUATION.md` — honest, including the model's weaknesses.

## Reproducibility

Every run records seed, dataset version + hashes, tokenizer version, config,
optimizer, LR, batch size, epochs/steps, hardware, Python/PyTorch versions, and
creation timestamp. Same seed + same corpus → same tokenizer + same init.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `verify:local-ai` → service FAIL | `npm run start` (launches service) or `npm run lm:serve` |
| Port 5000 busy on macOS (AirPlay) | `npm run start` auto-falls-back to a free port and notifies Express; manual override `FLAVORA_LM_PORT=5001` also works |
| Model not loaded | Check `models/flavora-lm/v0.1/model.pt`; `npm run train:llm:dev` |
| `.flavoralm-venv` broken | Delete it, `npm run setup` (recreates + installs torch CPU) |
| Python < 3.11 | Install 3.11+, re-run |
| `train.py` vocab message | Normal: target → realized adjustment (e.g. 768 → 540) |

## Limitations (honest)

Sub-million-param CPU model on a 1200-example synthetic corpus: typical intent
requests work; nuanced prose falls back to the heuristic parser by design.
`eval.json` documents the gap (0% exact-match on the sampled eval). Retrain
with `npm run train:llm` (12k examples, 5.9M params) to improve it. Budget uses
authored cost tiers, never live prices; expiry dates are user estimates, never
food-safety verdicts.
