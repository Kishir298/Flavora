"""Tests for the FlavoraLM dataset generator: variation, format, safety fields."""

import json
import unittest

from training.flavora_lm.dataset import generate_examples, format_example, read_jsonl, write_jsonl
from training.flavora_lm.tokenizer import BPETokenizer, train_tokenizer


class TestDataset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples = list(generate_examples(500, seed=7))

    def test_generates_requested_count(self):
        self.assertEqual(len(self.examples), 500)

    def test_variation_not_template(self):
        texts = [t for t, _ in self.examples]
        self.assertGreater(len(set(texts)), 450)  # near-unique phrasings
        self.assertGreater(max(len(t) for t in texts), 60)  # long examples exist
        self.assertLess(min(len(t) for t in texts), 40)  # short ones too

    def test_safety_fields_present(self):
        # Allergy extraction examples must exist — the model must learn to
        # surface allergies as data, never as safety verdicts.
        with_allergy = [i for _, i in self.examples if i.get("allergies")]
        with_avoid = [i for _, i in self.examples if i.get("avoidFoods")]
        self.assertGreater(len(with_allergy), 30)
        self.assertGreater(len(with_avoid), 20)
        for intent in with_allergy:
            self.assertIsInstance(intent["allergies"], list)

    def test_targets_schema_sane(self):
        for _, intent in self.examples[:100]:
            self.assertEqual(intent.get("intent"), "recommend")
            if "timeLimit" in intent:
                self.assertTrue(5 <= intent["timeLimit"] <= 180)
            if "spicePreference" in intent:
                self.assertIn(intent["spicePreference"], ("mild", "medium", "hot"))
            if "mode" in intent:
                self.assertIn(intent["mode"], ("normal", "food_waste", "budget"))

    def test_jsonl_roundtrip(self):
        import tempfile, os

        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "train.jsonl")
            write_jsonl(p, self.examples[:50])
            loaded = read_jsonl(p)
            self.assertEqual(loaded, self.examples[:50])
            with open(p, encoding="utf-8") as f:
                obj = json.loads(f.readline())
            self.assertIn("input", obj)
            self.assertIn("target", obj)

    def test_format_example_bounds_and_specials(self):
        t = train_tokenizer(["i have chicken and rice", "warm comforting food", "spicy noodles"] * 8, vocab_size=300)
        tok = BPETokenizer(t.vocab, t.merges)
        text, intent = self.examples[0]
        ids = format_example(tok, text, intent, max_len=128)
        self.assertLessEqual(len(ids), 128)
        self.assertEqual(ids[0], tok.bos_id)
        self.assertEqual(ids[1], tok.user_id)
        self.assertIn(tok.assistant_id, ids)
        self.assertEqual(ids[-1], tok.eos_id)


if __name__ == "__main__":
    unittest.main()
