# AGENT.md — Flavora Audit + Fix Agent (Flavora-specific)

Use this file when asked to "audit Flavora", "find all problems", or "plan + fix errors".
Stack: React 18 + Vite + Tailwind PWA (`client/src/main.tsx` → `App.tsx`) |
Express 4.21 + Prisma 5.22 SQLite (`server/src/server.ts` → `app.ts`) |
PyTorch decoder + NumPy sidecar (`training/flavora_lm/service.py`).

## 1. Constraints (always)

- Read-only first. Never dump `.env` values (keys only via `.env.example`).
- Use `git status --short`, `git check-ignore -v <path>`, `git log --oneline -20`.
  Never commit secrets. `*.db`, `.env`, `data/user-data.json`,
  `models/flavora-lm/v0.1/training_state.pt`, `test-results/`,
  `playwright-eval-results/` must stay ignored (see `.gitignore`).
- Run a test immediately after every edit/create:
  `npm run test --workspace=flavora-server -- --run <file>`,
  `npm run test --workspace=flavora-client -- --run`,
  `npx tsc --noEmit -p server/tsconfig.json` / `client/tsconfig.json`,
  `.flavoralm-venv/bin/python -m py_compile <pyfile>`.
- Commit in stages, push at end. Exclude unrelated dirty docs.

## 2. Sub-agent dispatch (5 parallel `explore`, read-only)

1. **Structure/docs/config:** `README.md`, `PROGRESS.md`, `package.json`,
   `.env.example`, `.gitignore`, `docs/`, `prisma/schema.prisma`,
   `client/`+`server/` tops. Check: purpose, entry points, env coverage
   (21 keys), gitignore gaps, `DATABASE_URL` ambiguity, Node version
   (>=22.12.0), undocumented scripts, stale `training_state.pt`/`metrics.json`.
2. **Frontend (`client/`):** routing, `lib/api.ts` timeout/AbortError,
   auth (none), `Settings.tsx` seed/reset DEV-gate, bundle (lazy routes),
   floating promises `.catch`, offline regex vs `isNetworkError()`,
   `ProfileForm` sync, nutrition aliases, `Number()` NaN, 3s poll
   visibility, per-route boundaries, env validation, PWA cache.
3. **Backend (`server/`+`prisma/`):** `app.ts` CORS/helmet/rate-limit,
   `server.ts` 127.0.0.1 bind, `dev.ts`/`debug.js` loopback+flag guard,
   `profileSafety.ts` fail-closed (never `[]` on corrupt allergies),
   ID validation (400 not 500), error shapes (`VALIDATION_ERROR`/`NOT_FOUND`/
   `CONFLICT`/`CORRUPT_PROFILE`/`UNSAFE_RECIPE`), `$transaction`, N+1
   (`Promise.all`), date `2024-02-30` rollover, `userId:"local"` scoping,
   `POST meal-plans` 409 on conflict, `DELETE subs` 404 if 0, consume
   requires amount, health `ok=dbOk`.
4. **Data/ML (`data/ models/ training/ scripts/`):** `dataset.py` drift
   (24%), `build_dataset.py` dedupe/verbatim/overlap, `train.py` size-vs-config
   guard, `train_numpy.py` test held-out (`test-metrics.json`), `service.py`
   400 on bad `maxNewTokens/temperature/topK/topP` + Content-Length caps,
   `checkpoint.py` numpy+`PYTHONHASHSEED`+deterministic, `read_jsonl` strict,
   LFS for `model.pt`, `dev/` vs `dev-numpy/` paths.
5. **Tests/CI/deps/security:** `api.test.ts`, `hardening.test.ts`,
   `meals.test.ts`, client `nav.test.tsx` (lazy-aware `waitFor`), `.github/`,
   `qs@6.16.0` override + `npm audit`, `reuseExistingServer:!CI`,
   workspace names (`server` not `flavora-server`), `eval:slow` cross-platform.

## 3. Severity rubric

- **Critical:** open `dev/reset`, `0.0.0.0`, open CORS, allergy fail-open,
  dataset leakage/hallucination, 57M unignored checkpoint, DB ambiguity,
  ML DoS crash.
- **Major:** bundle, lint, offline, validation, transactions, N+1, env/docs
  gaps, test gaps, `qs`, Node mismatch, playwright flake.
- **Minor:** dark-mode, `role=status`, button `type`, dead code, PII logs,
  cache caps.

## 4. Fix order (P0/P1 together, breaking allowed)

0. `.gitignore` + restore `metrics.json` + delete `server/prisma/test.db`.
1. `server.ts` 127.0.0.1, `app.ts` CORS allowlist + `aiLimiter` + health
   `ok=dbOk` + 400 malformed JSON + `CORRUPT_PROFILE` mapping.
2. `dev.ts`/`debug.js` loopback+`ENABLE_DEV_ROUTES`, `Settings.tsx` DEV-gate.
3. `profileSafety.ts` + wire into recommendations/groceries/mealPlans/subs/
   assistant/recipes/saved/debug + `GET /profile` `profileCorrupt` flag.
4. `service.py` validated `_handle_generate` + `do_POST` caps.
5. Backend: `parseId`, `isValidCalendarDate`, scoping, 409/404, N+1,
   `userId` on interactions/viewed.
6. Frontend: `App.tsx` lazy + nested boundary + `Suspense`,
   `api.ts` Abort→network, `ProfileForm` sync+clamp, `Home` aliases,
   poll visibility, `.catch`, dark banner, `nav.test` lazy-aware.
7. ML: verbatim/dedupe/overlap, size guard, seeding, strict `read_jsonl`,
   test-metrics split.
8. Config/docs: `.env.example` 21 keys, `DATABASE_URL=file:../prisma/dev.db`,
   `parsePort`, Node 22.12+, README scripts/docs, playwright `!CI`,
   `eval:slow` node mkdir.

## 5. Output + verify

Return: Overview + Problems (file:line + severity) + Fix phases + Verify.
Verify: `npm run test --workspace=flavora-server -- --run` (262),
`npm run test --workspace=flavora-client -- --run` (41),
`tsc --noEmit` clean, `npm audit` 0, `git status` clean (except known docs).
Residual issues → new todo list, fix, stage-commit, push.
