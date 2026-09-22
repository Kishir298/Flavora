# Flavora — AI-assisted food companion (local-first)

Local-first web app: React + Vite + Tailwind (PWA) + Node + Express + SQLite (Prisma).
Personal data and recipe data stay on your machine. Core recommendations never require a network call.

## Quickstart

Requirements:

- Node.js 22.12+ (engines: >=22.12.0; CI uses Node 22)
- Python 3.11+

### First-time setup

```bash
npm install
npm run setup
```

`npm run setup` verifies Node/Python, installs npm + Python (`torch` CPU) dependencies,
prepares SQLite via Prisma, seeds recipes, and verifies the FlavoraLM artifacts —
without starting any services.

### Train FlavoraLM

```bash
npm run train:tokenizer
npm run train:llm
```

Training runs locally from the synthetic corpus (no downloads, no pretrained
weights). Use `npm run train:llm:dev` for the fast CI-sized model instead.
On an 8 GB / no-GPU laptop prefer the dev config — the full small model takes
hours on integrated graphics-less CPUs.

### Run Flavora

```bash
npm run start
```

After the model has been trained, normal usage requires only `npm run start`:
it re-runs setup checks, starts FlavoraLM (`127.0.0.1:5000`), waits for
`/health`, then starts Express (`localhost:4000`) and Vite (`localhost:5173`).
One terminal, Ctrl+C stops everything cleanly.

### URLs

```text
Website: http://localhost:5173
API: http://localhost:4000
FlavoraLM: http://127.0.0.1:5000
```

### Food intelligence (Dashboard, Meals, Insights)

Flavora is a local-first food-tracking app: `/` is the conversational home
(tell Flavora what you're craving → answer follow-ups → pick a recipe → log
it), `/dashboard` shows today overview, habits, recent meals, goal progress
and insights, `/meals` is the food log (full CRUD), `/insights` statistics +
habit insights. (`/assistant` redirects to `/` for back-compat.)
Meal/goal/water data persists in `data/user-data.json` (atomic writes, local
only — see `docs/FOODLOG_ARCHITECTURE.md`); recipes/inventory/groceries/meal
plans stay in SQLite. Statistics and insights are deterministic — FlavoraLM
explains stored facts, never computes them. New users see honest empty states,
never fake numbers.

### Training vs running

Training (`train:tokenizer`, `train:llm`) **creates** the model artifacts in
`models/flavora-lm/v0.1/` and is done once (or when you want a better model).
Running (`npm run start`) **uses** the existing artifacts and never retrains,
never downloads, and never creates an external LLM. If artifacts are missing,
startup prints exactly what to run (see above) instead of proceeding.

`npm run start` does everything: installs npm dependencies, creates the local
Python environment (`.flavoralm-venv/`), initializes SQLite via Prisma, seeds
recipe data, verifies the FlavoraLM model artifacts, starts the FlavoraLM
inference service (`127.0.0.1:5000`), starts Express (`localhost:4000`) and
Vite (`localhost:5173`), prints the service URLs, and opens the browser where
supported. Re-running it is safe: it never overwrites `.env` and never deletes
the database.

Manual alternative (same steps, piece by piece):

```bash
cp .env.example .env
npm install
npm run db:push
npm run db:seed
npm run dev          # client :5173 + server :4000 (+ FlavoraLM if already running)
```

Open http://localhost:5173 → tell Flavora what you're craving → answer follow-ups → pick a recipe → log it → Dashboard.

Flavora is local-only: natural-language requests are parsed by the built-in
FlavoraLM model (or the deterministic local parser as honest fallback).
There is no remote AI provider and no AI API key (optional nutrition enrichment aside — see Layers). Ranking and allergy filtering
always run on the local engine.

## Local AI — FlavoraLM (our own model, genuinely local)

Flavora interprets natural-language requests with **FlavoraLM**, a small
language model we designed, trained, and versioned ourselves for Flavora's
food-assistant tasks. Inference runs entirely on your machine — no request
data leaves it. This is a real neural model runtime, not the heuristic parser
(see below).

- **Architecture:** decoder-only Transformer (PyTorch), defined in
  `training/flavora_lm/model.py`, randomly initialized, trained with causal
  next-token prediction on a Flavora-specific synthetic corpus.
- **Tokenizer:** custom BPE tokenizer trained on the Flavora corpus
  (`training/flavora_lm/tokenizer.py`) — no pretrained vocabulary.
- **Artifacts:** `models/flavora-lm/v0.1/` (`config.json`, `tokenizer.json`,
  `model.pt`, `metrics.json`, `training_meta.json`; `training_state.pt` is intentionally untracked and regenerated on retrain).
- **Service:** `training/flavora_lm/service.py` serves
  `GET /health`, `GET /metadata`, `GET /metrics`, `POST /generate`, `POST /intent`
  on `127.0.0.1:5000`.
  The browser never talks to it directly — Express (`localhost:4000`) is the
  application gateway.

**Verify Flavora is actually using our model**

```bash
curl http://localhost:4000/api/health
# → ai.resolvedProvider: "local", ai.localModel.name: "FlavoraLM…"

# Full end-to-end check with real inference (prints provider: local):
npm run verify:local-ai

# Prove weights are freshly initialized (no pretrained content):
npm run verify:llm:init
```

In the UI, the assistant status line names its source (`AI: FlavoraLM v0.1` /
`AI: Heuristic (FlavoraLM unavailable|timed out|answer invalid|starting)`).
Probe (`GET /health`) distinguishes *starting* (reachable, 503/loaded:false →
`local-unloaded`) from *unreachable*, and the technical cause travels in server
logs plus a `detail` field — the UI shows the friendly reason chip only.

**Environment variables** (all in `.env`, never client-side)

```bash
FLAVORA_LM_ENABLED=true                 # master switch (default true)
FLAVORA_LM_HOST=http://127.0.0.1:5000   # must be a local address
FLAVORA_LM_TIMEOUT_MS=30000
AI_PROVIDER=local                       # local | heuristic (default local)
```

**Provider selection**

| `AI_PROVIDER` | Behavior |
|---|---|
| `local` (default) | FlavoraLM only. If it is unreachable/timed-out/invalid you get an explicit notice + `fallbackReason` (`local-unreachable` \| `local-timeout` \| `local-invalid` \| `local-unloaded`) and deterministic parsing — never sent anywhere remote (no remote provider exists) |
| `heuristic` | deterministic local parsing, no LLM at all |

**What happens when the model is unavailable:** you get an explicit notice naming the reason (`not reachable` / `timed out` / `unusable answer` / `starting`) plus a machine-readable `fallbackReason`; the UI status line reflects it (`AI: Heuristic (…)`).

**Performance note (honest):** FlavoraLM is a small CPU-friendly model; inference
is seconds on a laptop, not minutes. Intent extraction uses constrained beam
search (`beam_width=4`, near-deterministic) so the same request yields the same structured
intent.

### Training FlavoraLM yourself

No downloads — training runs locally from the synthetic corpus generator:

```bash
npm run train:tokenizer   # production BPE (12k corpus → models/flavora-lm/v0.1/)
npm run train:llm         # production small model → models/flavora-lm/v0.1/ (1–3h CPU)
npm run evaluate:llm      # held-out evaluation → models/flavora-lm/v0.1/eval.json
```

Fast-test variants (append `:dev`) train the smaller dev configuration into the
untracked `models/flavora-lm/dev/` directory — they never touch `v0.1/`:

```bash
npm run train:tokenizer:dev
npm run train:llm:dev     # fast dev model (CI-sized, minutes)
npm run evaluate:llm:dev
```

### Production vs dev model (no ambiguity)

|  | Production (`v0.1/`) | Dev (`dev/`, untracked) |
|---|---|---|
| Name | `FlavoraLM` | `FlavoraLM-dev` |
| Config | `training/configs/flavora_lm_small.json` | `training/configs/flavora_lm_dev.json` |
| Corpus | `training/data-small/` (12k/1.2k/1k) | `training/data/` (1200/150/150) |
| Loaded by `npm run start` | **yes** | no (serve manually with `--artifacts`) |
| Committed to git | **yes** | no (`train:llm:dev` regenerates) |

Machine cost: the production small model (4,947,456 params measured —
6L/8H/d256/ctx256, vocab target 4096 → realized 558 BPE tokens on the 12k
corpus — 12k examples) takes 1–3 hours on an 8 GB / no-GPU laptop; the dev
model takes minutes. Both train CPU-only. `npm run start` never trains — it
only loads the committed `v0.1/` checkpoint.

Pipeline: `training/build_dataset.py` (generate + validate splits) →
`training/train.py` (train tokenizer on corpus → encode → random init →
train with masked-completion loss → checkpoint each epoch → save artifacts +
`training_meta.json`) → `training/evaluate.py` (intent/field accuracy,
invalid-JSON rate, negation handling, repeatability on the held-out test set).

Training is separated from startup: normal `npm run start` never retrains.

### Evaluation (fast smoke, full set, slow browser specs)

Fast validation (seconds–minutes, every PR via `ci.yml`):

```bash
npm test                                   # server + client unit/integration
npx tsc --noEmit -p server/tsconfig.json && npx tsc --noEmit -p client/tsconfig.json
node scripts/py.mjs -m unittest training.tests.test_evaluate training.tests.test_env
npm run evaluate:llm:sample               # 25-example model eval smoke
```

Full evaluation (~2.5h @ ~9s/example on laptop CPU; manual/scheduled only,
never on PR — see `.github/workflows/eval.yml`):

```bash
npm run eval:full                          # 1000 held-out examples
npm run eval:full -- --resume              # resume after interruption (no reruns)
npm run eval:full -- --limit 25            # bounded smoke (same as --max-examples)
npm run eval:full -- --timeout-s 120       # per-example timeout guard
```

How checkpointing works: each example gets a stable ID
(`ex-{index}-{sha8(input)}`); every result is appended to
`models/flavora-lm/v0.1/eval-checkpoint.jsonl` immediately with status,
latency, error and timestamp. A crash loses nothing completed; `--resume`
skips recorded IDs. One bad example is recorded with its failure category
(`invalid_json` / `timeout` / `model_error`) and never aborts the run.
Final report lands in `models/flavora-lm/v0.1/eval.json` (gitignored):
total/completed/passed/failed/errored/skipped, avg + median latency, 5
slowest examples, failure categories, dataset/model/runner config, and the
evaluated git commit.

Slow-spec evaluation (long browser chat loops, heuristic mode):

```bash
npm run eval:slow                          # flavoralm + journey + foodlog specs
```

Expected runtime: minutes per spec (120–300s timeouts each). Results persist
to `playwright-eval-results/slow.json` (gitignored) plus the standard
Playwright report, via `client/playwright.slow.config.ts` (serial workers).
Requires `npm run setup` once + `npx playwright install
chromium`; override the API base with `API_URL` if it is not `:4000`.

**Troubleshooting model startup**

| Symptom | Fix |
|---|---|
| `verify:local-ai` → service FAIL | Run `npm run start` (it launches the service), or `npm run lm:serve` manually |
| Port 5000 busy on macOS (AirPlay Receiver) | `npm run start` auto-falls-back to the next free port (e.g. 5001) and notifies Express — no action needed. Or disable AirPlay Receiver / set `FLAVORA_LM_PORT=5001` |
| Service up but model not loaded | Check `models/flavora-lm/v0.1/model.pt`; retrain with `npm run train:llm` (`:dev` for the fast test model) |
| `.flavoralm-venv` broken/missing | Delete it and run `npm run setup` (recreates + installs torch CPU) |
| Python < 3.11 | Install Python 3.11+ and re-run |

**What works with no AI provider at all:** everything except free-text intent extraction — recipes, recommendations, filtering, inventory, groceries, meal plans, substitutions, and the deterministic engine. Structured UI requests never touch AI.

## Conversational food requests (primary UX)

The home screen is a chat, not a form: say what you want ("I want something
with chicken"), answer one short follow-up at a time (calories → diet →
ingredients → meal), then get deterministic allergy-safe recommendations you
can log as eaten. Multi-field answers ("Around 600 calories, non-veg, chicken
rice onions, for dinner") are extracted at once; "Actually, make it
vegetarian" corrects; "don't care / whatever / skip" falls back to profile
prefs and safe defaults. Bare answers to the pending question ("500" to the
calorie question, `non veg`, `dinner`) are accepted deterministically without
a model call; unrecognized answers get a contextual clarification with an
example instead of a bare repeat. Sessions are in-memory — only the resulting
`FoodRequest` persists. Contract: `server/src/ai/types.ts` (`FoodRequest`),
machine: `server/src/ai/conversationService.ts`, endpoint:
`POST /api/assistant/conversation` (logs `parserRoute` + `modelCalled` per
turn; `FLAVORA_DEBUG_CONVERSATION=1` enables full turn diagnostics).

## Heuristic parser (always available, not an LLM)

A deterministic parser in `server/src/ai/heuristicParser.ts` + `server/src/engine/craving.js`: vocabulary tables for cuisine, time, ingredients, mood/temperature/texture/spice; negation handling ("not too spicy"). Zero network, zero model. Used as the honest fallback (labeled `AI: Heuristic (…)` with a `fallbackReason`).

Optional learning layer (local venv recommended on macOS/Homebrew Python):

```bash
cd server/src/engine
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The retrain trigger prefers `server/src/engine/.venv/bin/python` when that venv exists.

## Scripts

| cmd | what |
|---|---|
| `npm run start` | one-command setup + launch (deps, DB, seed, FlavoraLM, API, website) |
| `npm run setup` | setup only (no services started) |
| `npm run dev` | client + server concurrently |
| `npm run train:llm` / `train:llm:dev` | train FlavoraLM (small / fast dev config) |
| `npm run train:llm-numpy` / `train:llm-numpy:full` | train NumPy v0.2 sidecar (2k / 8k examples) |
| `npm run train:tokenizer` / `train:tokenizer:dev` | train the BPE tokenizer standalone (prod / dev) |
| `npm run evaluate:llm` | held-out FlavoraLM evaluation, full 1000-example set, ~2.5h (alias of `eval:full`) |
| `npm run evaluate:llm:dev` | eval dev checkpoint in `models/flavora-lm/dev` |
| `npm run verify:llm:init:dev` | prove dev weights are freshly initialized |
| `npm run evaluate:llm` | held-out FlavoraLM evaluation, full 1000-example set, ~2.5h (alias of `eval:full`) |
| `npm run evaluate:llm:sample` | 25-example eval smoke (minutes; report → `eval.json`, gitignored) |
| `npm run eval:full` | full-set evaluation, resumable via `-- --resume`, bounded via `-- --limit N` (see Evaluation below) |
| `npm run eval:slow` | slow browser specs (`flavoralm` + `journey` + `foodlog`; long-running, heuristic mode) |
| `npm run verify:local-ai` | 8-step real-inference FlavoraLM verification |
| `npm run verify:llm:init` | prove weights are freshly initialized |
| `npm run lm:serve` | run the FlavoraLM inference service manually |
| `npm run test` | server unit+integration + client component tests |
| `npm run dev:server` / `dev:client` | run API or website only |
| `npm run db:studio` | Prisma Studio for local DB inspection |
| `npm run test:e2e` | Playwright critical paths (needs `npm run setup` once + `npx playwright install chromium`; API base overridable via `API_URL`) |
| `npx playwright test --config=playwright.offline.config.ts` (in `client/`) | offline sync E2E only (needs `npm run build --workspace=client` first; runs `vite preview`) |
| `npm run db:push` / `db:seed` | init + seed SQLite from `/data` |

## Docs

- `docs/FLAVORALM_AUDIT.md` — repository audit (what was found, what was kept/replaced/extended)
- `docs/FOODLOG_ARCHITECTURE.md` — food intelligence: JSON store schema, meals/goals/stats/insights APIs, dashboard, offline, AI-vs-deterministic responsibilities
- `docs/FLAVORALM_ARCHITECTURE.md` — system/model/tokenizer/dataset/training/checkpoint/inference/API/safety/privacy/startup
- `docs/FLAVORALM_TRAINING.md` — corpus → tokenizer → init → training → checkpoint → eval → repro
- `docs/FLAVORALM_EVALUATION.md` — measured metrics, safety tests, honest weaknesses
- `docs/FLAVORALM_FINAL_AUDIT.md` — final audit record (checkpoint history, timings)
- `docs/FLAVORALM_NUMPY.md` — NumPy v0.2 sidecar (architecture, A/B switch, `FLAVORA_LM_ENGINE=numpy`)
- `docs/ACCESSIBILITY.md` — accessibility conformance notes
- `docs/accessibility-screen-reader-checklist.md` — human screen-reader validation plans
- `training/README.md` — training commands and pipeline reference

## Accessibility

Single `<main>` landmark, focus-moving skip link, labelled controls, visible
focus rings, `prefers-reduced-motion` support, `role=status/alert` live regions
(including the `AiStatus` provider line). Automated coverage:
`client/e2e/a11y.spec.ts` (dependency-free baseline on every route **plus**
guarded `@axe-core/playwright` critical/serious check when installed) and
`client/e2e/keyboard.spec.ts` (keyboard-only skip → main → operate), plus
route-specific contracts (live regions, chart text alternatives, named recipe
links, announced form errors). Human screen-reader validation is **PENDING
HUMAN VALIDATION** — see `docs/accessibility-screen-reader-checklist.md`
(NVDA + VoiceOver 24-step plans); automation is evidence, not a substitute.

## Architecture

```text
┌─────────────────────────────┐
│          Browser            │
│       localhost:5173        │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│       Flavora Express       │
│       localhost:4000        │
└───────┬─────────────┬───────┘
        │             │
        │             ▼
        │    ┌─────────────────┐
        │    │   FlavoraLM     │
        │    │  127.0.0.1:5000 │
        │    └────────┬────────┘
        │             │
        │             ▼
        │       Our model
        │       Our weights
        │       Our tokenizer
        │
        ▼
┌─────────────────────────────┐
│    Deterministic Engine     │
│ Allergy / Avoid Filtering   │
│ Recommendation Ranking      │
└─────────────────────────────┘
```

```text
User request (form or natural language)
        ↓
AI provider abstraction
  FlavoraLM (our model)  |  heuristic parser (Groq remote removed 2026-09-17 — see PROGRESS.md)
  — output is schema-validated, never decides allergen safety
        ↓
Deterministic recommendation engine
  1. Hard allergy + avoid-food filter
  2. Feature extraction (8 scored features incl. craving_fit)
  3. Weighted scoring (+ mode reweights)
  4. Optional learned weights (cold start gated)
        ↓
Top recommendations + human matchReasons
        ↓
Optional short assistant reply (explains engine results only)
```

### Layers

- **Recipe data** — `prisma/schema.prisma`, `data/*.json`, `server/src/recipesDb.ts` (local SQLite; no network)
- **Engine** — `server/src/engine/*` (filter → features → scorer → recommend; `retrain.py` for learning)
- **API** — thin Express routes; business logic stays in the engine / AI modules
- **AI** — `server/src/ai/*` local-only (`LocalLlmProvider` → FlavoraLM service, or deterministic heuristic fallback; `AI_PROVIDER=local|heuristic`). No remote **AI** provider and no **AI** API key; the local host must be a local address. `local` means our FlavoraLM — never Ollama, never a third-party model. Optional USDA/Open Food Facts nutrition enrichment (server-side, cached, offline-safe) is the only network call and never carries prompts.
- **Conversation** — `server/src/ai/conversationService.ts` (in-memory sessions → `FoodRequest` → deterministic engine); `POST /api/assistant/conversation`
- **Nutrition** — authored recipe values first (`nutritionSource: "authored"`); optional server-side enrichment via USDA FoodData Central (CC0, `USDA_FDC_API_KEY`) / Open Food Facts (ODbL), cached locally in `data/nutrition-cache.json`; missing data is `"unknown"` (UI shows "unavailable", never invented)
- **Client** — React screens talk only through `client/src/lib/api.ts`

### Recommendation API

`POST /api/recommendations`  
`{ availableIngredients, timeLimit, mode: normal|food_waste|budget, cuisine?, craving?, cravingSignals?, expiringIngredients?, useInventory? }`  
→ `{ recommendations: [{ recipeId, title, score, matchReasons, nutritionSource, … }] }`
Inventory names/expiry are auto-derived when `useInventory:true` or nothing typed.

`POST /api/assistant`  
`{ message }` → `{ intent, source, fallbackReason, notice?, reply, recommendations }`  
Intent is validated; recipes always come from the local engine after the hard filter.

`POST /api/assistant/conversation`  
`{ sessionId?, message }` → `{ sessionId, question|null, done, foodRequest, intent, source, fallbackReason, reply, recommendations }`  
Multi-turn requirement gathering; recommendations only when `done`. Sessions are in-memory.

`GET /api/nutrition/lookup?ingredient=chicken`  
→ `{ ingredient, values, source }` (authored → cache → USDA → Open Food Facts → `unknown`; offline-safe)

`POST /api/interactions` — `shown|viewed|saved|unsaved|cooked|rated_positive|rated_negative|skipped`

### Substitutions / Inventory / Groceries / Meal plans

- `GET/POST/DELETE /api/substitutions` — apply/revert with `safe|unsafe|unknown` revalidation; unsafe blocked. Detail UI previews, grocery + meal plans respect replacements. Nutrition never silently changes.
- `GET/POST/PUT/PATCH/DELETE /api/inventory` (+ `/expiring`, `/consume`) — qty/unit/category/expiry/notes; expiry statuses `fresh|expiring_soon(≤2d)|expired|unknown` with `daysRemaining`. UI supports edit-in-place and sort by expiry/status/name. Food Waste Mode boosts expiring-stock recipes. Language is “you marked as expiring soon”, never a safety verdict.
- `GET/POST/PUT/DELETE /api/groceries` (+ `/generate`, `/clear-completed`, `?restore=1`, `?includeRemoved=1`) — merge compatible quantities, keep prep notes, subtract inventory unit-aware, soft-delete + restore. UI supports edit-in-place, quantity/unit, restore of recently removed.
- `GET/POST/PUT/DELETE /api/meal-plans` (+ `/clear-day`, `/nutrition/summary`) — day/meal slots with servings + applied subs snapshot; unsafe recipes rejected; move meals between day/meal slots; duplicate day to the next day; week/day nutrition aggregates with `unknown` flags, never invented.
- Client pages: `/inventory`, `/groceries`, `/meal-plan` (+ sync banner). All mutations queue offline via IndexedDB and replay in order (max 5 attempts, dedupe by id) — including substitutions, meal logs, water, and goals saves applied offline.
- PWA icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (+ `apple-touch-icon`).

### Safety

Layer 1 allergy/avoid filter is absolute and runs first. Learning and AI explanations cannot reintroduce excluded recipes. Substitutions that conflict with allergies/avoid foods are omitted and never treated as automatically safe.

### Modes

- **food_waste** — boosts `ingredient_overlap` (use what you have)
- **budget** — boosts `budget_fit` from recipe **cost tiers** (low/medium/high), not live grocery prices

### Learning

`retrain.py` (logistic regression) updates `recommendation_weights` when there is enough labelled data (≥15 positive, ≥5 negative). Triggered about every 20 interaction rows. Cold start (&lt;20 outcomes) keeps static defaults. Requires `scikit-learn` installed locally.

### Offline / PWA

Service worker caches the app shell and previously viewed recipe API responses. Inventory/grocery/meal/sub/interact mutations work offline: optimistic UI + persistent IndexedDB queue + ordered replay + pending/syncing/failed banner. Applied substitutions also queue offline and replay on reconnect. Reload while offline works from the app-shell precache (production build; `vite preview`). Not “fully offline” — first-visit recommendations and any AI provider still need the local API/network; cached recipes + queued mutations do not.

**Verify offline sync yourself (tested):**

```bash
cd client && npm run build
npx playwright test e2e/offline.spec.ts --config=playwright.offline.config.ts
```

This goes offline (Chromium emulation), adds an inventory item, reloads the page offline, reconnects, and verifies the queued mutation replays to the server.

### Limitations (honest)

- FlavoraLM is a small model: intent extraction is fast on CPU, but nuanced prose can still fall back to the heuristic parser; the assistant validates its output and falls back on malformed/failed responses. Retrain with `npm run train:llm` to improve it.
- Structured cravings cover common vocab with negation handling; nuanced prose still falls back to token overlap.
- Recipe nutrition is authored (all 80 seeded recipes); online enrichment (USDA/Open Food Facts) only fills gaps for new lookups and is cached — offline or unmatched values stay explicitly `unknown`.
- Unit conversion is allowlist-only (g/kg, ml/l/tsp/tbsp/cup, pieces); ambiguous units never convert.
- Budget uses authored cost tiers, never live prices (local-first by design — no grocery-price API).
- Expiry dates are user estimates, never food-safety verdicts.
- Tiny-model quality test formerly known as `test_extract_ingredients_intent` asserted an exact intent label from a 3-example coin-flip model and failed independent of app changes; it was replaced by `test_extract_returns_schema_valid_intent` (asserts schema validity + determinism, the actual pipeline guarantees). Tokenizer/model/dataset suites pass 26/26 + env suite 2/2.

### Privacy

No accounts, no cloud sync of personal data, no external recipe API. `prisma/dev.db` is gitignored. Never commit `.env`.
