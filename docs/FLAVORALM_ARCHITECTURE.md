# FlavoraLM Architecture

FlavoraLM is Flavora's own small decoder-only Transformer language model:
custom architecture, custom BPE tokenizer, custom vocabulary, custom synthetic
corpus, randomly initialized weights, Flavora-trained checkpoints, and Flavora's
own inference runtime. PyTorch is the numerical infrastructure; no pretrained
weights, tokenizer, or data are used anywhere.

## What FlavoraLM is NOT
- Not Ollama, Qwen, Llama, Mistral, Gemma, GPT, Claude, or any hosted LLM.
- Not Hugging Face pretrained weights or a renamed third-party checkpoint.
- `grep -R ollama` returns zero implementation hits; the only `llama` string is
  the optional Groq *remote* model name (`llama-3.3-70b-versatile`), never local.

## System architecture

```text
                    ┌─────────────────────┐
                    │     React Client    │  localhost:5173 — never talks
                    │     Flavora UI      │  to the model service directly
                    └──────────┬──────────┘
                               │  VITE_API_URL → localhost:4000
                               ▼
                    ┌─────────────────────┐
                    │   Express Server    │  application gateway:
                    │   Flavora API       │  timeouts, validation, fallback
                    └──────────┬──────────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
       ┌──────────────────┐        ┌──────────────────┐
       │ Deterministic    │        │ FlavoraLM        │
       │ Recommendation   │◄───────│ Local AI Service │  127.0.0.1:5000
       │ Engine (authority)│ intent│ stdlib HTTP,     │
       └──────────────────┘        └────────┬─────────┘
                                            ▼
                                  ┌──────────────────┐
                                  │ Custom Tokenizer │  BPE v0.2, 540 tokens
                                  │ Custom Vocabulary│  trained on our corpus
                                  │ Custom Transformer│  912K (dev) / 5.9M (small)
                                  │ Custom Weights   │  random init, our training
                                  └──────────────────┘
```

Request pipeline (safety-critical order):

```text
User request
    ↓
FlavoraLM (/intent → structured intent, validated)
    ↓
Structured intent validation (allowlist schema)
    ↓
Deterministic safety filtering (allergies + avoid-foods, additive union)
    ↓
Allergy filtering / Avoid-food filtering (hard filter FIRST)
    ↓
Recommendation engine (features → scoring → ranking)
    ↓
Results + grounded explanations (from matchReasons only)
```

An LLM never overrides allergy restrictions, avoid-food restrictions,
eligibility rules, or safety constraints. If FlavoraLM says acceptable but the
deterministic layer rejects it — rejected.

## Model architecture (`training/flavora_lm/model.py`)

Decoder-only causal Transformer: token embeddings + learned positional
embeddings → N decoder blocks → final LayerNorm → tied LM head (weight tying).

Each block: `x + masked-self-attention(LN(x))` then `x + FFN(LN(x)))`
(GELU, residual connections throughout). Causal masking via upper-triangular
`-inf` mask; context truncation to `context_length`; configurable vocab size.

| Config | dev (`flavora_lm_dev.json`) | small (`flavora_lm_small.json`) |
|---|---|---|
| context_length | 160 | 256 |
| vocab_size (target / realized) | 768 / **540** | 4096 / corpus-dependent |
| embedding_dim | 128 | 256 |
| layers | 4 | 6 |
| attention_heads | 4 | 8 |
| ffn_dim | 512 | 1024 |
| dropout | 0.1 | 0.1 |
| **parameters (measured)** | **912,128** | **5,853,184** |

Initialization: all Linear/Embedding weights `N(0, 0.02)`, biases zero
(`_init_weights`). Provenance: `npm run verify:llm:init` rebuilds from seed 42
and asserts same-seed-identical, diff-seed-differs, init stats, forward shape.
Current dev checkpoint: `embMean -0.00005, embStd 0.01997` — textbook fresh init.

## Tokenizer pipeline (`training/flavora_lm/tokenizer.py`)

Deterministic BPE trained from scratch on the Flavora training corpus only
(no leakage, no pretrained vocabulary). Specials occupy ids 0–5:
`<PAD> <UNK> <BOS> <EOS> <USER> <ASSISTANT>` (v0.2). JSON structural singletons
`{ } [ ] " : ,` are never merged — the model must reproduce intent JSON exactly.
Digits/`-.` always get ids so quantities/time limits survive. Pair ties broken by
(count desc, pair asc) → same corpus always yields the same tokenizer.
Standalone training: `npm run train:tokenizer` → `tokenizer.json` +
`tokenizer_meta.json` (vocab size, specials, normalization, pre-tokenization,
corpus SHA256, repro steps). Realized vocab on dev corpus: **540 tokens**.

## Dataset pipeline (`build_dataset.py`, `flavora_lm/dataset.py`)

Synthetic, original-to-Flavora examples (ingredients/time/cuisine, cravings,
spice, allergies + avoid-foods safety, modes, misspellings, negation, filler).
One deterministic stream split by index (no overlap); `manifest.json` records
version, seed, split counts, and **SHA256 per split**. Examples encoded as
`<BOS><USER> prompt <ASSISTANT> json <EOS>` with `target_start_index` so loss
trains the completion only. Lives in `training/data/` (not `data/llm/` — that
path was a prompt sketch; the committed layout is documented here as canonical).

## Training pipeline (`training/train.py`)

Causal next-token prediction, cross-entropy with prompt positions masked
(`-100`), AdamW + cosine-warmup schedule, gradient clipping, per-epoch
validation (loss/perplexity), per-epoch resumable `training_state.pt`
(weights + optimizer + scheduler + step/epoch + config + tokenizer version +
metrics + seed), final `config.json` (realized vocab) + `tokenizer.json` +
`model.pt` + `model_meta.json` (`trainedAt`) + `training_meta.json` (seed,
dataset/tokenizer versions + **hashes**, hyperparams, hardware, Python/PyTorch,
**timestamp**). Same seed + same corpus → same tokenizer + same init.

## Checkpoint format (`models/flavora-lm/v0.1/`)

`config.json`, `tokenizer.json`, `tokenizer_meta.json` (new), `model.pt`
(`{config, model_state}`), `training_state.pt`, `metrics.json`
(`{step, valLoss, valPerplexity, trainLoss}`), `training_meta.json`,
`model_meta.json`, `eval.json`. No opaque checkpoints: every artifact carries
the metadata needed to reproduce or inspect it.

## Inference pipeline (`service.py`, `intent.py`)

`FlavoraLM.generate()` (temperature, top-k/top-p, repetition penalty, EOS,
context window) backs `POST /generate`. `POST /intent` uses constrained
beam search (greedy, near-deterministic) → JSON extraction → schema
validation/normalization; invalid output yields
`{"intent": null, "valid": false}` — never a crash, never a safety verdict.
CPU-first (`device: cpu` auto; CUDA/MPS detected where available).

## API endpoints (all loopback-only)

- `GET /health` → `{status, model, version, parameterCount, contextLength,
  tokenizerVersion, tokenizerVocab, loaded, device, artifacts, error}`
  (503 when unloaded — never claims healthy without weights).
- `GET /metadata` → `training_meta.json` sidecar. `GET /metrics` → `metrics.json`.
- `POST /generate` → `{text, tokens, ms}`. `POST /intent` → `{intent, valid, ms}`.

## Express integration (`server/src/ai/`)

`LocalLlmProvider` enforces loopback (`isLocalHost`, throws on remote),
3s `/health` probe, configurable `/intent`+`/generate` timeouts (default 30s).
Failure modes (timeout/malformed/empty/crash) → explicit `LocalLlmError` →
`assistantService.ts` falls back per mode: `auto` = FlavoraLM → Groq (if key) →
heuristic; `local` = FlavoraLM only with explicit notice (never silent Groq).

## React integration + fallback

`client/src/lib/api.ts` talks only to Express. `AiStatus` always names the
actual source (`AI: FlavoraLM vX` / `AI: Heuristic (…)` / `AI: Groq`).
FlavoraLM down → heuristic intent + full deterministic recommendations; UI says
so. Structured UI requests never touch AI at all.

## Safety / privacy / deployment boundaries
- Safety: §17 pipeline above; `intentSchema.ts` drops unknown fields, clamps
  time 5–180, cuisine allowlist, mode enum; `assistant.js:80-94` additive union
  with profile; `substitutionSafety.js` tri-state, never safe-when-uncertain.
- Privacy: local requests stay on the machine; only explicit `groq` mode sends
  the message externally (server-side, key never `VITE_`-exposed).
- Deployment: `npm run start` (Node+Python check → npm deps → venv+torch →
  Prisma push+seed → artifact check → FlavoraLM → health-gate → Express+Vite).
  Model artifacts are files, never SQLite rows; `.env` never overwritten.
