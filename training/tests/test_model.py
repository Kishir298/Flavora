"""Smoke tests for the FlavoraLM Transformer (small config, CPU, fast)."""

import unittest

import torch

from training.flavora_lm.model import FlavoraLM, FlavoraLMConfig
from training.flavora_lm.tokenizer import BPETokenizer, train_tokenizer

CORPUS = ["i have chicken and rice", "spicy noodles tonight", "warm comforting soup"] * 10


def tiny_cfg(vocab_size: int) -> FlavoraLMConfig:
    return FlavoraLMConfig(
        vocab_size=vocab_size,
        context_length=32,
        embedding_dim=32,
        layers=2,
        attention_heads=4,
        feed_forward_dim=64,
        dropout=0.0,
    )


class TestModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        t = train_tokenizer(CORPUS, vocab_size=200)
        cls.tok = BPETokenizer(t.vocab, t.merges)
        cls.cfg = tiny_cfg(cls.tok.vocab_size)
        torch.manual_seed(42)
        cls.model = FlavoraLM(cls.cfg)

    def test_forward_shapes_and_loss(self):
        B, T = 4, 16
        idx = torch.randint(0, self.cfg.vocab_size, (B, T))
        targets = torch.randint(0, self.cfg.vocab_size, (B, T))
        logits, loss = self.model(idx, targets)
        self.assertEqual(tuple(logits.shape), (B, T, self.cfg.vocab_size))
        self.assertTrue(torch.isfinite(loss))

    def test_loss_starts_near_expected_random_value(self):
        # ln(vocab) is the expected loss for uniform random init.
        idx = torch.randint(0, self.cfg.vocab_size, (2, 8))
        targets = torch.randint(0, self.cfg.vocab_size, (2, 8))
        _, loss = self.model(idx, targets)
        expected = torch.log(torch.tensor(float(self.cfg.vocab_size)))
        self.assertLess(abs(loss.item() - expected.item()), 0.7)

    def test_training_step_reduces_loss(self):
        torch.manual_seed(0)
        m = FlavoraLM(tiny_cfg(self.tok.vocab_size))
        opt = torch.optim.AdamW(m.parameters(), lr=1e-3)
        ids = torch.tensor([self.tok.encode("i have chicken and rice")] * 4)
        x, y = ids[:, :-1], ids[:, 1:]
        first = None
        for i in range(30):
            _, loss = m(x, y)
            if first is None:
                first = loss.item()
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(m.parameters(), 1.0)
            opt.step()
        self.assertLess(loss.item(), first)

    def test_generate_shapes_and_controls(self):
        ids = torch.tensor([self.tok.encode("chicken")])
        out = self.model.generate(ids, max_new_tokens=10, temperature=0.8, top_k=20, top_p=0.9, eos_id=self.tok.eos_id)
        self.assertEqual(out.shape[0], 1)
        self.assertGreaterEqual(out.shape[1], ids.shape[1] + 1)
        self.assertTrue(bool((out >= 0).all()) and bool((out < self.cfg.vocab_size).all()))

    def test_generate_respects_context_window(self):
        long_idx = torch.randint(0, self.cfg.vocab_size, (1, self.cfg.context_length + 50))
        out = self.model.generate(long_idx, max_new_tokens=3)
        self.assertEqual(out.shape[1], long_idx.shape[1] + 3)

    def test_save_load_roundtrip(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            d = Path(td) / "v0"
            meta = self.model.save_pretrained(d, tokenizer_version="0.1", extra={"trainedAt": "2026-09-16T00:00:00Z"})
            self.assertEqual(meta["model"], "FlavoraLM")
            loaded = FlavoraLM.load_pretrained(d)
            idx = torch.tensor([self.tok.encode("chicken")])
            torch.manual_seed(7)
            a = self.model.generate(idx, max_new_tokens=5, temperature=1e-9, top_k=None, top_p=None)
            torch.manual_seed(7)
            b = loaded.generate(idx, max_new_tokens=5, temperature=1e-9, top_k=None, top_p=None)
            self.assertTrue(torch.equal(a, b))

    def test_config_roundtrip_ignores_unknown_fields(self):
        cfg = tiny_cfg(100)
        d = cfg.to_dict()
        d["futureField"] = 123
        cfg2 = FlavoraLMConfig.from_dict(d)
        self.assertEqual(cfg2.vocab_size, 100)
        self.assertFalse(hasattr(cfg2, "futureField"))

    def test_epoch_batches_mask_prompt_positions(self):
        # (ids, target_start) pairs: prompt positions must be -100 in y so
        # the loss trains the structured completion, not the prompt.
        import training.train as train_mod
        from training.flavora_lm.dataset import format_example, target_start_index

        text, intent = "i have chicken", {"intent": "recommend", "ingredients": ["chicken"]}
        ids = format_example(self.tok, text, intent, 64)
        start = target_start_index(self.tok, text, 64)
        rng = torch.Generator().manual_seed(0)
        x, y = next(train_mod.epoch_batches([(ids, start)], 1, self.tok.pad_id, rng))
        # y[b,t] predicts x[b,t+1]; slots with t+1 < start (predicting prompt
        # tokens) are masked, the first unmasked slot predicts ids[start].
        self.assertGreater(start, 1)
        self.assertTrue(bool(((y[0, : start - 1] == -100)).all()))
        self.assertEqual(y[0, start - 1].item(), ids[start])

    def test_epoch_batches_accept_bare_id_lists(self):
        import training.train as train_mod

        ids = self.tok.encode("i have chicken and rice")
        rng = torch.Generator().manual_seed(0)
        x, y = next(train_mod.epoch_batches([ids], 2, self.tok.pad_id, rng))
        self.assertEqual(tuple(x.shape), (1, len(ids)))
        self.assertEqual(y[0, 0].item(), ids[1])


if __name__ == "__main__":
    unittest.main()
