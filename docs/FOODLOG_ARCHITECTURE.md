# Flavora Food Intelligence — local-first tracking, stats & insights

Architecture: React → Express → local persistence → deterministic logic.
FlavoraLM sits **alongside** (intent parsing, conversation, explanation),
never above: it cannot compute stats, decide safety, persist data, or
override the deterministic layer.

## Persistence split

| Domain | Store | Module |
|---|---|---|
| meals, goals, water, favorites | `data/user-data.json` (NEW) | `server/src/store/userDataStore.ts` |
| recipes, profile, interactions, inventory, groceries, meal plans, subs | SQLite/Prisma (unchanged) | existing |

`user-data.json`: `{version:1, profile:{}, goals:{}, meals:[], nutritionLogs:[],
waterLogs:[], favorites:[], feedback:[], mealPlans:[], groceryLists:[],
inventory:[], activity:[]}`. Only used collections are populated; the JSON
file never duplicates Prisma-owned data. Writes are atomic
(tmp → fsync → rename); corrupt files are backed up (`*.corrupt-*.bak`) and
re-initialized, never crashing the server. Override path for tests:
`FLAVORA_USER_DATA_FILE`. Reset: `POST /api/dev/reset` + delete
`data/user-data.json` (recreated on next request).

Meal record: `{id, name, mealType: breakfast|lunch|dinner|snack|other, loggedAt,
foods:[{name,quantity?,unit?}], servings?, nutrition?:{calories?,
protein_g?,carbs_g?,fat_g?} (user- or recipe-provided, never LLM-computed),
tags?, notes?}`. `favorites: string[]` is a reserved schema field with no UI
yet (saved recipes live in Prisma interactions).

## API (all local, all validated)

* `GET/POST /api/meals`, `PUT/DELETE /api/meals/:id`
* `GET/PUT /api/goals` (`maxCalories, protein_g, mealsPerDay,
  vegMealsPerWeek, waterMlPerDay, cookTimesPerWeek`)
* `GET/POST /api/water`
* `GET /api/statistics?range=daily|weekly|monthly` — derived server-side
  from raw meals; client totals are never trusted. Includes timing
  (UTC hour buckets), averages, cuisine variety, and inventory waste
  (`{expiring, expired}` from Prisma expiry statuses)
* `GET /api/insights` — neutral habit observations (weekly deltas,
  30-day trend, timing, waste)
* `POST /api/assistant` + `{context}` — `week-summary | yesterday |
  repeats | goals | waste`; attaches deterministic `facts`;

## Dashboard / Meals / Insights

* `/` Dashboard: week overview (SVG bar chart + text summary), goal rings,
  recent meals, insights; honest empty state ("Log your first meal").
* `/meals` Meals: full CRUD, offline-queued (`meallog.add/update/remove`
  via IndexedDB, replayed by `useOnlineStatus`).
* `/insights` Insights: activity/nutrition/goals/habits with accessible
  chart descriptions. `/assistant` (moved from `/`) adds "Summarize my
  week" grounded in `facts`.
* Statistics: daily/weekly/monthly totals, active days, variety, repeats,
  nutrition trends, goal consistency; sparse data → "Not enough data yet".
  Day bucketing is UTC (deterministic across timezones).

## Offline

Meal logging/editing/deleting, dashboard, statistics, insights, goals,
history, recipes and deterministic recommendations all work offline
(same PWA shell + mutation queue as inventory/groceries). Only
FlavoraLM/Groq intent parsing degrades (honest heuristic fallback).

## AI vs deterministic responsibilities

Deterministic (authoritative): stats, nutrition totals, allergy/avoid
filtering, ranking, persistence, goal math, history. FlavoraLM: NL intent,
conversation, explanation of provided facts. Boundary enforced by
`assistantFacts.test.ts` (lying prompt still returns stored numbers) and
the existing safety suites.
