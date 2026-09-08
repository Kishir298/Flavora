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
| `npm run db:push` / `db:seed` | init + seed SQLite from `/data` |

## Architecture

```text
User request (form or natural language)
        ↓
Intent (Groq optional / heuristic fallback)   ← never decides allergen safety
        ↓
Deterministic recommendation engine
  1. Hard allergy / avoid-food filter
  2. Feature extraction (7 scored features)
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
- **AI** — `server/src/ai/*` provider abstraction (`GroqProvider` + heuristic). Key stays server-side.
- **Client** — React screens talk only through `client/src/lib/api.ts`

### Recommendation API

`POST /api/recommendations`  
`{ availableIngredients, timeLimit, mode: normal|food_waste|budget, cuisine?, craving? }`  
→ `{ recommendations: [{ recipeId, title, score, matchReasons, … }] }`

`POST /api/assistant`  
`{ message }` → `{ intent, source, notice?, reply, recommendations }`  
Intent is validated; recipes always come from the local engine after the hard filter.

`POST /api/interactions` — `shown|viewed|saved|unsaved|cooked|rated_positive|rated_negative|skipped`

### Safety

Layer 1 allergy/avoid filter is absolute and runs first. Learning and AI explanations cannot reintroduce excluded recipes. Substitutions that conflict with allergies/avoid foods are omitted and never treated as automatically safe.

### Modes

- **food_waste** — boosts `ingredient_overlap` (use what you have)
- **budget** — boosts `budget_fit` from recipe **cost tiers** (low/medium/high), not live grocery prices

### Learning

`retrain.py` (logistic regression) updates `recommendation_weights` when there is enough labelled data (≥15 positive, ≥5 negative). Triggered about every 20 interaction rows. Cold start (&lt;20 outcomes) keeps static defaults. Requires `scikit-learn` installed locally.

### Offline / PWA

Service worker caches the app shell and previously viewed recipe API responses. Core browsing of cached recipes can work offline. Groq intent parsing requires network when configured; without a key, local parsing still works if the API server is reachable.

### Privacy

No accounts, no cloud sync of personal data, no external recipe API. `prisma/dev.db` is gitignored. Never commit `.env`.
