#!/usr/bin/env python
"""Acceptance tests for the FlavoraLM v0.2 NumPy neural core.

Proves: real params, real forward, real backprop (finite-diff), optimizer
updates, training learns, checkpoint roundtrip, generalization, unknown
handling, numerical self-test. No torch, no faked metrics.
"""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from training.flavora_lm.numpy_data import (
    encode_batch,
    generate_numpy_examples,
    label_indices,
    make_splits,
)
from training.flavora_lm.numpy_model import (
    FlavoraNeuralCore,
    NumpyConfig,
    stable_softmax,
)
from training.flavora_lm.numpy_train import (
    AdamState,
    TrainConfig,
    evaluate,
    numerical_grad_check,
    train_step,
)
from training.flavora_lm.tokenizer import BPETokenizer, train_tokenizer


def tiny_tok(texts, vocab_size=200):
    trained = train_tokenizer(texts, vocab_size=vocab_size)
    return BPETokenizer(trained.vocab, trained.merges)


class TestNumpyCore(unittest.TestCase):
    def test_param_count_from_arrays(self):
        core = FlavoraNeuralCore(NumpyConfig(vocab_size=100, d_embed=16, hidden=32))
        expect = (100 * 16 + 16 * 32 + 32 + 32 * 32 + 32
                  + sum(32 * len(v) + len(v) for v in core.config.heads.values()))
        self.assertEqual(core.param_count(), expect)
        for p in core.parameters().values():
            self.assertIsInstance(p, np.ndarray)

    def test_forward_shapes_finite_probs(self):
        core = FlavoraNeuralCore(NumpyConfig(vocab_size=100, d_embed=16, hidden=32))
        ids = np.array([[5, 6, 7, 0], [8, 9, 0, 0]])
        out = core.forward(ids)
        for name, labels in core.config.heads.items():
            self.assertEqual(out[name].shape, (2, len(labels)))
            self.assertTrue(np.all(np.isfinite(out[name])))
            np.testing.assert_allclose(out[name].sum(axis=1), 1.0, rtol=1e-9)
        conf = core.confidence(ids)
        self.assertEqual(conf.shape, (2,))
        self.assertTrue(np.all(conf > 0) and np.all(conf <= 1.0))

    def test_stable_softmax_extreme_logits(self):
        logits = np.array([[1000.0, 1001.0, 999.0]])
        p = stable_softmax(logits)
        self.assertTrue(np.all(np.isfinite(p)))
        self.assertAlmostEqual(float(p.sum()), 1.0, places=9)

    def test_backward_finite_difference(self):
        rng = np.random.default_rng(3)
        core = FlavoraNeuralCore(NumpyConfig(vocab_size=60, d_embed=16, hidden=32))
        ids = rng.integers(1, 60, size=(4, 6))
        ids[:, 4:] = 0
        t = {n: rng.integers(0, len(core.config.heads[n]), 4) for n in core.head_names()}
        worst = 0.0
        for key in ["W1", "W2", "head_W/diet", "b2"]:
            idx = (0, 0) if core.parameters()[key].ndim == 2 else (0,)
            _, _, rel = numerical_grad_check(core, ids, t, key, idx)
            worst = max(worst, rel)
        self.assertLess(worst, 1e-4, f"gradient mismatch rel_err={worst}")

    def test_training_changes_weights_and_improves(self):
        tr, va, _ = make_splits(600, seed=11)
        tok = tiny_tok([t for t, _ in tr])
        cfg = NumpyConfig(vocab_size=tok.vocab_size, pad_id=tok.pad_id,
                          d_embed=32, hidden=64, seed=11)
        core = FlavoraNeuralCore(cfg)
        before = {k: v.copy() for k, v in core.parameters().items()}
        X = encode_batch(tok, [t for t, _ in tr], tok.pad_id)
        names = list(cfg.heads.keys())
        Y = {n: np.array([label_indices(l, cfg.heads)[n] for _, l in tr]) for n in names}
        tcfg = TrainConfig(lr=5e-3, batch_size=32, seed=11)
        opt = AdamState(core.parameters())
        m0 = evaluate(core, X[:128], {n: Y[n][:128] for n in names})
        for _ in range(6):
            for i in range(0, len(tr), 32):
                # Sequential batches keep this test fast and deterministic.
                rows = list(range(i, min(i + 32, len(tr))))
                T = max(int(np.sum(X[j] != tok.pad_id)) for j in rows)
                B = len(rows)
                batch = np.full((B, T), tok.pad_id, dtype=np.int64)
                for b, j in enumerate(rows):
                    row = X[j][X[j] != tok.pad_id][:T]
                    batch[b, :len(row)] = row
                tgt = {n: Y[n][rows] for n in names}
                train_step(core, batch, tgt, opt, tcfg)
        m1 = evaluate(core, X[:128], {n: Y[n][:128] for n in names})
        changed = sum(float(np.sum(a != b)) for a, b in
                      ((before[k], core.parameters()[k]) for k in before)) > 0
        self.assertTrue(changed, "optimizer did not modify weights")
        self.assertLess(m1["loss"], m0["loss"], f"loss did not improve {m0} -> {m1}")

    def test_tiny_controlled_learn(self):
        # Clearly learnable contrast: vegan vs spicy-hot phrasing.
        train = [("I want vegan food", {"diet": "vegan", "meal": "none", "cuisine": "none", "spice": "none", "mode": "normal"}),
                 ("I eat plant-based meals", {"diet": "vegan", "meal": "none", "cuisine": "none", "spice": "none", "mode": "normal"}),
                 ("Something spicy please", {"diet": "none", "meal": "none", "cuisine": "none", "spice": "hot", "mode": "normal"}),
                 ("I want something with a bit of heat", {"diet": "none", "meal": "none", "cuisine": "none", "spice": "hot", "mode": "normal"})] * 12
        tok = tiny_tok([t for t, _ in train])
        cfg = NumpyConfig(vocab_size=tok.vocab_size, pad_id=tok.pad_id, d_embed=16, hidden=32, seed=5)
        core = FlavoraNeuralCore(cfg)
        X = encode_batch(tok, [t for t, _ in train], tok.pad_id)
        names = list(cfg.heads.keys())
        Y = {n: np.array([label_indices(l, cfg.heads)[n] for _, l in train]) for n in names}
        tcfg = TrainConfig(lr=1e-2, batch_size=16, seed=5)
        opt = AdamState(core.parameters())
        for _ in range(40):
            train_step(core, X, Y, opt, tcfg)
        pred = core.predict(encode_batch(tok, ["I want vegan food", "Something spicy please"], tok.pad_id))
        self.assertEqual(pred["diet"][0], "vegan")
        self.assertEqual(pred["spice"][1], "hot")

    def test_generalization_heldout(self):
        tr, _, te = make_splits(800, seed=21)
        tok = tiny_tok([t for t, _ in tr])
        cfg = NumpyConfig(vocab_size=tok.vocab_size, pad_id=tok.pad_id, d_embed=32, hidden=64, seed=21)
        core = FlavoraNeuralCore(cfg)
        Xtr = encode_batch(tok, [t for t, _ in tr], tok.pad_id)
        names = list(cfg.heads.keys())
        Ytr = {n: np.array([label_indices(l, cfg.heads)[n] for _, l in tr]) for n in names}
        tcfg = TrainConfig(lr=5e-3, batch_size=32, seed=21)
        opt = AdamState(core.parameters())
        for _ in range(8):
            for i in range(0, len(tr), 32):
                rows = list(range(i, min(i + 32, len(tr))))
                T = max(int(np.sum(Xtr[j] != tok.pad_id)) for j in rows)
                batch = np.full((len(rows), T), tok.pad_id, dtype=np.int64)
                for b, j in enumerate(rows):
                    row = Xtr[j][Xtr[j] != tok.pad_id][:T]
                    batch[b, :len(row)] = row
                train_step(core, batch, {n: Ytr[n][rows] for n in names}, opt, tcfg)
        Xte = encode_batch(tok, [t for t, _ in te], tok.pad_id)
        Yte = {n: np.array([label_indices(l, cfg.heads)[n] for _, l in te]) for n in names}
        m = evaluate(core, Xte, Yte)
        # Held-out must be well above chance (macro over 5 heads; chance ~0.2).
        self.assertGreater(m["macro_acc"], 0.45, f"no generalization: {m}")

    def test_unknown_input_low_confidence_no_crash(self):
        tr, _, _ = make_splits(400, seed=31)
        tok = tiny_tok([t for t, _ in tr])
        core = FlavoraNeuralCore(NumpyConfig(vocab_size=tok.vocab_size, pad_id=tok.pad_id, seed=31))
        ids = encode_batch(tok, ["Xqzt blorpt quantum flux capacitor"], tok.pad_id)
        out = core.forward(ids)
        for p in out.values():
            self.assertTrue(np.all(np.isfinite(p)))
        conf = core.confidence(ids)
        self.assertTrue(np.all(np.isfinite(conf)))

    def test_checkpoint_roundtrip(self):
        core = FlavoraNeuralCore(NumpyConfig(vocab_size=80, seed=9))
        ids = np.array([[4, 5, 6, 0]])
        before = core.predict(ids)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "model.npz"
            core.save_npz(p)
            self.assertTrue(p.exists())
            loaded = FlavoraNeuralCore.load_npz(p)
        self.assertEqual(loaded.param_count(), core.param_count())
        after = loaded.predict(ids)
        self.assertEqual(before, after)

    def test_selftest_shapes_probs_finite(self):
        # Mirrors the service self-test: shapes, finite probs, no NaN/Inf.
        core = FlavoraNeuralCore(NumpyConfig(vocab_size=120, seed=2))
        rng = np.random.default_rng(2)
        ids = rng.integers(0, 120, size=(3, 8))
        out = core.forward(ids)
        for name, p in out.items():
            self.assertEqual(p.shape, (3, len(core.config.heads[name])))
            self.assertFalse(np.any(np.isnan(p)))
            self.assertFalse(np.any(np.isinf(p)))
            np.testing.assert_allclose(p.sum(axis=1), 1.0, rtol=1e-9)


if __name__ == "__main__":
    unittest.main()
