"""Unit tests for the resumable evaluation runner (no model required)."""

import json
import tempfile
import unittest
from pathlib import Path

from training.evaluate import (
    append_record,
    dataset_id,
    example_id,
    filter_resume,
    load_checkpoint,
    summarize,
)


class TestExampleIds(unittest.TestCase):
    def test_stable_and_unique(self):
        self.assertEqual(example_id(0, "hello"), example_id(0, "hello"))
        self.assertNotEqual(example_id(0, "hello"), example_id(1, "hello"))
        self.assertNotEqual(example_id(0, "hello"), example_id(0, "world"))
        self.assertRegex(example_id(3, "x"), r"^ex-0003-[0-9a-f]{8}$")

    def test_dataset_id_stable(self):
        with tempfile.TemporaryDirectory() as td:
            f = Path(td) / "t.jsonl"
            f.write_text('{"a":1}\n', encoding="utf-8")
            a = dataset_id(str(f), 1)
            b = dataset_id(str(f), 1)
            self.assertEqual(a, b)
            self.assertIn("t.jsonl:1:", a)
            self.assertNotEqual(a, dataset_id(str(f), 2))


class TestCheckpoint(unittest.TestCase):
    def test_round_trip_and_resume_set(self):
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td) / "ckpt.jsonl"
            self.assertEqual(load_checkpoint(ckpt), {})
            append_record(ckpt, {"id": "ex-0000-ab", "status": "pass"})
            append_record(ckpt, {"id": "ex-0001-cd", "status": "fail"})
            done = load_checkpoint(ckpt)
            self.assertEqual(set(done), {"ex-0000-ab", "ex-0001-cd"})
            # Later duplicate writes win (idempotent resume).
            append_record(ckpt, {"id": "ex-0000-ab", "status": "error"})
            self.assertEqual(load_checkpoint(ckpt)["ex-0000-ab"]["status"], "error")

    def test_corrupt_lines_skipped(self):
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td) / "ckpt.jsonl"
            ckpt.write_text('not json\n{"id": "ex-1"}\n\n{"no": "id"}\n', encoding="utf-8")
            done = load_checkpoint(ckpt)
            self.assertEqual(set(done), {"ex-1"})


class TestFilterResume(unittest.TestCase):
    def test_stale_dataset_records_ignored(self):
        recs = {
            "a": {"id": "a", "datasetId": "ds:1"},
            "b": {"id": "b", "datasetId": "other:9"},
            "c": {"id": "c"},  # pre-v1.1.0 record: trusted
        }
        kept, stale = filter_resume(recs, "ds:1")
        self.assertEqual(set(kept), {"a", "c"})
        self.assertEqual(stale, 1)


class TestSummarize(unittest.TestCase):
    def test_avg_median_slowest(self):
        s = summarize([10.0, 30.0, 20.0, 50.0, 40.0])
        self.assertAlmostEqual(s["avgMs"], 30.0)
        self.assertAlmostEqual(s["medianMs"], 30.0)
        self.assertEqual(s["slowestMs"], [50.0, 40.0, 30.0, 20.0, 10.0])

    def test_even_median_and_empty(self):
        s = summarize([10.0, 20.0])
        self.assertAlmostEqual(s["medianMs"], 15.0)
        self.assertEqual(summarize([])["avgMs"], None)


if __name__ == "__main__":
    unittest.main()
