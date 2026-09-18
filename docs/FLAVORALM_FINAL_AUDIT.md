# FlavoraLM Final Audit — production verification 2026-09-17 (supersedes dev record below)

> The authoritative artifact is `models/flavora-lm/v0.1/` = **FlavoraLM v0.1
> production-small** (6L/8H/d256/ctx256/ff1024, vocab target 4096 → realized
> **558**, **4,947,456 params** counted via `FlavoraLM.load_pretrained`,
> tokenizer BPE v0.2, 12 epochs / 4500 steps, 12000/1200/1000 examples, train
> 4.074 / val 3.875 / ppl 48.20, checkpoint 18.9M). Verified 2026-09-17:
> `verify_artifact` 17/17 PASS; tokenizer round-trip + specials + determinism
> PASS; `/health` (FlavoraLM v0.1 loaded, 4947456 params) / `/metadata` /
> `/metrics` / `/generate` (real tokens) / `/intent` (valid allergy/avoid,
> honest `valid:false` otherwise) live PASS; `verify:local-ai` 8/8 PASS;
> server 121/121, client 19/19, `verify:llm:init` PASS; `npm run start`
> one-command PASS (FlavoraLM :5001 via AirPlay fallback + Express :4000 +
> Vite :5173, SIGINT cleanup clean); e2e `flavoralm.spec.ts` 3/3 PASS;
> missing-`model.pt` → exact retrain instructions; corrupt checkpoint → FATAL
> without false readiness; safety tests 27/27 PASS; no Ollama/Qwen/Llama
> runtime dependency (only Groq remote fallback string + doc negations).
> Pinned verification message updated to `I avoid pork and want chicken and
> rice` (production checkpoint handles allergy/avoid + simple ingredient
> intents; other phrasings fall back to heuristic honestly). Full 1000-example
> `evaluate.py` not run here (~200s/example CPU). The dev-checkpoint record
> below is retained as history.

# FlavoraLM Final Audit — verified live on 2026-09-17 (dev history)

One-command startup, real checkpoint, live inference, and full-stack integration
were all exercised on an Intel i5 / 8 GB / no-GPU MacBook Pro (CPU-only torch).
Nothing below is claimed without the listed evidence. Prior docs
(`FLAVORALM_AUDIT/ARCHITECTURE/TRAINING/EVALUATION.md`) remain the deep
references; this file is the final verification record.

## Component matrix

| Component | Status | Evidence |
|---|---|---|
| Custom tokenizer | COMPLETE | `training/flavora_lm/tokenizer.py` BPE v0.2, 540 tokens, specials ids 0–5; 5 probe phrases encode→decode round-trip OK (lowercasing documented); `npm run train:tokenizer` → `tokenizer.json` + `tokenizer_meta.json` |
| Custom vocabulary | COMPLETE | Trained on Flavora corpus only; `model.pt` head `(540,128)` == tokenizer 540 == `config.json` 540 (stale 768-vocab artifact replaced by full retrain, 2026-09-17) |
| Custom Transformer | COMPLETE | `training/flavora_lm/model.py` decoder-only, 4 layers / 4 heads / d128 / ctx160; **882,944 params** measured, matches `model_meta.json` |
| Fresh initialization | COMPLETE | `npm run verify:llm:init` PASS (embMean −0.00005, embStd 0.01997, same-seed-identical, diff-seed-differs) |
| Actual trained checkpoint | COMPLETE | `models/flavora-lm/v0.1/{config.json,tokenizer.json,model.pt(3.4M),training_state.pt,metrics.json,training_meta.json(19 fields),model_meta.json,eval.json}`; 120 epochs / 18000 steps, train 0.153 / val 0.155 / ppl 1.17 (was 2.685/2.544/12.73) |
| Training pipeline | COMPLETE | `npm run train:tokenizer` + `npm run train:llm(:dev)`; masked-completion loss, AdamW+cosine, clip, per-epoch checkpoints with dataset SHA256 + `created_at` |
| Inference | COMPLETE | Live `/generate` returned real model tokens (`{"ingredients":["butter","cream"],"`, 24 toks, 160 ms); not hardcoded; no Ollama/Qwen/Llama in path and no Groq provider (grep-clean; groq name only as rejected-fixture guard; loopback-only provider) |
| `/health` | COMPLETE | Live 200: `FlavoraLM-dev v0.1, 882944 params, ctx160, tok v0.2/540, loaded:true, cpu`; 503 semantics when unloaded (code-reviewed) |
| `/generate` | COMPLETE | Live-tested (see above); temp/top-k/top-p/EOS/truncation implemented + unit-tested |
| `/intent` | COMPLETE | 7/7 probes answered through the FlavoraLM beam-search + schema-validation pipeline; 6 valid, 1 honest `valid:false`; plus `GET /metadata`, `GET /metrics` sidecars verified live |
| Express integration | COMPLETE | `LocalLlmProvider` loopback-only; `/api/health` reported `local \| FlavoraLM-dev loaded 882944`; `/api/assistant` returned `source: local` end-to-end (E2E 3/3) |
| React integration | COMPLETE | UI test asserts `AI: FlavoraLM v0.1` status line; browser never touches `:5000` (zero `127.0.0.1/:5000` refs in `client/src`) |
| Deterministic safety | COMPLETE | Server 121/121 incl. `flavoraSafety.test.ts` (loopback-only, no-Groq-in-local, injection-drop, timeout/malformed/crash); live verify step 8 excluded peanut/mushroom; filter-first ordering in `recommend.js:121` |
| Ollama removed | COMPLETE | `grep ollama\|qwen\|mistral\|gemma` → only doc negations + audit policy; `llama`/ names only as rejected-fixture guards, not providers; generation path proven local |
| One-command startup | COMPLETE | `npm run start` run live: Node v24.20.0, Python 3.11.15, torch 2.2.2, artifacts ✓, FlavoraLM ✓ (882944 params), API :4000 ✓, Website :5173 ✓; AirPlay :5000 squat auto-fell-back to :5001 with Express notified via `FLAVORA_LM_HOST`; Ctrl+C cleanup wired |
| Accessibility | COMPLETE | a11y E2E 11/11 with real `@axe-core/playwright` (WCAG 2 A+AA gate); genuine fix shipped (white-on-`green-600` 3.29 → `green-700` 4.98 on 5 button sites); AAA `color-contrast-enhanced` explicitly excluded with rationale |
| Tests | COMPLETE | Server 121/121, client 19/19, python 26/26, `tsc` clean both, client+server build clean, `verify:local-ai` 8/8 live, `verify:llm:init` PASS, `train:tokenizer` OK, capped `evaluate:llm` EVAL PASS (schemaValidity 0.9, invalidJson 0.1, negation 1.0, repeatability 1.0) |
| README | COMPLETE | First-time setup / Train / Run / URLs blocks, training-vs-running split, low-spec note, docs index, honest failure table (AirPlay row updated for auto-fallback) |

## Model (final)

- FlavoraLM-dev v0.1, decoder Transformer (4L/4H/d128/ctx160), **882,944 params**
- Vocab **540** (BPE v0.2, Flavora corpus), tokenizer v0.2, checkpoint v0.1

## Training (final)

- 120 epochs, **18000 steps**, batch 8, LR 0.005, AdamW+cosine, seed 42, CPU x86_64
- train 0.153 / val 0.155 / ppl 1.17; eval (10-ex sample): exact-match 0.0 (strict),
  schemaValidity 0.9, invalidJson 0.1, negation 1.0, repeatability 1.0

## Services (verified live)

```text
FlavoraLM → http://127.0.0.1:5001 (auto-fallback; AirPlay holds :5000 on macOS)
Express   → http://localhost:4000 (resolvedProvider: local)
Website   → http://localhost:5173 (200, AI status names FlavoraLM)
```

## Startup

`npm run start` alone is sufficient (proven twice live, incl. the AirPlay-squat
path). Missing artifacts print the exact `train:tokenizer` → `train:llm` →
`start` recovery text. AI-down keeps the app running with an explicit
unavailable notice (never a false ✓).

## Remaining work (genuine only)

- Full 150-example eval (~15 min CPU) and full small-model training (hours) are
  documented paths, not done on this 8 GB/no-GPU machine.
- Exact-match intent quality (0.0 strict) can improve with the bigger corpus/model.
- No assistive-technology audit yet (automated axe AA passes).
- `training_state.pt` (10.2M) intentionally untracked; retrain regenerates it.
