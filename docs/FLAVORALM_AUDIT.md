# FlavoraLM Audit — actual repository state (2026-09-16)

> Historical record of the 2026-09-16 audit. Superseded in part by the
> 2026-09-17 conversational reconstruction (see PROGRESS.md): the Groq remote
> fallback was removed (Flavora is local-only), `AI_PROVIDER=local|heuristic`,
> and the assistant is now conversational (`POST /api/assistant/conversation`).
> Rows below mentioning Groq/`auto` describe the pre-reconstruction state.

Audit date: 2026-09-16. Method: full tree read + `grep` for
`ollama|qwen|llama|mistral|gemma|LOCAL_LLM|localLlm|AI_PROVIDER|groq|heuristic|tokenizer|transformer|torch|FastAPI|aria-|Playwright|Vitest|axe`.
No assumptions from prior docs — every row verified against code.

## Current state

| Area | Current implementation | Status |
|---|---|---|
| React frontend | `client/src` pages (Home/Explorer/Detail/Saved/Inventory/Groceries/MealPlan/Settings/Onboarding) via `client/src/lib/api.ts` → `VITE_API_URL`. No direct Python calls | WORKING |
| Express backend | `server/src/app.ts`, `routes/assistant.js`, `routes/recommendations.js`, `config.ts` (`AI_PROVIDER`, `FLAVORA_LM_*` canonical + `LOCAL_LLM_*` legacy fallback) | WORKING |
| Database | `prisma/schema.prisma` SQLite; only `RecommendationWeights` for learning. Weights never store model artifacts | WORKING — do not extend |
| Recommendation engine | `server/src/engine/filter.js` (hard allergy/avoid + synonyms, case-insensitive) runs first in `recommend.js:121`; `scorer.js`/`weights.js` cold-start gated (≥20 outcomes) | AUTHORITATIVE — preserve |
| AI provider | `server/src/ai/provider.ts` (`local/groq/heuristic/auto`); `localLlmProvider.ts` loopback-only guard `isLocalHost()`; `groqProvider.ts` 12s timeout; `heuristicParser.ts` zero-network; `intentSchema.ts` allowlist validation | WORKING — `local` = FlavoraLM |
| Ollama | `grep -R ollama` → 0 implementation hits. Only negations (`localLlmProvider.ts:14`, `README.md:232`) | REMOVED |
| Qwen/Mistral/Gemma | 0 hits | ABSENT |
| Llama | Only Groq remote model string `llama-3.3-70b-versatile` (`config.ts:18`, `groqProvider.ts:3`) | REMOTE-ONLY, allowed |
| Groq | Optional server-side key, validated output, heuristic fallback; never used in `local` mode (`provider.ts:67`, `assistantService.ts:110-130`) | OPTIONAL FALLBACK |
| Heuristic parser | Deterministic vocab tables + negation; extracts allergies/avoidFoods additive-only | PRESERVED + EXTENDED |
| FlavoraLM model | `training/flavora_lm/model.py` decoder-only Transformer, fresh random init (`_init_weights` N(0,0.02)), causal mask, tied embeddings | IMPLEMENTED |
| Tokenizer | `training/flavora_lm/tokenizer.py` custom BPE v0.2, specials `<PAD><UNK><BOS><EOS><USER><ASSISTANT>`, structural singletons `{ } [ ] " : ,`, deterministic, `tokenizer.json` | IMPLEMENTED (only inside `train.py` — no standalone `train:tokenizer` yet) |
| Training data | `training/build_dataset.py` + `flavora_lm/dataset.py` synthetic generator; `training/data/{train,validation,test}.jsonl` + `manifest.json`; safety examples | IMPLEMENTED (path is `training/data/`, not prompt's `data/llm/`) |
| Training pipeline | `training/train.py` causal LM + masked-completion loss, AdamW+cosine, clip, per-epoch `training_state.pt` + `training_meta.json` | IMPLEMENTED (1 no-op bug `train.py:235`) |
| Checkpoint | `models/flavora-lm/v0.1/{config.json,tokenizer.json,model.pt,training_state.pt,metrics.json,training_meta.json,model_meta.json,eval.json}` | PRESENT — metadata gaps (no dataset hash/timestamp in `training_meta.json`; realized vocab 540 vs sidecar 768) |
| Inference service | `training/flavora_lm/service.py` stdlib HTTP on `127.0.0.1:5000`: `GET /health`, `POST /generate`, `POST /intent` (greedy/beam `extract_intent`) | IMPLEMENTED (stdlib, not FastAPI — allowed) |
| Offline queue | IndexedDB queue, ordered replay, max 5 attempts, sync banner | PRESERVED |
| Accessibility | Skip-link + `main#main`, `nav[aria-label]`, `role=status/alert`, `aria-live`, `:focus-visible`, `prefers-reduced-motion`; `e2e/a11y.spec.ts` + `keyboard.spec.ts` dependency-free | HARDENED — no axe-core (registry TLS blocked), no AT audit |
| Tests | Server 6 files, client 5 files, python 4 files; `verifyLocalLlm.ts` 8-step real inference | COVERED — no single ML→UI E2E |
| Docs | `README.md` (Local AI), `training/README.md`, `PROGRESS.md`. `docs/` was absent before this file | PARTIAL — 3 architecture/training/eval docs missing |
| Scripts | `setup/start/dev/build/test/test:e2e/verify:local-ai/train:llm/train:llm:dev/evaluate:llm/lm:serve/db:*` all exist | MISSING `train:tokenizer`, `verify:llm:init` |

## What can be preserved
React, Express, Prisma schema, engine, provider abstraction, Groq fallback, heuristic parser, offline queue, PWA, FlavoraLM model/tokenizer/dataset/training/inference/service, one-command startup (`scripts/setup.mjs`), README Local-AI section.

## What must be replaced
Nothing architectural. Only gaps: standalone tokenizer command, init-proof command, checkpoint metadata fields, eval docstring/cap, `/metadata`+`/metrics` endpoints, single-chain E2E, `docs/` trio.

## What must be extended
`build_dataset.py` manifest (SHA256 hashes), `TrainingMeta` (hashes + timestamp), `evaluate.py` (honest loss note + full test set), `service.py` (`GET /metadata`, `GET /metrics`), `a11y.spec.ts` (guarded axe enhancement), README/PROGRESS/docs.

## Already complete
Ollama removal, `local`=FlavoraLM, loopback enforcement, safety boundary (filter-first, additive-only union, injection fields dropped per `flavoraSafety.test.ts:69-81`), timeout/malformed/crash fallbacks, offline behavior, DB safety.

## Broken
- `train.py:235` `meta.to_dict` without `()` — no-op (next line saves correctly, so no data loss).
- Stale checkpoint: `config.json` vocab 540 (realized) vs `model_meta.json` 768; `training_meta.json` epochs 80/steps 3040 vs dev config 120 epochs → interrupted run.
- `evaluate.py:4-8` claims val loss/ppl but code only reports intent metrics.

## Untested
- `checkpoint.py` has no dedicated unit test (covered indirectly via `save_pretrained`).
- `evaluate.py` thresholds only exercised via CLI, no unit test.
- No single Playwright test spans tokenizer→training→checkpoint→inference→Express→React.

## Undocumented
- `docs/FLAVORALM_ARCHITECTURE.md`, `FLAVORALM_TRAINING.md`, `FLAVORALM_EVALUATION.md` (this audit unblocks them).
- Standalone accessibility doc (currently inline in README + specs).
- `FLAVORA_LM_*` vs prompt's `FLAVORALM_*` naming + `LOCAL_LLM_*` legacy fallback rationale.
- stdlib HTTP vs FastAPI rationale; `training/data/` vs `data/llm/` layout rationale.

## Historical-note policy
`ollama|qwen|llama|mistral|gemma|pretrained` hits after this audit are allowed only as: (a) explicit "never X" negations, (b) Groq remote model string, (c) `save_pretrained/load_pretrained` for our own `model.pt` artifact, (d) this audit file. No hidden third-party weights.
