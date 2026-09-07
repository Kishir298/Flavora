# Flavora — AI-assisted food companion (local-first)

Local-first web app: React + Vite + Tailwind (PWA) + Node + Express + SQLite (Prisma).
All personal data **and** all recipe data stay on your machine. No network calls required.

## Quickstart (localhost, zero config)

```bash
cp .env.example .env
npm install          # root (installs server + client workspaces)
npm run db:push      # create local SQLite file (prisma/dev.db, gitignored)
npm run db:seed      # 80 recipes + 31 substitutes from /data + demo profile, zero network
npm run dev          # client :5173 + server :4000 concurrently
```

Open http://localhost:5173 → Onboarding → Assistant → Detail → Saved → Settings.

## Scripts

| cmd | what |
|---|---|
| `npm run dev` | client + server concurrently |
| `npm run test` | server unit+integration (vitest) + client component tests |
| `npm run test:e2e` | Playwright critical path (profile → recommend → open → save) |
| `npm run db:push` / `db:seed` | init + seed local SQLite from `/data` |

## Recipe data (`/data`, §5)

`data/recipes.json` (~80 recipes, 8 per cuisine across the 10 explorer cuisines)
and `data/ingredient_substitutes.json` ship in the repo and seed the local
`recipes` / `ingredient_substitutes` tables. Add more recipes to the JSON and
re-run `npm run db:seed` — no schema change needed. SQLite tables/columns are
`snake_case`; Prisma `@map`/`@@map` exposes `camelCase` to the app.

## Recommendation engine (`server/src/engine/`, literal `.js` paths)

`filter.js` (Layer 1 hard filter + synonym map — best-effort,
always double-check ingredients) → `features.js` (7 normalized features
incl. `skill_fit` and `cost_tier`-based `budget_fit`) →
`scorer.js` (Σw·f, defaults 0.25/0.20/0.125/0.125/0.10/0.10/0.10;
`food_waste` → overlap 0.50, `budget` → budget 0.30, remainder scaled
proportionally) → `recommend.js`
(top 5 + human `matchReasons`, logs `shown` rows). API: `POST /api/recommendations
{availableIngredients, timeLimit, mode: normal|food_waste|budget}` and `POST /api/interactions`
(`shown/viewed/saved/cooked/rated_positive/rated_negative/skipped`).
`GET /api/debug/explain?recipeId=&mode=` (dev-only) shows features + weights + score.

## Learning layer (local, opt-out by doing nothing)

`server/src/engine/retrain.py` (logistic regression, single-user `"local"`).
Install once: `python3 -m pip install -r server/src/engine/requirements.txt`.
Auto-runs in the background every 20 logged interactions; needs ≥15 positive +
≥5 negative examples or it refuses and keeps current weights. Cold start (<20
outcomes) uses static defaults. `recommendation_weights` table holds learned weights.

## Safety model

Layer 1 allergy/avoid filter is absolute and runs first — it never learns or softens.
Layer 2 weighted scoring only reorders allergy-safe recipes. Layer 3 only nudges
Layer 2 weights and can never override Layer 1.

## Privacy / offline

No accounts, no cloud sync, no external recipe API. `prisma/dev.db` never committed.
PWA service worker caches app shell + viewed recipes for offline use.
