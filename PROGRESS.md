# Flavora Progress

Status reflects **actual code on `main`**, not aspirations.

## Implemented

- [x] Phase 0: `/data/recipes.json` (80) + `/data/ingredient_substitutes.json` (31); local-only config
- [x] Phase 1: snake_case Prisma schema + `db:seed` from `/data`
- [x] Phase 1: 8-feature engine (incl. `craving_fit`) + `skill_fit` / `budget_fit` + food_waste/budget mode reweights + local-DB orchestrator
- [x] Phase 1: routes on local DB (`POST /api/recommendations`, `POST /api/interactions`, recipe detail, `GET /api/debug/explain`)
- [x] Phase 1: client (Home, detail 6 boxes, onboarding/settings CRUD, dark/light)
- [x] Phase 1: unit + integration tests (`engine/*`, `api.test.ts`, client tests)
- [x] Phase 2: food_waste + budget modes (engine + Home UI) + interactive substitutions on detail (apply/undo, safe|unsafe|unknown, grocery+meal aware)
- [x] Inventory + expiry (`/inventory`, expiring_soon ≤2d, Food Waste boost) + groceries (`/groceries`, merge + inventory subtraction) + meal plans (`/meal-plans`, servings + subs snapshot + nutrition summary)
- [x] Structured cravings (controlled vocab + negation + recipe signals, validated AI output, deterministic scoring + truthful reasons)
- [x] Offline-first mutations (IndexedDB queue, optimistic UI, ordered replay ≤5, pending/failed banner) — app shell + cached recipes + queued writes; not fully offline
- [x] Phase 3: Cuisine Explorer (10 cuisines, allergy filter + profile badge) + learning layer (`retrain.py`, trigger, cold start)
- [x] Conversational AI layer: provider abstraction + optional Groq intent parsing + heuristic fallback (`POST /api/assistant`); never bypasses hard filter
- [x] Natural-language Home flow + structured form; craving soft-match; lowCarb profile goal UI
- [x] Saved / unsaved persistence; Like / Dislike / Skip / Cooked on detail
- [x] MVP path: profile → recommend → detail → save → settings, localhost

## Limitations (honest)

- [ ] Groq is optional — without `GROQ_API_KEY`, NL uses heuristics (still local ranking)
- [ ] Learning needs `scikit-learn` + enough interaction labels; otherwise defaults stay in force
- [ ] Cost tiers are authored estimates, not live supermarket prices
- [ ] Budget dataset has few `high` cost-tier recipes
- [ ] Offline: queued mutations + cached recipes work; first-visit recommend/assistant still need local API; Groq needs network
- [ ] No multi-user accounts (by design)

## Future / Planned

- Broader cost-tier coverage in seed data
- Background Sync for queue replay when browser restarts mid-pending
