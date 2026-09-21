# FlavoraLM v0.2 — NumPy Neural Core

Real trainable neural network in NumPy (no torch/tf/jax in the core).
Ships **alongside** torch v0.1 as an A/B sidecar; promotion is a config flip.

## Architecture

```text
text → BPE tokenizer (v0.2, shared format) → token IDs [B,T]
→ embedding lookup E[V,d] → masked mean → sentence vector [B,d]
→ Dense(d→h) + ReLU → Dense(h→h) + ReLU
→ 5 softmax heads: diet(4) / meal(5) / cuisine(11) / spice(4) / mode(3)
→ decoder → validated structured intent (or valid:false → heuristic fallback)
```

- Forward is vectorized NumPy only: `emb[ids]`, `x @ W + b`,
  `np.maximum` (ReLU), `np.exp/np.sum` (max-subtracted softmax), `np.mean`.
- Deterministic inference (argmax, no sampling).
- Ingredients/allergies/avoidFoods are NEVER predicted — deterministic
  extractor + `filter.js`/`diet.js` hard filter own safety.

## Parameters (measured, never hard-coded)

Dev checkpoint (`models/flavora-lm/dev-numpy/`, seed 42):

| component | shape | params |
|---|---|---|
| embeddings | 369×64 | 23,616 |
| W1/b1 | 64×128 + 128 | 8,320 |
| W2/b2 | 128×128 + 128 | 16,512 |
| 5 heads | 128×{4,5,11,4,3} + biases | 3,483 |
| **total** | | **51,931** |

Counted at runtime via `param_count()` = `sum(np.prod(s) for arrays)`;
startup logs report it (`[flavoralm] FlavoraLM-numpy v0.2 sidecar (51,931 …)`).

## Training

- Dataset v0.1 (`numpy_data.py`, seed 42): 1400 train / 242 val / 236 test
  after cross-split dedupe; paraphrase banks per slot value (e.g. vegan =
  "I'm vegan" / "I don't eat animal products" / "plant based food");
  1–3 slots per example + realistic ingredient context (unsupervised).
- Loss: mean softmax cross-entropy over heads. Backward: exact analytic
  gradients (Dense/ReLU/softmax-CE/masked-mean/embeddings), verified by
  finite-difference checks (rel err ~1e-8..1e-11 on W1/W2/heads/biases).
- Optimizer: Adam (lr 3e-3, batch 32, grad-clip 1.0) or SGD.
- Dev run (15 epochs, ~6 s CPU): train loss 1.0256→0.0225,
  val loss 0.9363→0.0777, val macro-acc 0.722→0.975, **test macro-acc 0.979**,
  no train/val gap (no overfitting).

```bash
npm run train:llm-numpy        # dev-scale → models/flavora-lm/dev-numpy/ (minutes)
npm run train:llm-numpy:full   # 8000 examples / 25 epochs
```

## Evaluation

- Held-out test macro-acc **0.979** (per-head acc in `metrics.json`).
- Confidence = mean head max-probability (from outputs, never constant).
  Measured: in-domain 0.93–1.00, gibberish 0.80–0.82 → threshold **0.90**.
  Below threshold (or non-finite) → `valid:false` → `fallbackReason`
  `local-invalid`, heuristic takes over. No cosmetic `valid:true`.
- Generalization test: unseen phrasings score macro-acc > 0.45 (chance ~0.2);
  unknown input never crashes, yields low confidence.

## Inference path

```text
POST /intent-numpy {text} → BPE encode → NumPy forward → argmax heads
→ decode (diet/meal/cuisine/spice/mode, schema-shaped) → {intent, valid, confidence, engine:"numpy", ms}
```

- Selected via `FLAVORA_LM_ENGINE=numpy` (default `torch`); pending-question
  routing is untouched (constrained answers never call any model).
- Latency (laptop CPU): forward ~1 ms server-side, ~3–11 ms end-to-end.
- `/health` reports `numpy: {loaded, checkpointValid, inferenceOperational,
  selfTest, parameterCount}` — "server exists" vs "neural inference
  operational" are distinguished.
- Startup self-test (5 representative inputs): shapes, finite probs, no
  NaN/Inf, checkpoint load — printed as `self-test PASS/FAIL`.
- Dev-only `GET /debug-numpy?text=…` (`FLAVORA_DEBUG=1`): token IDs,
  embedding/hidden shapes, per-head probabilities, prediction, confidence.

## Checkpoint format

`models/flavora-lm/dev-numpy/model.npz` (NumPy arrays + `__meta__` config +
`__label_lens__`), `tokenizer.json` (shared BPE format), `metrics.json`
(params, losses, accuracies, balance, provenance). Roundtrip tested:
train → save → destroy → load → identical predictions.

## Fallback behavior (unchanged)

Neural proposes, deterministic disposes: Node runs
`extractJsonObject → normalizeIntent → withHeuristicSafety` on every model
output; engine `filterEligible` (allergy/avoid + diet) runs regardless.
Model failure modes keep existing `fallbackReason` values.

## Safety confirmation

- Vegan flow e2e: `vegan` → `dietaryPreference: vegan` → 5 recommendations,
  first Chana Masala (vegan-appropriate); unsafe recipes still rejected by
  `passesHardFilter/passesDietaryFilter` (diet regression suite green).
- The network cannot mark recipes safe: it emits only intent slots.

## Remaining limitations (honest)

- Minimal heads: craving text + ingredients come from deterministic merge;
  calorie/time/skill/servings are pending-parser/heuristics, not network.
- Dev-scale data (1400 train); `none`-dominant balance; short inputs
  ("the") can read high confidence — mitigated because short answers route
  deterministically, never to the model.
- Full-scale NumPy training + weekly eval not yet scheduled.
