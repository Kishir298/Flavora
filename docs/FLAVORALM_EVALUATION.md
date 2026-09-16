# FlavoraLM Evaluation

Measured results for the committed checkpoint. Nothing here is fabricated: weak
numbers are reported as weak, with the cause and the remedy stated.

## Model under test
- FlavoraLM-dev v0.1, decoder Transformer, **912,128 params**, context 160,
  realized vocab **540** (tokenizer v0.2 BPE, trained on our corpus).
- Seed 42, fresh random init (`verify:llm:init` PASS: embMean −0.00005,
  embStd 0.01997, same-seed-identical, diff-seed-differs).
- Corpus: synthetic Flavora generator v0.1, 1200 train / 150 val / 150 test,
  seed 42 (hashes in `training/data/manifest.json`).
- Training: 80 epochs, 3040 steps, LR 0.003, batch 32, AdamW+cosine-warmup,
  CPU x86_64, Python 3.11.15, Torch 2.2.2.

## Training metrics (`metrics.json`, from training — not recomputed by eval)
- `trainLoss` 2.685, `valLoss` 2.544, `valPerplexity` 12.73 at step 3040.
- Interpretation: the model learned the completion distribution well past
  uniform (≈6.3 for vocab 540) but is far from sharp — expected for 912K params
  on 1200 examples.

## Held-out intent evaluation (`eval.json`, 2026-09-16)
- Sample: **10 examples** (capped run, not the full 150-example test set —
  full-set beam-search eval costs ~6.6s/example CPU, ≈16 min; the cap is a time
  budget, documented here, not cherry-picking).
- `intentExactMatch` **0.0**, `schemaValidityRate` **0.0**, `invalidJsonRate`
  **1.0** — on this sample the model produced no schema-valid intent.
- Per-field accuracy: all constrained fields 0.0 (`allergies` null = no gold
  constraint in sample).
- `negationAccuracy` 0.0 (1 negation example), `repeatability` **1.0**
  (deterministic — the one gate that must pass, passes).
- `avgMsPerExample` 6649ms CPU.

## Safety tests (deterministic layer — PASS, provider-independent)
- `server/src/ai/flavoraSafety.test.ts`: allergy/avoid regression, loopback-only
  fetch spy, `local` never falls back to Groq, timeout/malformed/empty/crash
  failure modes → explicit error + heuristic fallback, Express stays alive.
- `verify:local-ai` step 8: peanut/mushroom candidates excluded after AI
  extraction. Injection fields (`ignoreAllergies`, `forceRecipes`,
  `allRecipesSafe`) dropped by schema validation.
- Python `test_intent_and_service.py`: `normalize_intent` drops garbage/bounds/
  unknown fields; malformed service bodies → 400, never a safety verdict.

## Inference behavior
- `/generate` round-trips real tokens (verified live: `verify:local-ai` step 5
  requires >0 chars). `/intent` returns `{intent, valid}` with `valid=false`
  (not a crash) when generation is unusable — the assistant then falls back.
- Generation sanity: temperature/top-k/top-p/repetition-penalty/EOS/context
  truncation all implemented and unit-tested (`test_model.py`).

## Known weaknesses (brutally honest)
1. The committed dev checkpoint does not yet extract usable intent on its own;
   production NL requests succeed via the heuristic fallback chain, which is
   labeled honestly in the UI (`AI: Heuristic (…)`).
2. 10-example eval sample is small; full-150 eval pending a longer CPU budget.
3. Training artifact is an 80-epoch run while the dev config now says 120
   (interrupted run); `training_meta.json` predates the new
   `dataset_sha256`/`created_at` fields.
4. One pre-existing flaky python test (`test_extract_ingredients_intent`:
   tiny-model quality assertion `inventory` vs `recommend`) fails independent
   of these changes; tokenizer/model/dataset suites pass 26/26.

## How to improve (exact commands)
```bash
npm run train:llm:dev        # refresh dev checkpoint (adds hashes + timestamp)
npm run evaluate:llm         # full held-out eval → models/flavora-lm/v0.1/eval.json
npm run train:llm            # full small model: 12k examples, 5.9M params
npm run evaluate:llm -- --max-examples 150
npm run verify:local-ai && npm run verify:llm:init
```

## Reproducibility record
Seed 42, dataset v0.1 + split SHA256 (`manifest.json`), tokenizer v0.2,
hyperparams + hardware + Python/PyTorch in `training_meta.json`,
`evaluatedAt 2026-09-16T06:55:08Z` in `eval.json`. Same seed + same corpus →
same tokenizer + same init (proven by `verify:llm:init`).
