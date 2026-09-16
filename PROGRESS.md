# Flavora — Progress

Status after the FlavoraLM migration (custom local model, one-command setup).

## Verified state

- **Server:** 121/121 tests pass (unit + integration + safety regression + AI provider + FlavoraLM failure-mode tests), `tsc --noEmit` clean.
- **Client:** 19/19 tests pass (components + offline queue), `tsc --noEmit` clean.
- **Python:** tokenizer/dataset/model unit tests pass; `training/evaluate.py` reports held-out metrics to `models/flavora-lm/v0.1/eval.json`.
- **E2E:** critical paths + offline sync pass (dev config); new `e2e/a11y.spec.ts` (landmarks, labels, button names, duplicate IDs, alts, ARIA refs on every page) and `e2e/keyboard.spec.ts` (skip link → main → operate) added.

## Objective matrix

| Objective | Status | Evidence |
|---|---|---|
| FlavoraLM model | IMPLEMENTED | decoder-only Transformer in `training/flavora_lm/model.py`, random init, causal-LM training with masked-completion loss in `training/train.py` |
| Custom tokenizer | IMPLEMENTED | BPE trained on Flavora corpus (`tokenizer.py`, v0.2 preserves JSON syntax), deterministic, serialized to `tokenizer.json` |
| Training data | IMPLEMENTED | synthetic generator (`dataset.py`), train/validation/test splits + `manifest.json`, safety (allergy/avoid) examples |
| Training pipeline | IMPLEMENTED | `npm run train:llm` / `train:llm:dev`, checkpoints with optimizer/scheduler state + `training_meta.json` |
| Evaluation | IMPLEMENTED | `npm run evaluate:llm` (intent/field accuracy, invalid-JSON rate, negation, repeatability) |
| Inference service | IMPLEMENTED | `training/flavora_lm/service.py` on 127.0.0.1:5000 (`/health`, `/generate`, `/intent`); Express is the only gateway |
| Local provider | IMPLEMENTED | `LocalLlmProvider` talks only to FlavoraLM (loopback enforced); `local` = FlavoraLM everywhere |
| Verification | IMPLEMENTED | `npm run verify:local-ai` — 8-step real-inference check (service → identity → tokenizer → generation → intent → engine → safety) |
| One-command setup | IMPLEMENTED | `npm run start` (Node+Python check, npm deps, venv+torch, Prisma, seed, artifacts, services, browser) |
| No remote in local mode | TESTED | `flavoraSafety.test.ts` asserts loopback-only fetches; `local` never falls back to Groq |
| Safety | TESTED | allergy/avoid extraction (FlavoraLM + heuristic), additive union with profile, engine hard filter absolute; injection fields dropped |
| Failure modes | TESTED | timeout/malformed/empty/crash → explicit error + heuristic fallback; Express stays alive |
| Accessibility | HARDENED | single `<main>`, focus-moving skip link, labeled controls, focus-visible rings, reduced-motion, live regions; automated a11y + keyboard E2E |
| AI status UI | IMPLEMENTED | `AiStatus` shows `AI: FlavoraLM vX` / `AI: Heuristic (…)` / `AI: Groq` from health + actual source |
| Substitutions | PRESERVED | apply/revert/undo UI, safe/unsafe/unknown revalidation, unsafe blocked, offline queueing |
| Offline mutations | PRESERVED | IndexedDB queue (dedupe, ordered replay, max 5 attempts), sync banner |
| Groceries / Inventory / Meal plans / Cravings / Modes / Learning | PRESERVED | no behavior changes; see README |
| Groq | OPTIONAL FALLBACK | server-side key, timeout, validated output, heuristic fallback; never used in `local` mode |
| Heuristic parser | PRESERVED + EXTENDED | deterministic, zero-network; now also extracts allergies/avoidFoods (additive only); correctly labeled, never called an LLM |
| README | REWRITTEN | Quickstart = `npm run start`; FlavoraLM architecture/training/troubleshooting; no Ollama; no imaginary commands |

## Known limitations (honest)

- FlavoraLM is a small model (sub-million parameters): intent extraction works for typical requests but nuanced prose falls back to the heuristic parser. Retrain with `npm run train:llm` to improve it; evaluation baselines live in `eval.json`.
- npm registry TLS is blocked in some sandboxes, so no new npm packages (e.g. axe-core) can be installed there; the committed a11y suite is dependency-free and runs offline.
- The substitution E2E skips when the chosen recipe exposes no substitution options (data-dependent, not a failure).
- Accessibility was hardened + automatically tested but not audited with assistive technology.
- No live grocery pricing (by design).
