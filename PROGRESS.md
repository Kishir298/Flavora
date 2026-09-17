# Flavora — Progress

## Product acceptance matrix (2026-09-17, verified live)

| Objective               | Status | Implementation | Tests | Evidence |
| ----------------------- | ------ | -------------- | ----- | -------- |
| Working navigation      | Done | 11 destinations, NavLink active state, refresh/back/deep-link | `nav.test.tsx` 12, `navbar.spec.ts` E2E | E2E clicks every item, aria-current asserted |
| Dashboard               | Done | Real weekly stats, goals, recent meals, insights; honest empty state | `dashboard.test.tsx`, `foodlog`/`journey` E2E | Values asserted against fixtures + live store |
| Food logging            | Done | Full CRUD, 5 types incl. Other, datetime, servings, macros, tags/notes, search/filter, water quick-log | store 8, meals API 3, client 3, journey E2E | Restart-persistence test; live reload verified |
| Local JSON datastore    | Done | `data/user-data.json`, atomic writes, validation, corruption backup, versioned | 8 store tests incl. corrupt/restart | `userDataStore.test.ts`; gitignored user data |
| Data persistence        | Done | JSON (meals/goals/water) + Prisma (recipes/inventory/etc.), one source per domain | Restart + reload E2E | Journey E2E reload step; `FOODLOG_ARCHITECTURE.md` |
| Profile/goals           | Done | ProfileForm + numeric goals form (Settings), same goals feed stats | Client + API tests, journey sets goals first | `PUT /api/goals` round-trip test |
| Deterministic analytics | Done | Daily/weekly/monthly, timing, averages, cuisine, waste, 30-day deltas, UTC | 12 stats tests incl. boundaries | Fixture math asserted (1560 kcal, 1.3/d) |
| Statistics page         | Done | Insights page: activity, nutrition, variety, goals, timing, waste; SVG + text summaries | E2E asserts average + activity | Live screenshots at 390px without overflow |
| Eating insights         | Done | Neutral habit observations; language-ban tests; waste/timing/30-day | Ban sweep + waste/timing tests | `stats.test.ts`; no medical claims by construction |
| Recipes                 | Done (preserved) | Browse/search/detail/save/subs unchanged; safety filters intact | Existing suites 140 server | `critical.spec.ts` profile→save green |
| Meal planning           | Done (preserved) | Slots/servings/groceries unchanged; offline servings-op fix | Journey E2E plan→groceries | `meal plan → add → groceries` green |
| Groceries               | Done (preserved) | CRUD/restore/generate unchanged | Existing + journey chain | Live generate asserted in journey |
| Inventory               | Done (preserved) | CRUD/expiry unchanged; case-insensitive search fix | `offline.spec.ts` inventory flow | Live + offline verified |
| Food waste              | Done | Expiry statuses → stats `waste` + insights + assistant `waste` context | Waste unit + route tests | Live `waste:{expiring,expired}` in stats JSON |
| Assistant               | Done | NL + week-summary/yesterday/repeats/goals/waste contexts from stored facts | 5 boundary tests incl. lying prompt | Facts beat fabricated numbers, live |
| FlavoraLM               | Done (preserved) | Production v0.1 checkpoint, service, loopback provider, fallbacks | `verify:local-ai` 8/8, init PASS | Prior audit record unchanged |
| Offline operation       | Done | Meal-log queue + replay (tested), dashboard/stats local, PWA shell | `mealQueue.test.ts`, offline inventory E2E | Same IndexedDB path as groceries |
| Safety                  | Done | Hard filter first, additive-only AI exclusions, schema validation | 27 safety/local tests | Peanut exclusion live in journey + E2E |
| Accessibility           | Done | Landmarks, labels, focus, chart text summaries, skip link | a11y suite incl. new routes | 13/13 + status test green |
| Responsive UI           | Done | Flex-wrap nav, grids collapse, SVG scales | `mobile.spec.ts` 390px | No horizontal overflow on 4 pages |
| E2E user journey        | Done | `journey.spec.ts`: goals→3 meals→dashboard→insights→plan→groceries→assistant→reload | 1 E2E green | 14.7s live run |
| Documentation           | Done | README food-intelligence section, `FOODLOG_ARCHITECTURE.md`, this matrix | — | Docs match implementation |

Known limitations: full 1000-example `evaluate.py` not run (hardware); `favorites` store field reserved without UI (documented); 1 pre-existing flaky Python test; NL E2E timing-sensitive under CPU load (serial runs green).

## Prior verification record

## Verified state

- **Server:** 121/121 tests pass (unit + integration + safety regression + AI provider + FlavoraLM failure-mode tests), `tsc --noEmit` clean.
- **Client:** 19/19 tests pass (components + offline queue), `tsc --noEmit` clean.
- **Python:** tokenizer/model/dataset suites pass 26/26 via unittest; `training/evaluate.py` reports held-out metrics to `models/flavora-lm/v0.1/eval.json`. (1 pre-existing flaky tiny-model quality test in `test_intent_and_service.py` fails independent of these changes.)
- **E2E:** critical paths + offline sync pass (dev config); `e2e/a11y.spec.ts` (baseline on every route + guarded axe critical/serious check), `e2e/keyboard.spec.ts` (skip link → main → operate), new `e2e/flavoralm.spec.ts` (health honesty → NL intent → safe recs → UI source label).
- **Init proof:** `npm run verify:llm:init` PASS on production-small config (fresh random init, same-seed-identical, diff-seed-differs); dev-config proof recorded 882,944 params dev (embMean −0.00005 / embStd 0.01997).
- **Checkpoint (production, verified 2026-09-17):** authoritative `models/flavora-lm/v0.1/` = FlavoraLM v0.1 production-small (6L/8H/d256/ctx256, vocab 4096→558 realized, **4,947,456 params** counted, 12ep/4500 steps, 12k/1.2k/1k, train 4.074/val 3.875/ppl 48.20). `verify_artifact` 17/17, `verify:local-ai` 8/8 (pinned message now avoid+ingredients), server 121/121, client 19/19, e2e 3/3, `npm run start` one-command PASS incl. AirPlay fallback + SIGINT cleanup. Full 1000-ex `evaluate.py` not run here (~200s/ex CPU). Dev-checkpoint history retained in `docs/FLAVORALM_FINAL_AUDIT.md`.
- **Checkpoint (dev history, refreshed 2026-09-17):** full 120-epoch dev retrain → vocab 540 everywhere (stale 768-head artifact replaced), train 0.153 / val 0.155 / ppl 1.17, 19-field `training_meta.json` (hashes + timestamp native); capped eval: schemaValidity 0.9, invalidJson 0.1, negation 1.0, repeatability 1.0.
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

- FlavoraLM production checkpoint (4,947,456 params) extracts usable intent for allergy/avoid + simple ingredient prompts (`verify:local-ai` 8/8 with pinned avoid+ingredients message); other nuanced NL still falls back to the heuristic parser (labeled honestly in the UI). Retrain with `npm run train:llm` to improve it; training metrics live in `metrics.json`, analysis in `docs/FLAVORALM_EVALUATION.md`.
- The committed `training_meta.json` is an 80-epoch run predating the new `dataset_sha256`/`created_at` fields (dev config now says 120 epochs); the next full `train:llm:dev` run refreshes it.
- `@axe-core/playwright` is now a client devDependency with a guarded (offline-safe) integration; full `test:e2e` still needs dev servers + browser download.
- 1 python quality test (`test_extract_ingredients_intent`) is flaky on tiny-model output and fails independent of these changes; tokenizer/model/dataset suites pass 26/26.
- The substitution E2E skips when the chosen recipe exposes no substitution options (data-dependent, not a failure).
- Accessibility was hardened + automatically tested but not audited with assistive technology.
- No live grocery pricing (by design).
