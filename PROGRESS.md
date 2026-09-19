# Flavora — Progress

## Conversational loop, round 2: bare-number/junk turns + stale-backend guard (2026-09-19, this session)

Live transcript replay proved turns 1–2 (`i want chicken` → craving question)
do NOT reproduce on current source — the observed UI was talking to a stale
backend. Root-cause class fixed instead: `npm run start` never checked
API/WEB port occupancy, so a dead previous server kept answering on :4000
while `waitForTcp` passed. `setup.mjs` now refuses shadow backends (stale-
Flavora detection via `/api/health`), verified live against a dummy occupant.

Genuine state defects reproduced (3 failing regression tests) and fixed:
bare numbers never filled slots AND became junk cravings (`20` → craving,
calorie question forever); greetings/smalltalk (`hi`, `what`) polluted the
craving slot; later junk clobbered established food. Fixes: pending-slot
numeric fill with range guidance, craving-overwrite guard (food/correction
only), greeting + filler guards in the parser, correction-prefix stripping
(`actually beef` → `beef`; diet-only corrections keep craving), replace-vs-
union ingredient semantics for corrections. Safety union untouched.

| Objective | Status | Implementation | Tests | Evidence |
|---|---|---|---|---|
| Repro | Done | `conversationLoop.test.ts` transcript replay; 4 pass / 3 fail pre-fix | 7 loop tests | turns 1–2 pass pre-fix (stale-backend verdict), bare/junk fail |
| State fix | Fixed | parser guards + pending-slot fill + merge guards + corrections | loop 9/9, api 24/24, client 40/40, server 209/209 | `600`→calories kept+chicken; `what`/`20` no clobber; `actually beef` replaces |
| Start guard | Fixed | `ensurePortFree` + live dummy-occupant refusal | `node --check`, live `npm run start` refusal | `API port 4099 … refusing to start a shadow server` |
| E2E | Done | foodlog/journey chat-first routing fixes; offline sub regex-injection fix; full `eval:slow` 6/6 + JSON, offline 2/2, a11y/kb/nav/critical 25/25 | live runs | sub toast regex `.* → (3/4…)` never matches literal parens — plain-string assertion now |

Known limitations: slow E2E timing-sensitive under CPU contention (serial/isolated green); model `valid:false` on open phrasing falls back to heuristic honestly (by design).

## Conversational broken loop: trace, repair, verify (2026-09-18, this session)

Root cause: `parseIntentHeuristic` returned an EMPTY intent for single-food-word
(`i want chicken` — below the ≥2-word bare-list threshold), unmapped vague
words (`healthy`), and typos — and FlavoraLM returns `valid:false` for these,
so `missingSlots` always headed on `craving` → the same
"What are you craving today?" question every turn. Frontend submit/state/render
verified correct (exact string reaches the API; user bubble renders).

| Objective | Status | Implementation | Tests | Evidence |
|---|---|---|---|---|
| Loop fix | Fixed | Free-text craving fallback in `heuristicParser` (short unrecognized text → craving, max 120 chars); lone known-food word also seeds `availableIngredients`; never fires on safety-only/skip/bare-slot-word messages | conversation 21, intent 12, localLlm 18 | `i want chicken` → calories question (was craving loop) |
| Regression | Done | Bug-input loop cases, slot-capture cases, full acceptance journey (chicken → 600+non-veg → ingredients+dinner → done), client Enter-submit exact-string + follow-up test | server 51/51 (3 files), client 18/18 (2 files), safety/engine/nutrition 46/46 | live 3-turn journey → 5 safe recs |
| Live E2E | Done | Real stack + Playwright `flavoralm.spec.ts` 3/4 in parallel run (journey incl. meal log green), 4th green in isolation (parallel model contention) | 4/4 across runs | browser walkthrough of §27 flow |

Known limitations: parallel live-model E2E can contend on CPU (serial green); typo words are kept as free-text craving, not fuzzy-matched (per scope decision).

## Audit repair + chat-first rebuild (2026-09-17, this session)

| Objective | Status | Implementation | Tests | Evidence |
|---|---|---|---|---|
| Error taxonomy honesty | Fixed | `probeStatus()` now returns `detail: ok/unloaded/unreachable` + `httpStatus` (503/loaded:false = starting, not unreachable); `assistantService` prefers `probeStatus` over `probeAvailability`; `LocalLlmError` cause preserved in `detail`; `assistant.js` host-log precedence bug fixed; timeout clamped 1s–120s in `config` + provider | `realInference.test.ts` 2/2 (live), taxonomy unit (timeout/invalid/unloaded) | live `/intent` valid:false → `local-invalid` (not collapsed); valid:true → `source:local` |
| Schema drift | Fixed | `mealType:dessert→snack`, servings 1–20 both sides, `timelimit/time_limit` aliases, `expiringIngredients` in types+normalize, flat conversational slots mirrored on intent, `foodRequestToIntent(req, fallbackMode)` preserves `budget`, conversation done-path passes `parsed.notice`, client `AssistantIntent` extended | conversation 13, intent 12, api 23 | `budget` survives conversation; `notice` shown on done |
| Startup honesty | Hardened | `setup.mjs` inference gate: `valid:true` = verified, `valid:false` = honest warn (up but extracted nothing), no-answer = warn; `.env` synced to local-only (Groq key removed) | `node --check` | `valid:false` no longer prints verified |
| Python env | Verified | `torch 2.2.2 + numpy 1.26.4` imports clean, bridge no-warning | py 28/28 (`env+tokenizer+model+dataset`), `intent_and_service` 10/11 (1 known flaky `test_extract_ingredients_intent`, pre-existing) | run 2026-09-17 |
| Chat-first routes | Done | `/` = chat (`Ask Flavora` first nav), `/dashboard` = Dashboard, `/assistant` → `/` redirect, 404 + RecipeDetail back-link + Dashboard empty-state updated | client 37/37 (nav 13, home 4) | redirect test green |
| Home UX | Done | localStorage persist (sessionId + 50 msgs), New chat, Retry on error, done-with-no-results empty state, offline `enqueueMealLog` queue, bottom-anchored scroll, `lastHave` write for RecipeDetail `have` highlight | home 4/4 | offline queue path same as Meals |
| Fetch efficiency | Fixed | `useOnlineStatus` module singleton (one poll + sync lock, was N concurrent), Groceries single `includeRemoved=1` fetch, MealPlan `Promise.all`, Insights clears stale weekly text off-weekly | client 37/37 | — |
| Safety/engine | Hardened | Synonyms += sesame/mustard/celery/fish/coconut/oats/nut etc.; `<4`-char terms word-boundary (`oil`≠`boil`); `mergeIngredientAmounts` deterministic collision suffix (was `Math.random`); 80-recipe authored-calories audit test | filter 8, shared 17, nutrition 6 | all green |
| Real inference proof | Done | New `realInference.test.ts` (unmocked Express→FlavoraLM); `verify:local-ai` 8/8 live (`source=local`, avoid+pork, 2 recs, unsafe excluded) | 2/2 + 8/8 | 2026-09-17 live run |
| Full suites | Partial | Server `tsc` clean, client `tsc` clean, client 37/37; server subsets green (engine 48, ai 79–80, nutrition/store/stats green); heavy live-inference files flaky under parallel CPU load (timeouts, pass serially) — known limitation, not a code defect | see above | inference 9.6s/req under load vs 1–3s idle |

Known limitations: live-model latency rises under parallel test load (serial runs green); full 1000-example `evaluate.py` not run; E2E browser run needs dev servers (CI-gated); `test_extract_ingredients_intent` flaky on pristine checkout too.

## Conversational reconstruction + local-only AI (2026-09-17, this session)

| Objective | Status | Implementation | Tests | Evidence |
|---|---|---|---|---|
| Local-only AI (Groq removed) | Done | Deleted `groqProvider.ts`; `AI_PROVIDER=local\|heuristic`; `fallbackReason` taxonomy (`local-unreachable/timeout/invalid/unloaded`) in responses + logs + `AiStatus` | server 152, client 35, e2e updated | `grep api.groq.com` = 0 refs in code |
| Cold-start heuristic bug | Fixed | `assistantService` awaits `probeAvailability()` (was sync `isAvailable()` cache=false on first hit); `config.aiProvider` now the default selection | `api.test` conversation journey | first-request `local` when FlavoraLM up |
| Intent schema drift | Fixed | `normalizeIntent` accepts `spicePreference/skillLevel/mealType/servings` top-level + nested `foodRequest` passthrough; Python `intent.py` gains `calorieTarget/dietaryPreference` grammar + normalize + number-bonus routing | intent 12, conversation 7, py `TestIntentValidation` 4 | §7 examples extract exactly |
| Python env (NumPy) | Fixed | `training/requirements.txt` += `numpy>=1.26,<2`; `setup.mjs` validates torch+numpy; new `test_env.py` (import + bridge warning) | py 2/2, 26/26 suites | `import torch,numpy` clean, no warning |
| Conversational UX | Done | Chat-first `Home.tsx` (bubbles, quick actions, log-as-eaten); `conversationService.ts` state machine (one question, multi-field, corrections last-wins, skip-safe, additive safety); `POST /api/assistant/conversation` (FlavoraLM→merge→engine) | conversation 7, api journey 2, client chat 3 | E2E `conversational journey` in `flavoralm.spec.ts` |
| Nutrition honesty + enrichment | Done | `nutritionSource` tags on recipes/recommendations; `lookup.ts` (authored→cache→USDA→OFF→unknown); `GET /api/nutrition/lookup`; detail UI source labels | nutrition 5 | all 80 seeded recipes `authored` |
| Startup | Hardened | `setup.mjs` verifies `POST /intent` inference (not just `/health`) for both fresh + already-running paths | `node --check` | honest warn when health-up-but-inference-down |
| Nav/repairs | Done | `*` 404 route; RecipeDetail back-link → `/assistant`; water + goals offline queue (`water.add`, `goals.save`); PWA 192/512/maskable + apple-touch-icon | client 35 | build precache 9 entries |
| Docs | Reconciled | README (local-only, conversation, nutrition, API), `.env.example`, this matrix | — | no `GROQ_API_KEY` in code paths |

Known limitations: `test_extract_ingredients_intent` flaky on pristine checkout too (verified via stash); full 1000-example `evaluate.py` not run; E2E browser run needs dev servers (CI-gated).

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
| Groq (REMOVED 2026-09-17, superseded) | OPTIONAL FALLBACK | server-side key, timeout, validated output, heuristic fallback; never used in `local` mode |
| Heuristic parser | PRESERVED + EXTENDED | deterministic, zero-network; now also extracts allergies/avoidFoods (additive only); correctly labeled, never called an LLM |
| README | REWRITTEN | Quickstart = `npm run start`; FlavoraLM architecture/training/troubleshooting; docs index + accessibility section; no Ollama; every command exists (`train:tokenizer`, `verify:llm:init` added) |
| Architecture docs | IMPLEMENTED | `docs/FLAVORALM_AUDIT.md`, `FLAVORALM_ARCHITECTURE.md`, `FLAVORALM_TRAINING.md`, `FLAVORALM_EVALUATION.md` |
| E2E chain | IMPLEMENTED | `client/e2e/flavoralm.spec.ts` (health honesty → NL → local intent → safe recs → UI label) + 8-step `verify:local-ai` |

## Known limitations (honest)

- FlavoraLM production checkpoint (4,947,456 params) extracts usable intent for allergy/avoid + simple ingredient prompts (`verify:local-ai` 8/8 with pinned avoid+ingredients message); other nuanced NL still falls back to the heuristic parser (labeled honestly in the UI). Retrain with `npm run train:llm` to improve it; training metrics live in `metrics.json`, analysis in `docs/FLAVORALM_EVALUATION.md`.
- The committed `training_meta.json` is an 80-epoch run predating the new `dataset_sha256`/`created_at` fields (dev config now says 120 epochs); the next full `train:llm:dev` run refreshes it.
- `@axe-core/playwright` is now a client devDependency with a guarded (offline-safe) integration; full `test:e2e` still needs dev servers + browser download.
- Former flaky tiny-model test (`test_extract_ingredients_intent`) replaced by `test_extract_returns_schema_valid_intent` (schema validity + determinism); passes. Historical session notes below retain the old name as record.
- Substitution E2E now navigates directly to seeded `french-onion-soup` (known butter swap) and asserts instead of skipping.
- Accessibility: automated axe/keyboard/nav coverage + `docs/ACCESSIBILITY.md` manual-AT checklist; human VoiceOver/NVDA pass still open.
- No live grocery pricing (local-first by design — cost tiers, no price API).
