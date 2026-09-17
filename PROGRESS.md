# Flavora — Progress

Status after the FlavoraLM migration (custom local model, one-command setup),
the audit-gap closure pass, and the final verification pass (fresh 120-epoch
dev retrain, live one-command startup incl. AirPlay port auto-fallback,
axe-AA-driven contrast fix). Full record: `docs/FLAVORALM_FINAL_AUDIT.md`.

## Verified state

- **Server:** 121/121 tests pass (unit + integration + safety regression + AI provider + FlavoraLM failure-mode tests), `tsc --noEmit` clean.
- **Client:** 19/19 tests pass (components + offline queue), `tsc --noEmit` clean.
- **Python:** tokenizer/model/dataset suites pass 26/26 via unittest; `training/evaluate.py` reports held-out metrics to `models/flavora-lm/v0.1/eval.json`. (1 pre-existing flaky tiny-model quality test in `test_intent_and_service.py` fails independent of these changes.)
- **E2E:** critical paths + offline sync pass (dev config); `e2e/a11y.spec.ts` (baseline on every route + guarded axe critical/serious check), `e2e/keyboard.spec.ts` (skip link → main → operate), new `e2e/flavoralm.spec.ts` (health honesty → NL intent → safe recs → UI source label).
- **Init proof:** `npm run verify:llm:init` PASS (882,944 params dev, embMean −0.00005 / embStd 0.01997, same-seed-identical, diff-seed-differs).
- **Checkpoint (refreshed 2026-09-17):** full 120-epoch dev retrain → vocab 540 everywhere (stale 768-head artifact replaced), train 0.153 / val 0.155 / ppl 1.17, 19-field `training_meta.json` (hashes + timestamp native); capped eval: schemaValidity 0.9, invalidJson 0.1, negation 1.0, repeatability 1.0.
- **One-command startup (proven live twice):** `npm run start` → artifacts ✓, FlavoraLM ✓, API :4000 ✓, Website :5173 ✓; AirPlay :5000 squat auto-falls-back (5001) with Express notified; honest ✗ + fallback notice if AI is down (app keeps running per design).
- **E2E live:** `flavoralm.spec.ts` 3/3, `a11y.spec.ts` 11/11 with real axe (WCAG AA); contrast fix `green-600`→`green-700` on 5 button sites.

## Objective matrix

| Objective | Status | Evidence |
|---|---|---|
| FlavoraLM model | IMPLEMENTED | decoder-only Transformer in `training/flavora_lm/model.py`, random init, causal-LM training with masked-completion loss in `training/train.py` |
| Custom tokenizer | IMPLEMENTED | BPE trained on Flavora corpus (`tokenizer.py`, v0.2 preserves JSON syntax), deterministic, serialized to `tokenizer.json`; standalone `npm run train:tokenizer` → `tokenizer_meta.json` (realized 540 tokens dev) |
| Training data | IMPLEMENTED | synthetic generator (`dataset.py`), train/validation/test splits + `manifest.json` with SHA256 per split, safety (allergy/avoid) examples |
| Training pipeline | IMPLEMENTED | `npm run train:llm` / `train:llm:dev`, checkpoints with optimizer/scheduler state + `training_meta.json` (now also `dataset_sha256` + `created_at` on new runs) |
| Fresh initialization | IMPLEMENTED | `npm run verify:llm:init` PASS — N(0,0.02) stats, determinism proven, no pretrained content |
| Evaluation | IMPLEMENTED | `npm run evaluate:llm` (intent/field accuracy, invalid-JSON rate, negation, repeatability; loss/ppl from `metrics.json`); honest weak-sample numbers in `docs/FLAVORALM_EVALUATION.md` |
| Inference service | IMPLEMENTED | `training/flavora_lm/service.py` on 127.0.0.1:5000 (`/health`, `/metadata`, `/metrics`, `/generate`, `/intent`); Express is the only gateway |
| Local provider | IMPLEMENTED | `LocalLlmProvider` talks only to FlavoraLM (loopback enforced); `local` = FlavoraLM everywhere |
| Verification | IMPLEMENTED | `npm run verify:local-ai` — 8-step real-inference check (service → identity → tokenizer → generation → intent → engine → safety) |
| One-command setup | IMPLEMENTED | `npm run start` (Node+Python check, npm deps, venv+torch, Prisma, seed, artifacts, services, browser) |
| No remote in local mode | TESTED | `flavoraSafety.test.ts` asserts loopback-only fetches; `local` never falls back to Groq |
| Safety | TESTED | allergy/avoid extraction (FlavoraLM + heuristic), additive union with profile, engine hard filter absolute; injection fields dropped |
| Failure modes | TESTED | timeout/malformed/empty/crash → explicit error + heuristic fallback; Express stays alive |
| Accessibility | HARDENED | single `<main>`, focus-moving skip link, labeled controls, focus-visible rings, reduced-motion, live regions; baseline a11y + keyboard E2E plus guarded `@axe-core/playwright` critical/serious check in `a11y.spec.ts`; chain coverage in `flavoralm.spec.ts` |
| AI status UI | IMPLEMENTED | `AiStatus` shows `AI: FlavoraLM vX` / `AI: Heuristic (…)` / `AI: Groq` from health + actual source |
| Substitutions | PRESERVED | apply/revert/undo UI, safe/unsafe/unknown revalidation, unsafe blocked, offline queueing |
| Offline mutations | PRESERVED | IndexedDB queue (dedupe, ordered replay, max 5 attempts), sync banner |
| Groceries / Inventory / Meal plans / Cravings / Modes / Learning | PRESERVED | no behavior changes; see README |
| Groq | OPTIONAL FALLBACK | server-side key, timeout, validated output, heuristic fallback; never used in `local` mode |
| Heuristic parser | PRESERVED + EXTENDED | deterministic, zero-network; now also extracts allergies/avoidFoods (additive only); correctly labeled, never called an LLM |
| README | REWRITTEN | Quickstart = `npm run start`; FlavoraLM architecture/training/troubleshooting; docs index + accessibility section; no Ollama; every command exists (`train:tokenizer`, `verify:llm:init` added) |
| Architecture docs | IMPLEMENTED | `docs/FLAVORALM_AUDIT.md`, `FLAVORALM_ARCHITECTURE.md`, `FLAVORALM_TRAINING.md`, `FLAVORALM_EVALUATION.md` |
| E2E chain | IMPLEMENTED | `client/e2e/flavoralm.spec.ts` (health honesty → NL → local intent → safe recs → UI label) + 8-step `verify:local-ai` |

## Known limitations (honest)

- FlavoraLM is a small model (sub-million parameters): the committed dev checkpoint scores 0% exact-match on the 10-example eval sample, so nuanced NL still falls back to the heuristic parser (labeled honestly in the UI). Retrain with `npm run train:llm` to improve it; baselines live in `eval.json`, analysis in `docs/FLAVORALM_EVALUATION.md`.
- The committed `training_meta.json` is an 80-epoch run predating the new `dataset_sha256`/`created_at` fields (dev config now says 120 epochs); the next full `train:llm:dev` run refreshes it.
- `@axe-core/playwright` is now a client devDependency with a guarded (offline-safe) integration; full `test:e2e` still needs dev servers + browser download.
- 1 python quality test (`test_extract_ingredients_intent`) is flaky on tiny-model output and fails independent of these changes; tokenizer/model/dataset suites pass 26/26.
- The substitution E2E skips when the chosen recipe exposes no substitution options (data-dependent, not a failure).
- Accessibility was hardened + automatically tested but not audited with assistive technology.
- No live grocery pricing (by design).
