# Flavora — AI-assisted food companion (local-first)

Local-first web app: React + Vite + Tailwind (PWA) + Node + Express + SQLite (Prisma).
Personal data and recipe data stay on your machine. Core recommendations never require a network call.

## Quickstart

```bash
cp .env.example .env
npm install
npm run db:push
npm run db:seed
npm run dev          # client :5173 + server :4000
```

Open http://localhost:5173 → Onboarding → Assistant → Detail → Saved → Settings / Explorer.

Optional conversational AI (server-side only):

```bash
# in .env — never use a VITE_ prefix for this key
GROQ_API_KEY=your_key_here
```

Without `GROQ_API_KEY`, natural-language requests still work via a local heuristic intent parser. Ranking and allergy filtering always run on the local engine.

## Local AI / LLM (optional, genuinely local)

Flavora can use a **real local LLM** (via [Ollama](https://ollama.com)) to interpret natural-language requests. Inference runs entirely on your machine — no request data leaves it. This is a real model runtime, not the heuristic parser (see below).

**Prerequisites**

- [Ollama](https://ollama.com/download) installed
- ~2 GB disk for the model; 8 GB+ RAM recommended

**Setup (tested commands)**

```bash
ollama serve                  # start the runtime (default port 11434)
ollama pull qwen2.5:3b        # one-time model download (~1.9 GB)
curl http://127.0.0.1:11434/api/tags   # health check — should return JSON
```

Then start Flavora normally (`npm run dev`). With the default `AI_PROVIDER=auto`, the local model is used automatically whenever the runtime is reachable.

**Verify Flavora is actually using the local model**

```bash
curl http://localhost:4000/api/health
# → ai.localLlm.available: true, ai.resolvedProvider: "local"

# Full end-to-end check against the real runtime (prints source: local):
cd server && AI_PROVIDER=local npx tsx scripts/verifyLocalLlm.ts
```

In the UI, the assistant notice line names its source (`local` / `groq` / `heuristic`).

**Environment variables** (all in `.env`, never client-side)

```bash
LOCAL_LLM_ENABLED=true                          # master switch (default true)
LOCAL_LLM_HOST=http://127.0.0.1:11434           # must be a local address
LOCAL_LLM_MODEL=qwen2.5:3b                      # any Ollama model tag
LOCAL_LLM_TIMEOUT_MS=300000                     # 5 min default
AI_PROVIDER=auto                                # auto | local | groq | heuristic
```

**Provider selection**

| `AI_PROVIDER` | Behavior |
|---|---|
| `auto` (default) | local LLM if running → Groq if key set → heuristic |
| `local` | local LLM only. If it is not running you get an explicit notice and the request is **not** silently sent to Groq |
| `groq` | Groq only; falls back to the heuristic parser if the call fails |
| `heuristic` | deterministic local parsing, no LLM at all |

**What happens when the model is unavailable:** with `auto`, Flavora falls back to Groq (if configured) or the heuristic parser and says so in the response notice. With `local`, you get an explicit unavailability notice — no silent provider switch.

**Performance note (honest):** on a typical laptop CPU, cold model load takes ~40 s and the first request may take 1–3 minutes; warm requests are far faster. The verify script sends a warm-up request first. On GPU machines this is seconds. If your hardware is slower, raise `LOCAL_LLM_TIMEOUT_MS` or use a smaller model.

**How this differs from the heuristic parser:** the heuristic parser is *not* an LLM — it is plain deterministic code (vocabulary tables + negation handling) that always runs and never sends data anywhere. The local LLM is a genuine language model that understands messier prose but needs the Ollama runtime. Groq is a remote service and sends your message text to it.

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
| `npm run dev` | client + server concurrently |
| `npm run test` | server unit+integration + client component tests |
| `npm run test:e2e` | Playwright critical paths |
| `npx playwright test --config=playwright.offline.config.ts` (in `client/`) | offline sync E2E (needs a client build; runs `vite preview`) |
| `npm run db:push` / `db:seed` | init + seed SQLite from `/data` |

## Architecture

```text
User request (form or natural language)
        ↓
AI provider abstraction
  local LLM (Ollama)  |  Groq (optional, remote)  |  heuristic parser
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
- **AI** — `server/src/ai/*` provider abstraction (`LocalLlmProvider` / `GroqProvider` / heuristic; `AI_PROVIDER` selects). Keys stay server-side; the local host must be a local address.
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

- Local LLM intent extraction is slow on CPU-only machines (see performance note) and needs Ollama running; the assistant validates its output and falls back to the heuristic parser on malformed/failed responses.
- Structured cravings cover common vocab with negation handling; nuanced prose still falls back to token overlap.
- Unit conversion is allowlist-only (g/kg, ml/l/tsp/tbsp/cup, pieces); ambiguous units never convert.
- Budget uses authored cost tiers, never live prices.
- Expiry dates are user estimates, never food-safety verdicts.

### Privacy

No accounts, no cloud sync of personal data, no external recipe API. `prisma/dev.db` is gitignored. Never commit `.env`.
