# Flavora — Progress

Status after the master implementation + AI/local-LLM audit (see README for usage).

## Verified state

- **Server:** 108/108 tests pass (unit + integration + safety regression + AI provider tests), `tsc --noEmit` clean.
- **Client:** 19/19 tests pass (components + offline queue), `tsc --noEmit` clean, production build clean.
- **E2E:** 7/7 critical paths pass (dev config); offline sync + substitution spec passes under `playwright.offline.config.ts` (1 conditional skip when the picked recipe has no substitution options).

## Objective matrix

| Objective | Status | Evidence |
|---|---|---|
| Substitutions | FULLY IMPLEMENTED | apply/revert/undo UI, safe/unsafe/unknown revalidation, unsafe blocked, offline queueing, grocery/meal-plan integration; API + integration tests |
| Offline mutations | FULLY IMPLEMENTED | IndexedDB queue (dedupe, ordered replay, max 5 attempts, failure states), optimistic UI, syncing banner, refresh-survival; 11 queue unit tests + E2E offline test |
| Cravings | FULLY IMPLEMENTED | structured signals (flavor/texture/temperature/mood/…), negation, deterministic bounded scoring, truthful match reasons; local fallback always available |
| Groceries | FULLY IMPLEMENTED | generate from recipes/plans, merge, unit-aware inventory subtraction, edit/restore/check/clear, categories, soft-delete |
| Inventory | FULLY IMPLEMENTED | add/edit/consume/remove/search/filter/sort, expiry status + daysRemaining, recommendations derive from stock |
| Expiry tracking | FULLY IMPLEMENTED | configurable threshold (2 d), `fresh/expiring_soon/expired/unknown`, Food Waste boost, no safety claims |
| Meal planning | FULLY IMPLEMENTED | day/meal slots, servings, move, duplicate day, clear day, subs snapshot, unsafe recipes rejected, day/week nutrition |
| Nutrition aggregation | FULLY IMPLEMENTED | meal/day/week; missing values stay `unknown`, never invented |
| Integration flows A–E | FULLY IMPLEMENTED | covered in `p0.test.ts` + E2E |
| Accessibility | LARGELY DONE | labels, roles, focus-visible, status/alert regions, skip link, Esc-close; not formally audited with a screen reader |
| Local LLM | FULLY IMPLEMENTED (optional) | `LocalLlmProvider` (Ollama), local-only host enforcement, timeout/malformed handling, `local\|groq\|heuristic\|auto` selection, health status, 16 provider tests, verified against real `qwen2.5:3b` runtime |
| Groq | FULLY IMPLEMENTED (optional) | server-side key, timeout, validated output, heuristic fallback |
| Heuristic parser | FULLY IMPLEMENTED | deterministic, zero-network, always-on fallback (not an LLM) |
| README | ACCURATE | every documented command executed during this session |

## Known limitations (honest)

- Local LLM is slow on CPU-only machines (cold load ~40 s; first request can take minutes). Documented; heuristic fallback covers failures.
- The substitution E2E skips when the chosen recipe exposes no substitution options (data-dependent, not a failure).
- Accessibility was improved but not audited with assistive technology.
- No live grocery pricing (by design).
