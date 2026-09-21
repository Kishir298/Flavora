#!/usr/bin/env python
"""Deterministic paraphrase-rich dataset for the v0.2 NumPy core.

Supervised heads (minimal-first): diet / meal / cuisine / spice / mode.
Label `0` on every head except mode means "not expressed" (maps to the
`none` class; mode defaults to `normal`).

Design rules:
- Genuine linguistic variation (paraphrase banks per slot value), never
  trivial case/punctuation copies.
- Every labeled slot value appears verbatim-in-spirit in the text (a
  paraphrase of it), so the model learns meaning, not hallucination.
- Ingredients may appear as realistic context but are NEVER supervised here
  (ingredients/allergies/avoidFoods stay deterministic by architecture).
- Reproducible: random.Random(seed) only; same (count, seed) -> same data.

Versions: NUMPY_DATASET_VERSION 0.1.
"""

from __future__ import annotations

import random
from typing import Dict, Iterator, List, Tuple

import numpy as np

NUMPY_DATASET_VERSION = "0.1"

OPENERS = ["", "please ", "can you find me ", "i want ", "i feel like ",
           "i'm craving ", "could you suggest ", "looking for "]
FILLERS = ["", " tonight", " for dinner", " please", " today",
           " that is comforting", " that is light", " for the family"]

DIET_PHRASES: Dict[str, List[str]] = {
    "vegan": ["vegan food", "something vegan", "i'm vegan",
              "i don't eat animal products", "i eat plant-based",
              "plant based food", "strictly plant based"],
    "vegetarian": ["vegetarian food", "something vegetarian", "i'm vegetarian",
                   "i don't eat meat", "no meat for me", "meatless dinner",
                   "veggie meal"],
    "non-vegetarian": ["non-veg food", "something non vegetarian",
                       "i eat meat", "with chicken", "meat is fine",
                       "non veg dinner"],
}

MEAL_PHRASES: Dict[str, List[str]] = {
    "breakfast": ["for breakfast", "breakfast idea", "morning breakfast"],
    "lunch": ["for lunch", "lunch idea", "midday lunch"],
    "dinner": ["for dinner", "dinner idea", "dinner tonight"],
    "snack": ["a snack", "snack idea", "light snack", "just a snack"],
}

CUISINE_PHRASES: Dict[str, List[str]] = {
    "italian": ["italian food", "something italian", "italian dinner"],
    "mexican": ["mexican food", "something mexican", "mexican dinner"],
    "chinese": ["chinese food", "something chinese", "chinese dinner"],
    "indian": ["indian food", "something indian", "indian dinner"],
    "japanese": ["japanese food", "something japanese", "japanese dinner"],
    "thai": ["thai food", "something thai", "thai dinner"],
    "french": ["french food", "something french", "french dinner"],
    "spanish": ["spanish food", "something spanish", "spanish dinner"],
    "greek": ["greek food", "something greek", "greek dinner"],
    "american": ["american food", "something american", "american dinner"],
}

SPICE_PHRASES: Dict[str, List[str]] = {
    "mild": ["something mild", "mild food", "not spicy at all", "gentle flavor"],
    "medium": ["medium spice", "a bit of spice", "moderately spiced"],
    "hot": ["something spicy", "spicy food", "i want something with a bit of heat",
            "i feel like eating something hot", "hot and spicy", "extra spicy"],
}

MODE_PHRASES: Dict[str, List[str]] = {
    "food_waste": ["use up leftovers", "before they expire", "from the fridge",
                   "use what i have", "leftovers dinner"],
    "budget": ["cheap meal", "budget dinner", "something cheap", "low cost meal"],
}

# Realistic unsupervized context (ingredients are NOT labels here).
INGREDIENT_CONTEXT = ["with tomatoes", "with onion and lettuce", "with chicken",
                      "with rice", "with whatever vegetables i have",
                      "with pasta", "with potatoes", ""]

CRAVING_CONTEXT = ["and comforting", "something light", "cozy dinner",
                   "fresh and light", "hearty meal", ""]


def _compose(rng: random.Random, parts: List[str]) -> str:
    opener = rng.choice(OPENERS)
    filler = rng.choice(FILLERS) if rng.random() < 0.35 else ""
    text = f"{opener}{' '.join(p for p in parts if p)}{filler}".strip()
    text = text[0].upper() + text[1:] if text else text
    if text and not text.endswith((".", "?", "!")):
        text += "."
    return text


def generate_numpy_examples(count: int, seed: int = 42
                            ) -> Iterator[Tuple[str, Dict[str, str]]]:
    """Yield (text, labels) with labels in {diet,meal,cuisine,spice,mode}.

    `none` = slot not expressed (mode uses `normal` instead).
    """
    rng = random.Random(seed)
    made = 0
    while made < count:
        labels = {"diet": "none", "meal": "none", "cuisine": "none",
                  "spice": "none", "mode": "normal"}
        parts: List[str] = []
        # 1-3 slots per example so the model learns compositional language.
        n_slots = 1 + int(rng.random() * 3)
        slots = rng.sample(["diet", "meal", "cuisine", "spice", "mode"], k=min(n_slots, 5))
        for slot in slots:
            r = rng.random()
            if slot == "diet" and r < 0.55:
                v = rng.choice(["vegan", "vegetarian", "non-vegetarian"])
                labels["diet"] = v
                parts.append(rng.choice(DIET_PHRASES[v]))
            elif slot == "meal" and r < 0.7:
                v = rng.choice(list(MEAL_PHRASES.keys()))
                labels["meal"] = v
                parts.append(rng.choice(MEAL_PHRASES[v]))
            elif slot == "cuisine" and r < 0.7:
                v = rng.choice(list(CUISINE_PHRASES.keys()))
                labels["cuisine"] = v
                parts.append(rng.choice(CUISINE_PHRASES[v]))
            elif slot == "spice" and r < 0.7:
                v = rng.choice(list(SPICE_PHRASES.keys()))
                labels["spice"] = v
                parts.append(rng.choice(SPICE_PHRASES[v]))
            elif slot == "mode" and r < 0.5:
                v = rng.choice(["food_waste", "budget"])
                labels["mode"] = v
                parts.append(rng.choice(MODE_PHRASES[v]))
        if rng.random() < 0.45:
            parts.append(rng.choice(INGREDIENT_CONTEXT))
        if rng.random() < 0.25:
            parts.append(rng.choice(CRAVING_CONTEXT))
        parts = [p for p in parts if p]
        if not parts:
            parts = ["something tasty"]
        yield _compose(rng, parts), labels
        made += 1


def label_indices(labels: Dict[str, str], heads) -> Dict[str, int]:
    out = {}
    for name, names in heads.items():
        val = labels.get(name, names[0])
        out[name] = names.index(val) if val in names else 0
    return out


def make_splits(count: int, seed: int = 42, val_frac: float = 0.15,
                test_frac: float = 0.15
                ) -> Tuple[List[Tuple[str, Dict[str, str]]], ...]:
    """Deterministic train/val/test split with cross-split text dedupe."""
    all_ex = list(generate_numpy_examples(count, seed))
    n_val = int(count * val_frac)
    n_test = int(count * test_frac)
    train = all_ex[: count - n_val - n_test]
    val = all_ex[count - n_val - n_test: count - n_test]
    test = all_ex[count - n_test:]
    seen = {t for t, _ in train}
    val = [ex for ex in val if ex[0] not in seen]
    seen |= {t for t, _ in val}
    test = [ex for ex in test if ex[0] not in seen]
    return train, val, test


def encode_batch(tokenizer, texts: List[str], pad_id: int) -> np.ndarray:
    seqs = [tokenizer.encode(t, add_special=False) or [tokenizer.unk_id] for t in texts]
    T = max(len(s) for s in seqs)
    batch = np.full((len(seqs), T), pad_id, dtype=np.int64)
    for i, s in enumerate(seqs):
        batch[i, :len(s)] = np.asarray(s, dtype=np.int64)
    return batch


def class_balance(examples: List[Tuple[str, Dict[str, str]]]) -> Dict[str, Dict[str, int]]:
    bal: Dict[str, Dict[str, int]] = {}
    for _, labels in examples:
        for k, v in labels.items():
            bal.setdefault(k, {}).setdefault(v, 0)
            bal[k][v] += 1
    return bal
