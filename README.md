# Flavora — AI-assisted food companion (local-first)

Local-first web app: React + Vite + Tailwind (PWA) + Node + Express + SQLite (Prisma).
Personal data and recipe data stay on your machine. Core recommendations never require a network call.

## Quickstart

Requirements:

- Node.js 20+
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

Flavora is a local-first food-tracking app: `/` Dashboard (today overview,
habits, recent meals, goal progress, insights), `/meals` food log (full CRUD),
`/insights` statistics + habit insights, `/assistant` conversational help.
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

Open http://localhost:5173 → Onboarding → Assistant → Detail → Saved → Settings / Explorer.

Optional conversational AI (server-side only):

```bash
# in .env — never use a VITE_ prefix for this key
GROQ_API_KEY=your_key_here
```

Without `GROQ_API_KEY`, natural-language requests still work via a local heuristic intent parser. Ranking and allergy filtering always run on the local engine.

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
  `model.pt`, `training_state.pt`, `metrics.json`, `training_meta.json`).
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
`AI: Heuristic` / `AI: Groq`).

**Environment variables** (all in `.env`, never client-side)

```bash
FLAVORA_LM_ENABLED=true                 # master switch (default true)
FLAVORA_LM_HOST=http://127.0.0.1:5000   # must be a local address
FLAVORA_LM_TIMEOUT_MS=30000
AI_PROVIDER=auto                        # auto | local | groq | heuristic
```

**Provider selection**

| `AI_PROVIDER` | Behavior |
|---|---|
| `auto` (default) | FlavoraLM if running → Groq if key set → heuristic |
| `local` | FlavoraLM only. If it is not running you get an explicit notice and the request is **not** silently sent to Groq |
| `groq` | Groq only; falls back to the heuristic parser if the call fails |
| `heuristic` | deterministic local parsing, no LLM at all |

**What happens when the model is unavailable:** with `auto`, Flavora falls back to Groq (if configured) or the heuristic parser and says so in the response notice. With `local`, you get an explicit unavailability notice — no silent provider switch.

**Performance note (honest):** FlavoraLM is a small CPU-friendly model; inference
is seconds on a laptop, not minutes. Intent extraction uses greedy
(near-deterministic) decoding so the same request yields the same structured
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

**Troubleshooting model startup**

| Symptom | Fix |
|---|---|
| `verify:local-ai` → service FAIL | Run `npm run start` (it launches the service), or `npm run lm:serve` manually |
| Port 5000 busy on macOS (AirPlay Receiver) | `npm run start` auto-falls-back to the next free port (e.g. 5001) and notifies Express — no action needed. Or disable AirPlay Receiver / set `FLAVORA_LM_PORT=5001` |
| Service up but model not loaded | Check `models/flavora-lm/v0.1/model.pt`; retrain with `npm run train:llm` (`:dev` for the fast test model) |
| `.flavoralm-venv` broken/missing | Delete it and run `npm run setup` (recreates + installs torch CPU) |
| Python < 3.11 | Install Python 3.11+ and re-run |

**What works with no AI provider at all:** everything except free-text intent extraction — recipes, recommendations, filtering, inventory, groceries, meal plans, substitutions, and the deterministic engine. Structured UI requests never touch AI.

## Groq (optional, remote)

Set `GROQ_API_KEY` in `.env` (server-side only). Your natural-language message is sent to Groq's API for intent extraction and explanation. Groq is never used for allergy/avoid decisions — its output is schema-validated then passed to the deterministic engine.

## Heuristic parser (always available, not an LLM)

A deterministic parser in `server/src/ai/heuristicParser.ts` + `server/src/engine/craving.js`: vocabulary tables for cuisine, time, ingredients, mood/temperature/texture/spice; negation handling ("not too spicy"). Zero network, zero model. Used as fallback by every provider mode.

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
| `npm run train:tokenizer` | train the BPE tokenizer standalone |
| `npm run evaluate:llm` | held-out FlavoraLM evaluation |
| `npm run verify:local-ai` | 8-step real-inference FlavoraLM verification |
| `npm run verify:llm:init` | prove weights are freshly initialized |
| `npm run lm:serve` | run the FlavoraLM inference service manually |
| `npm run test` | server unit+integration + client component tests |
| `npm run test:e2e` | Playwright critical paths |
| `npx playwright test --config=playwright.offline.config.ts` (in `client/`) | offline sync E2E (needs a client build; runs `vite preview`) |
| `npm run db:push` / `db:seed` | init + seed SQLite from `/data` |

## Docs

- `docs/FLAVORALM_AUDIT.md` — repository audit (what was found, what was kept/replaced/extended)
- `docs/FOODLOG_ARCHITECTURE.md` — food intelligence: JSON store schema, meals/goals/stats/insights APIs, dashboard, offline, AI-vs-deterministic responsibilities
- `docs/FLAVORALM_ARCHITECTURE.md` — system/model/tokenizer/dataset/training/checkpoint/inference/API/safety/privacy/startup
- `docs/FLAVORALM_TRAINING.md` — corpus → tokenizer → init → training → checkpoint → eval → repro
- `docs/FLAVORALM_EVALUATION.md` — measured metrics, safety tests, honest weaknesses
- `training/README.md` — training commands and pipeline reference

## Accessibility

Single `<main>` landmark, focus-moving skip link, labelled controls, visible
focus rings, `prefers-reduced-motion` support, `role=status/alert` live regions
(including the `AiStatus` provider line). Automated coverage:
`client/e2e/a11y.spec.ts` (dependency-free baseline on every route **plus**
guarded `@axe-core/playwright` critical/serious check when installed) and
`client/e2e/keyboard.spec.ts` (keyboard-only skip → main → operate).
Not yet audited with assistive technology — see `docs/FLAVORALM_AUDIT.md`.

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
  FlavoraLM (our model)  |  Groq (optional, remote)  |  heuristic parser
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
- **AI** — `server/src/ai/*` provider abstraction (`LocalLlmProvider` → FlavoraLM service / `GroqProvider` / heuristic; `AI_PROVIDER` selects). Keys stay server-side; the local host must be a local address. `local` means our FlavoraLM — never Ollama, never a third-party model.
- **Client** — React screens talk only through `client/src/lib/api.ts`

### Recommendation API

`POST /api/recommendations`  
`{ availableIngredients, timeLimit, mode: normal|food_waste|budget, cuisine?, craving?, cravingSignals?, expiringIngredients?, useInventory? }`  
→ `{ recommendations: [{ recipeId, title, score, matchReasons, … }] }`
Inventory names/expiry are auto-derived when `useInventory:true` or nothing typed.

`POST /api/assistant`  
`{ message }` → `{ intent, source, notice?, reply, recommendations }`  
Intent is validated; recipes always come from the local engine after the hard filter.

`POST /api/interactions` — `shown|viewed|saved|unsaved|cooked|rated_positive|rated_negative|skipped`

### Substitutions / Inventory / Groceries / Meal plans

- `GET/POST/DELETE /api/substitutions` — apply/revert with `safe|unsafe|unknown` revalidation; unsafe blocked. Detail UI previews, grocery + meal plans respect replacements. Nutrition never silently changes.
- `GET/POST/PUT/PATCH/DELETE /api/inventory` (+ `/expiring`, `/consume`) — qty/unit/category/expiry/notes; expiry statuses `fresh|expiring_soon(≤2d)|expired|unknown` with `daysRemaining`. UI supports edit-in-place and sort by expiry/status/name. Food Waste Mode boosts expiring-stock recipes. Language is “you marked as expiring soon”, never a safety verdict.
- `GET/POST/PUT/DELETE /api/groceries` (+ `/generate`, `/clear-completed`, `?restore=1`, `?includeRemoved=1`) — merge compatible quantities, keep prep notes, subtract inventory unit-aware, soft-delete + restore. UI supports edit-in-place, quantity/unit, restore of recently removed.
- `GET/POST/PUT/DELETE /api/meal-plans` (+ `/clear-day`, `/nutrition/summary`) — day/meal slots with servings + applied subs snapshot; unsafe recipes rejected; move meals between day/meal slots; duplicate day to the next day; week/day nutrition aggregates with `unknown` flags, never invented.
- Client pages: `/inventory`, `/groceries`, `/meal-plan` (+ sync banner). All mutations queue offline via IndexedDB and replay in order (max 5 attempts, dedupe by id) — including substitutions applied offline.

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
- Unit conversion is allowlist-only (g/kg, ml/l/tsp/tbsp/cup, pieces); ambiguous units never convert.
- Budget uses authored cost tiers, never live prices.
- Expiry dates are user estimates, never food-safety verdicts.

### Privacy

No accounts, no cloud sync of personal data, no external recipe API. `prisma/dev.db` is gitignored. Never commit `.env`.
