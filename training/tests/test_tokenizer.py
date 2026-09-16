"""Unit tests for the FlavoraLM BPE tokenizer (pure Python, no torch)."""

import json
import tempfile
import unittest
from pathlib import Path

from training.flavora_lm.tokenizer import (
    BPETokenizer,
    SPECIAL_TOKENS,
    train_tokenizer,
)

CORPUS = [
    "i have chicken and rice give me something warm and comforting in 30 minutes",
    "i am allergic to peanuts what can i cook with pasta and tomato",
    "quick spicy chicken dinner under 20 minutes",
    "use leftovers in the fridge food waste mode",
    "cheap budget meals with eggs and onions",
    "creamy mushroom pasta with garlic",
    "cold refreshing salad for a hot day",
] * 5


class TestTokenizer(unittest.TestCase):
    def test_train_deterministic(self):
        a = train_tokenizer(CORPUS, vocab_size=400)
        b = train_tokenizer(CORPUS, vocab_size=400)
        self.assertEqual(a.vocab, b.vocab)
        self.assertEqual(a.merges, b.merges)

    def test_special_tokens_first_ids(self):
        t = train_tokenizer(CORPUS, vocab_size=400)
        tok = BPETokenizer(t.vocab, t.merges)
        for i, name in enumerate(SPECIAL_TOKENS):
            self.assertEqual(tok.vocab[name], i)

    def test_roundtrip(self):
        t = train_tokenizer(CORPUS, vocab_size=500)
        tok = BPETokenizer(t.vocab, t.merges)
        text = "i have chicken and rice"
        ids = tok.encode(text)
        self.assertTrue(all(0 <= i < tok.vocab_size for i in ids))
        self.assertEqual(tok.decode(ids), text)

    def test_unknown_words_map_to_chars_or_unk(self):
        t = train_tokenizer(CORPUS, vocab_size=500)
        tok = BPETokenizer(t.vocab, t.merges)
        ids = tok.encode("zzzzqqqq")
        self.assertTrue(len(ids) > 0)
        self.assertTrue(all(0 <= i < tok.vocab_size for i in ids))

    def test_save_load_roundtrip(self):
        t = train_tokenizer(CORPUS, vocab_size=400)
        tok = BPETokenizer(t.vocab, t.merges)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "tokenizer.json"
            tok.save(p)
            loaded = BPETokenizer.load(p)
            self.assertEqual(loaded.vocab, tok.vocab)
            self.assertEqual(loaded.merges, tok.merges)
            self.assertEqual(loaded.encode("spicy chicken"), tok.encode("spicy chicken"))

    def test_add_special_wraps_user_turn(self):
        t = train_tokenizer(CORPUS, vocab_size=400)
        tok = BPETokenizer(t.vocab, t.merges)
        ids_plain = tok.encode("hi")
        ids_special = tok.encode("hi", add_special=True)
        self.assertEqual(ids_special[0], tok.bos_id)
        self.assertEqual(ids_special[1], tok.user_id)
        self.assertEqual(ids_special[-1], tok.eos_id)
        self.assertEqual(ids_special[2:-1], ids_plain)

    def test_vocab_respects_target(self):
        # Tiny corpora saturate below the target; the cap must still hold.
        t = train_tokenizer(CORPUS, vocab_size=350)
        self.assertLessEqual(len(t.vocab), 350)
        self.assertGreater(len(t.vocab), 150)

    def test_serialized_shape(self):
        t = train_tokenizer(CORPUS, vocab_size=400)
        tok = BPETokenizer(t.vocab, t.merges)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "tokenizer.json"
            tok.save(p)
            payload = json.loads(p.read_text())
        self.assertEqual(payload["type"], "flavora-bpe")
        self.assertIn("<PAD>", payload["special_tokens"])

    def test_json_syntax_roundtrip(self):
        # Structured targets must survive tokenization: braces, quotes,
        # colons and commas are singleton tokens, never stripped.
        t = train_tokenizer(CORPUS, vocab_size=500)
        tok = BPETokenizer(t.vocab, t.merges)
        target = '{"intent":"recommend","ingredients":["chicken","rice"],"timeLimit":30}'
        decoded = tok.decode(tok.encode(target))
        # Structure (braces/quotes/colons/commas/values) survives exactly;
        # word case is lowered by design and recovered by intent canonicalization.
        self.assertEqual(
            {k.lower(): v for k, v in json.loads(decoded).items()},
            {k.lower(): v for k, v in json.loads(target).items()},
        )

    def test_digits_always_encodable(self):
        # Time limits/servings must survive even with unseen digit combos.
        t = train_tokenizer(CORPUS, vocab_size=500)
        tok = BPETokenizer(t.vocab, t.merges)
        for num in ("7", "18", "75", "120", "180"):
            ids = tok.encode(num)
            self.assertNotIn(tok.unk_id, ids, f"{num} should not need UNK")
            self.assertEqual(tok.decode(ids), num)

    def test_case_mangled_keys_canonicalize(self):
        # The tokenizer lowercases words; intent normalization must still
        # recover camelCase schema keys (timeLimit, avoidFoods, ...).
        from training.flavora_lm.intent import normalize_intent

        out = normalize_intent({"timelimit": 30, "avoidfoods": ["mushrooms"]})
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out.get("timeLimit"), 30)
        self.assertEqual(out.get("avoidFoods"), ["mushrooms"])


if __name__ == "__main__":
    unittest.main()
