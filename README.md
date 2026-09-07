# Flavora — AI-assisted food companion (local-first)

Local-first web app: React + Vite + Tailwind (PWA) + Node + Express + SQLite (Prisma).
All personal data stays on your machine. Only anonymous query params go to the recipe API.

## Quickstart (localhost, mock data — no API key needed)

```bash
cp .env.example .env
npm install          # root (installs server + client workspaces)
npm run db:push      # create local SQLite file (prisma/dev.db, gitignored)
npm run db:seed      # demo profile + sample recipes, zero network
npm run dev          # client :5173 + server :4000 concurrently
```

Open http://localhost:5173 → Onboarding → Assistant → Detail → Saved → Settings.

## Live recipe data (optional)

1. Sign up directly at https://spoonacular.com/food-api (≈150 pts/day).
2. `.env`: `USE_MOCK_RECIPES=false` + `SPOONACULAR_API_KEY=...`
3. Restart server. Tests still use fixtures (never live quota).

## Scripts

| cmd | what |
|---|---|
| `npm run dev` | client + server concurrently |
| `npm run test` | server unit+integration (vitest) + client component tests |
| `npm run test:e2e` | Playwright critical path (profile → recommend → open → save) |
| `npm run db:push` / `db:seed` | init + seed local SQLite |

## Recommendation engine (`server/src/engine/`, literal `.js` paths)

Guide implementation: `filter.js` (Layer 1 hard filter + synonym map — best-effort,
always double-check ingredients) → `features.js` (6 normalized features) →
`scorer.js` (Σw·f, defaults 0.30/0.20/0.15/0.15/0.10/0.10) → `recommend.js`
(top 5 + human `matchReasons`, logs `shown` rows). API: `POST /api/recommendations
{availableIngredients, timeLimit, mode}` and `POST /api/interactions`
(`shown/viewed/saved/cooked/rated_positive/rated_negative/skipped`).
`GET /api/debug/explain?recipeId=` (dev-only) shows features + weights + score.

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

No accounts, no cloud sync. `prisma/dev.db` never committed. PWA service worker caches app shell + viewed recipes for offline use.
