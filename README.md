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
- **AI** — `server/src/ai/*` provider abstraction (`GroqProvider` + heuristic). Key stays server-side.
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
- `GET/POST/PUT/PATCH/DELETE /api/inventory` (+ `/expiring`, `/consume`) — qty/unit/category/expiry/notes; expiry statuses `fresh|expiring_soon(≤2d)|expired|unknown`. Food Waste Mode boosts expiring-stock recipes. Language is “you marked as expiring soon”, never a safety verdict.
- `GET/POST/PUT/DELETE /api/groceries` (+ `/generate`, `/clear-completed`) — merge compatible quantities, keep prep notes, subtract inventory unit-aware, soft-delete restore.
- `GET/POST/PUT/DELETE /api/meal-plans` (+ `/clear-day`, `/nutrition/summary`) — day/meal slots with servings + applied subs snapshot; unsafe recipes rejected; week/day nutrition aggregates with `unknown` flags, never invented.
- Client pages: `/inventory`, `/groceries`, `/meal-plan` (+ sync banner). All mutations queue offline via IndexedDB and replay in order (max 5 attempts, dedupe by id).

### Safety

Layer 1 allergy/avoid filter is absolute and runs first. Learning and AI explanations cannot reintroduce excluded recipes. Substitutions that conflict with allergies/avoid foods are omitted and never treated as automatically safe.

### Modes

- **food_waste** — boosts `ingredient_overlap` (use what you have)
- **budget** — boosts `budget_fit` from recipe **cost tiers** (low/medium/high), not live grocery prices

### Learning

`retrain.py` (logistic regression) updates `recommendation_weights` when there is enough labelled data (≥15 positive, ≥5 negative). Triggered about every 20 interaction rows. Cold start (&lt;20 outcomes) keeps static defaults. Requires `scikit-learn` installed locally.

### Offline / PWA

Service worker caches the app shell and previously viewed recipe API responses. Inventory/grocery/meal/sub/interact mutations work offline: optimistic UI + persistent IndexedDB queue + ordered replay + pending/failed banner. Not “fully offline” — first-visit recommendations and Groq still need the local API/network; cached recipes + queued mutations do not.

### Limitations (honest)

- Structured cravings cover common vocab with negation handling; nuanced prose still falls back to token overlap.
- Unit conversion is allowlist-only (g/kg, ml/l/tsp/tbsp/cup, pieces); ambiguous units never convert.
- Budget uses authored cost tiers, never live prices.
- Expiry dates are user estimates, never food-safety verdicts.

### Privacy

No accounts, no cloud sync of personal data, no external recipe API. `prisma/dev.db` is gitignored. Never commit `.env`.
