# Flavora Progress (§9 phases)

- [x] Phase 0: `/data/recipes.json` (80) + `/data/ingredient_substitutes.json` (31); `.env` drops Spoonacular; local-only config
- [ ] Phase 1: snake_case Prisma schema (`user_profile`, `recipes`, `ingredient_substitutes`, `interactions`, `recommendation_weights`) + `db:seed` from `/data`
- [ ] Phase 1: 7-feature engine (skill_fit, cost_tier budget_fit, new defaults + food_waste/budget reweights) + local-DB orchestrator
- [ ] Phase 1: routes on local DB (`POST /api/recommendations`, `POST /api/interactions`, recipe detail 6-box, `GET /api/debug/explain`)
- [ ] Phase 1: client (Home normal-mode, detail 6 boxes, onboarding/settings CRUD, dark/light)
- [ ] Phase 1: unit + integration tests green (`§7.9`, `§13`)
- [ ] Phase 2 (`phase-2-food-waste-budget`): `food_waste` flow + budget toggle + substitute swaps on detail page
- [ ] Phase 3 (`phase-3-explorer-polish`): Cuisine Explorer (10 cuisines, allergy filter + badge) + learning layer (`retrain.py`, trigger, cold start)
- [ ] MVP done (§15): profile → time-limit + craving query → 3–5 allergy-safe picks → full detail + subs → save → settings, all localhost/offline
