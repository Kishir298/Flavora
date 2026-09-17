"""Structured intent extraction with FlavoraLM.

Pipeline: constrained beam-search generation → JSON parse →
schema-validate → normalize → bounds-check. Invalid model output never
crashes the caller; it returns None so the server can fall back to
deterministic parsing.

Decoding (all deterministic — same input yields the same intent):
every content decision is the model's own likelihood judgment, expressed
through two task priors that keep the tiny model on the learned manifold:

1. Intent grammar (`valid_prefix`): only tokens that keep the output a
   valid prefix of the Flavora intent JSON language may be emitted, so
   output is parseable by construction (still validated afterwards).
2. Copy priors (`_field_bonus`): tokens reproducing request words/numbers
   get a fixed bonus routed by the open field (ingredients vs
   allergies/avoid-foods vs craving), so content comes from the request
   instead of marginal-frequency attractors. Negation scope
   (`_negated_words`) bars rejected foods from ingredient slots.

Beam search (length-normalized log-probability) finds globally good
sequences that greedy decoding misses on a flat distribution.
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional

import torch

from .model import FlavoraLM
from .tokenizer import BPETokenizer

VALID_INTENTS = {"recommend", "plan", "grocery", "inventory", "substitute", "chat"}
VALID_MODES = {"normal", "food_waste", "budget"}
VALID_SPICE = {"mild", "medium", "hot"}
VALID_SKILL = {"beginner", "intermediate", "advanced"}
VALID_DIET = {"vegetarian", "non-vegetarian", "vegan", "any"}
VALID_CUISINES = {
    "italian", "indian", "chinese", "japanese", "mexican", "french",
    "american", "mediterranean", "middle eastern", "african",
}
VALID_TEMPERATURE = {"warm", "hot dish", "cold", "chilled"}
VALID_MOODS = {"comforting", "cozy", "refreshing", "indulgent", "homely"}
VALID_FLAVORS = {"spicy", "savory", "sweet", "tangy", "smoky", "fresh", "cheesy", "umami", "herby"}
VALID_TEXTURES = {"crispy", "crunchy", "creamy", "tender", "fluffy", "chewy"}
VALID_SATIETY = {"filling", "hearty", "light", "substantial"}
VALID_MEAL_STYLE = {"quick", "one-pot", "snack", "breakfast", "dessert", "handheld"}

_MAX_LIST = 12
_MAX_ITEMS = 6


def _as_str_list(v) -> Optional[List[str]]:
    if not isinstance(v, list):
        return None
    out = []
    for x in v[:_MAX_LIST]:
        s = str(x).lower().strip()
        if s and s not in out:
            out.append(s)
    return out or None


def _as_time(v) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = int(round(v))
    elif isinstance(v, str):
        m = re.search(r"\d+", v)
        if not m:
            return None
        n = int(m.group(0))
    else:
        return None
    if n < 5 or n > 180:
        return None
    return n


def _as_cuisine(v) -> Optional[str]:
    if not isinstance(v, str):
        return None
    c = v.lower().strip()
    for known in VALID_CUISINES:
        if known in c or c in known:
            return known
    return None


def _filter_set(v, allowed) -> Optional[List[str]]:
    items = _as_str_list(v)
    if not items:
        return None
    out = [x for x in items if x in allowed]
    return out or None


def _as_craving_signals(v) -> Optional[Dict]:
    if not isinstance(v, dict):
        return None
    # Keys arrive lowercased from the tokenizer (`mealstyle` for `mealStyle`).
    lowered = {str(k).lower(): val for k, val in v.items()}
    out: Dict = {}
    dims = {
        "temperature": VALID_TEMPERATURE,
        "moods": VALID_MOODS,
        "flavors": VALID_FLAVORS,
        "textures": VALID_TEXTURES,
        "satiety": VALID_SATIETY,
        "mealstyle": VALID_MEAL_STYLE,
    }
    canon_dim = {"mealstyle": "mealStyle"}
    for dim, allowed in dims.items():
        vals = _filter_set(lowered.get(dim), allowed)
        if vals:
            out[canon_dim.get(dim, dim)] = vals[:_MAX_ITEMS]
    return out or None


def _canon_keys(raw: dict) -> dict:
    """Map case-mangled keys back to canonical schema keys.

    The FlavoraLM tokenizer lowercases word pieces, so model output arrives
    with keys like ``timelimit``/``avoidfoods``/``cravingsignals``. Matching
    is case-insensitive; unknown keys are still dropped by normalize_intent.
    """
    canon = {
        "intent": "intent",
        "ingredients": "ingredients",
        "availableingredients": "ingredients",
        "allergies": "allergies",
        "avoidfoods": "avoidFoods",
        "timelimit": "timeLimit",
        "maxtime": "timeLimit",
        "cuisine": "cuisine",
        "mode": "mode",
        "spicepreference": "spicePreference",
        "skilllevel": "skillLevel",
        "craving": "craving",
        "cravingsignals": "cravingSignals",
        "mealtype": "mealType",
        "servings": "servings",
        "calorietarget": "calorieTarget",
        "calories": "calorieTarget",
        "dietarypreference": "dietaryPreference",
        "diet": "dietaryPreference",
    }
    out: dict = {}
    for k, v in raw.items():
        ck = canon.get(str(k).lower().strip())
        if ck and ck not in out:
            out[ck] = v
    return out


def normalize_intent(raw) -> Optional[Dict]:
    """Validate/normalize untrusted model output into the Flavora intent schema.

    Returns None when nothing usable survived validation — never raises.
    """
    if not isinstance(raw, dict):
        return None
    raw = _canon_keys(raw)
    out: Dict = {}

    intent = raw.get("intent")
    if isinstance(intent, str):
        intent = intent.lower().strip()
    out["intent"] = intent if intent in VALID_INTENTS else "recommend"

    for key in ("ingredients", "allergies", "avoidFoods"):
        vals = _as_str_list(raw.get(key))
        if vals:
            out[key] = vals

    t = _as_time(raw.get("timeLimit"))
    if t is not None:
        out["timeLimit"] = t

    c = _as_cuisine(raw.get("cuisine"))
    if c:
        out["cuisine"] = c

    if raw.get("mode") in VALID_MODES:
        out["mode"] = raw["mode"]

    spice = raw.get("spicePreference")
    if spice in VALID_SPICE:
        out["spicePreference"] = spice

    skill = raw.get("skillLevel")
    if skill in VALID_SKILL:
        out["skillLevel"] = skill

    craving = raw.get("craving")
    if isinstance(craving, str) and craving.strip():
        out["craving"] = craving.strip()[:120]

    signals = _as_craving_signals(raw.get("cravingSignals"))
    if signals:
        out["cravingSignals"] = signals

    if raw.get("mealType") in {"breakfast", "lunch", "dinner", "snack", "dessert"}:
        # "dessert" is a mealStyle leak — normalize to snack so TS keeps it.
        out["mealType"] = "snack" if raw["mealType"] == "dessert" else raw["mealType"]

    if isinstance(raw.get("servings"), int) and 1 <= raw["servings"] <= 20:
        out["servings"] = raw["servings"]

    cal = raw.get("calorieTarget")
    if isinstance(cal, bool):
        pass
    elif isinstance(cal, (int, float)) and 50 <= int(round(cal)) <= 5000:
        out["calorieTarget"] = int(round(cal))

    diet = raw.get("dietaryPreference")
    if isinstance(diet, str):
        d = diet.lower().strip().replace("_", "-").replace(" ", "-")
        aliases = {"veg": "vegetarian", "non-veg": "non-vegetarian", "nonveg": "non-vegetarian",
                   "nonvegetarian": "non-vegetarian", "anything": "any", "no-preference": "any"}
        d = aliases.get(d, d)
        if d in VALID_DIET:
            out["dietaryPreference"] = d

    # Always valid JSON, but "empty" output (nothing beyond default intent)
    # is treated as unusable so callers fall back to deterministic parsing.
    if set(out) == {"intent"}:
        return None
    return out


def extract_json_object(text: str):
    """Parse the first JSON object from generated text; None when absent/malformed."""
    if not text or not text.strip():
        return None
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    # Truncated output: attempt to close the object.
    try:
        return json.loads(text[start:] + "}" * depth)
    except json.JSONDecodeError:
        return None


@torch.no_grad()
def extract_intent(
    model: FlavoraLM,
    tok: BPETokenizer,
    text: str,
    max_new_tokens: int = 64,
    beam_width: int = 4,
) -> Optional[Dict]:
    """Constrained beam-search generation → JSON parse → schema validation.

    Scoring is the model's own likelihood: at every step each live hypothesis
    is expanded with its top-ranked grammar-valid continuations, keeping the
    best `beam_width` hypotheses by length-normalized log-probability. Every
    content decision — which keys, which values, in which order — is the
    model's judgment; the grammar only enforces syntactic validity, so output
    is parseable by construction and still validated afterwards.
    Fully deterministic: the same input yields the same structured intent.
    """
    model.eval()
    prompt = tok.encode(text, add_special=False)
    base = [tok.bos_id, tok.user_id] + prompt[: max(0, model.cfg.context_length - max_new_tokens - 3)] + [tok.assistant_id]
    banned = {tok.pad_id, tok.bos_id, tok.user_id, tok.assistant_id, tok.unk_id}
    negated = _negated_words(text)
    content = _content_words(text)
    foods = (content | _FOOD_VOCAB) - _NON_FOOD
    vocab = frozenset(foods)
    craving_vocab = frozenset((content | _CRAVING_VOCAB) - negated)
    ingredient_vocab = frozenset(foods - negated)
    _, copy_numbers = _copy_bonus_set(text)

    # Field-aware copy priors (all deterministic). Only words/numbers from
    # THIS request are ever bonused (never the whole vocabulary), routed by
    # the open field: ingredients boost non-negated foods, allergy/avoid
    # slots boost negated + allergen words, cravings boost craving terms
    # lightly, time/servings boost request numbers. Between keys (structural
    # decisions) no bonus applies — the model chooses keys unaided.
    _bonus_cache: dict = {}

    def _vec(words: set, amount: float) -> "torch.Tensor":
        vec = torch.zeros(model.cfg.vocab_size)
        for tid, piece in tok.id_to_token.items():
            if tid >= model.cfg.vocab_size:
                continue
            stem = _piece_base(piece).lower()
            if not stem:
                continue
            if stem in words:
                vec[tid] = amount
        return vec

    def _field_bonus(field: str) -> "torch.Tensor":
        if field not in _bonus_cache:
            if field in ("allergies", "avoidfoods"):
                words = {w for w in (negated | (_ALLERGEN_WORDS & content)) if len(w) >= 4}
                _bonus_cache[field] = _vec(words, 3.0)
            elif field == "ingredients":
                words = {w for w in (content & ((content | _FOOD_VOCAB) - _NON_FOOD - negated)) if len(w) >= 4}
                _bonus_cache[field] = _vec(words, 3.0)
            elif field == "craving":
                words = {w for w in (content & _CRAVING_VOCAB) if len(w) >= 3}
                _bonus_cache[field] = _vec(words, 1.0)
            elif field in ("timelimit", "servings", "calorietarget"):
                _bonus_cache[field] = _vec(set(copy_numbers), 3.0)
            else:
                _bonus_cache[field] = torch.zeros(model.cfg.vocab_size)
        return _bonus_cache[field]
    # Live beams: (ids, gen_text, sum_logprob, gen_ids).
    beams: list = [(base, "", 0.0, [])]
    finished: list = []  # (gen_text, norm_score)
    for _ in range(max_new_tokens):
        extensions: list = []
        for ids, gen_text, score, gen_ids in beams:
            window = ids if len(ids) <= model.cfg.context_length else ids[-model.cfg.context_length :]
            logits, _ = model(torch.tensor([window], dtype=torch.long))
            row = logits[0, -1].clone()
            # Field-aware copy prior routed by the open key (documented
            # prior, still deterministic). Applied before ranking AND scoring.
            bonus = _field_bonus(_open_key(gen_text))
            if bonus.numel() != row.numel():
                bonus = bonus[: row.numel()]
            row = row + bonus
            # Deterministic repetition penalty over GENERATED tokens only.
            # Prompt tokens are never penalized so the copy signal stays intact.
            for seen in set(gen_ids):
                if 0 <= seen < row.numel():
                    if row[seen] > 0:
                        row[seen] /= 1.15
                    else:
                        row[seen] *= 1.15
            logprobs = torch.log_softmax(row, dim=-1)
            # Scan the full ranking (not just top-K): the model's distribution
            # is flat, so valid continuations can rank far down. Collect a
            # bounded set of valid extensions per beam.
            order = torch.argsort(row, descending=True).tolist()
            scanned = 0
            added = 0
            progressed = False
            for cand in order:
                if added >= beam_width * 3 or scanned >= 120:
                    break
                scanned += 1
                if cand in banned:
                    continue
                if cand == tok.eos_id:
                    try:
                        parsed = json.loads(gen_text)
                        if parsed and normalize_intent(parsed) is not None:
                            extensions.append((ids, gen_text, score + float(logprobs[cand]), gen_ids, True))
                            added += 1
                            progressed = True
                    except (json.JSONDecodeError, ValueError):
                        pass
                    continue
                piece = tok.id_to_token.get(int(cand))
                if piece is None or piece in ("<PAD>", "<UNK>", "<BOS>", "<EOS>", "<USER>", "<ASSISTANT>"):
                    continue
                trial = _grow_text(gen_text, piece)
                if trial == gen_text:
                    # Token adds no visible text (bare whitespace) — emitting
                    # it would stall the beam with phantom progress.
                    continue
                if valid_prefix(trial, vocab, craving_vocab, ingredient_vocab):
                    extensions.append((ids + [cand], trial, score + float(logprobs[cand]), gen_ids + [cand], False))
                    added += 1
                    progressed = True
            if not progressed:
                try:
                    parsed = json.loads(gen_text)
                    if parsed and normalize_intent(parsed) is not None:
                        finished.append((gen_text, _norm_score(score, len(gen_ids))))
                except (json.JSONDecodeError, ValueError):
                    pass
        if not extensions:
            break
        # Length-normalized ranking keeps hypotheses comparable; ties broken
        # deterministically by text so results are repeatable. Deduplicate by
        # text so beams cannot collapse onto identical twins.
        best_by_text: dict = {}
        for ids, gen_text, score, gen_ids, done in extensions:
            prev = best_by_text.get((gen_text, done))
            if prev is None or score > prev[2]:
                best_by_text[(gen_text, done)] = (ids, gen_text, score, gen_ids, done)
        deduped = list(best_by_text.values())
        deduped.sort(key=lambda e: (_norm_score(e[2], len(e[3])), e[1]), reverse=True)
        beams = []
        for ids, gen_text, score, gen_ids, done in deduped[:beam_width]:
            if done:
                finished.append((gen_text, _norm_score(score, len(gen_ids))))
            else:
                beams.append((ids, gen_text, score, gen_ids))
        if not beams:
            break
    pool = list(finished)
    pool += [(gen_text, _norm_score(score, len(gen_ids))) for _, gen_text, score, gen_ids in beams]
    if not pool:
        return None
    pool.sort(key=lambda p: (p[1], p[0]), reverse=True)
    best_text = pool[0][0]
    raw = extract_json_object(best_text)
    return normalize_intent(raw)


def _norm_score(sum_logprob: float, length: int, alpha: float = 1.0) -> float:
    """Length-normalized beam score (plain average) so degenerate short
    outputs cannot win over complete ones on length alone."""
    return sum_logprob / (max(length, 1) ** alpha)


def _piece_text(piece: str) -> str:
    """Render one BPE piece as text (mirrors BPETokenizer.decode)."""
    if piece == "</w>":
        return " "
    if piece.endswith("</w>"):
        return piece[: -len("</w>")] + " "
    return piece


def _grow_text(cur: str, piece: str) -> str:
    """Append one piece and renormalize (same rules as decode)."""
    text = " ".join((cur + _piece_text(piece)).split())
    return re.sub(r"\s*([{}\[\]\",:])\s*", r"\1", text)


# Words the model may use inside free-string values (ingredients, allergies,
# avoid foods, cravings). Combined with the request's own words at decode
# time, this structurally prevents hallucinated values: a string may only
# close when every word comes from the request or Flavora's vocabulary.
_FOOD_VOCAB = frozenset(
    """
    chicken rice pasta tomato onion garlic eggs egg potato carrot bell pepper
    mushrooms mushroom tofu chickpeas lentils spinach cheese yogurt lemon salmon
    shrimp beef pork beans noodles noodle bread butter milk cream peanut peanuts
    groundnut coconut quinoa zucchini corn peas broccoli cauliflower kale cabbage
    avocado apple banana orange lime basil cilantro olives okra eggplant
    celery mustard sesame almond walnut cashew honey chocolate fish tuna turkey
    dairy gluten wheat flour shellfish soy tree nuts nut
    """.split()
)

_CRAVING_VOCAB = frozenset(
    """
    warm cold hot chilled creamy crispy crunchy tender fluffy chewy light hearty
    filling substantial comforting cozy refreshing indulgent homely fresh savory
    sweet tangy smoky spicy umami cheesy herby quick snack breakfast dessert
    handheld pot
    """.split()
)

# Words that are never ingredients, even when they appear in the request
# (meal/context words and craving adjectives must fill their own slots).
_NON_FOOD = frozenset(
    """
    dinner lunch breakfast meal meals dish dishes recipe recipes food foods
    menu minutes minute seconds hour hours tonight today tomorrow
    easy simple fast quick healthy tasty delicious yummy nice good great best
    big small large little lot kind sort type way thing stuff
    allergic allergy allergies intolerant intolerance sensitivity sensitive
    dont avoid without never hate dislike except cant cannot not
    warm cold hot chilled creamy crispy crunchy tender fluffy chewy light hearty
    filling substantial comforting cozy refreshing indulgent homely fresh savory
    sweet tangy smoky spicy umami cheesy herby snack dessert handheld pot
    """.split()
)

# ---------------- intent grammar (constrained decoding) ----------------
#
# The model emits lowercase text (the tokenizer lowercases word pieces), so
# grammar keys are the lowercase forms (`timelimit`, `avoidfoods`,
# `cravingsignals`, …) canonicalized back by _canon_keys after parsing.
# No whitespace is allowed outside strings (training targets use compact
# separators), which keeps prefix checks exact.

_GRAMMAR_KEYS: Dict[str, tuple] = {
    "intent": ("enum", VALID_INTENTS),
    "ingredients": ("strarr", None),
    "allergies": ("strarr", None),
    "avoidfoods": ("strarr", None),
    "timelimit": ("num", None),
    "servings": ("num", None),
    "calorietarget": ("num", None),
    "dietarypreference": ("enum", VALID_DIET),
    "cuisine": ("enum", VALID_CUISINES),
    "mode": ("enum", VALID_MODES),
    "spicepreference": ("enum", VALID_SPICE),
    "skilllevel": ("enum", VALID_SKILL),
    "mealtype": ("enum", frozenset({"breakfast", "lunch", "dinner", "snack", "dessert"})),
    "craving": ("str", None),
    "cravingsignals": ("signals", None),
}

_GRAMMAR_SIGNALS: Dict[str, tuple] = {
    "temperature": ("enumarr", VALID_TEMPERATURE),
    "moods": ("enumarr", VALID_MOODS),
    "flavors": ("enumarr", VALID_FLAVORS),
    "textures": ("enumarr", VALID_TEXTURES),
    "satiety": ("enumarr", VALID_SATIETY),
    "mealstyle": ("enumarr", VALID_MEAL_STYLE),
}

_MAX_GRAMMAR_KEYS = 8
_MAX_GRAMMAR_ITEMS = 8
_MAX_GRAMMAR_STR = 28
_MAX_GRAMMAR_DOC = 600


class _Invalid(Exception):
    pass


class _NeedMore(Exception):
    """End of input mid-construct — still a valid prefix."""


class _Cursor:
    def __init__(self, s: str):
        self.s = s
        self.i = 0

    def eof(self) -> bool:
        return self.i >= len(self.s)

    def peek(self):
        return None if self.eof() else self.s[self.i]

    def take(self, ch: str) -> None:
        if self.eof():
            raise _NeedMore()
        if self.s[self.i] != ch:
            raise _Invalid()
        self.i += 1


def _is_word_char(ch: str) -> bool:
    return "a" <= ch <= "z" or "0" <= ch <= "9" or ch in (" ", "-", ".")


def _parse_string(
    c: _Cursor,
    allowed: Optional[frozenset] = None,
    free: bool = False,
    wordlist: Optional[frozenset] = None,
) -> str:
    c.take('"')
    start = c.i
    while not c.eof() and c.peek() != '"':
        ch = c.peek()
        if not _is_word_char(ch):
            raise _Invalid()
        c.i += 1
        if c.i - start > _MAX_GRAMMAR_STR:
            raise _Invalid()
    frag = c.s[start : c.i]
    if c.eof():
        if allowed is not None and not any(v.startswith(frag) for v in allowed):
            raise _Invalid()
        if wordlist is not None and free:
            _check_partial_words(frag, wordlist)
        raise _NeedMore()
    c.take('"')
    if allowed is not None and frag not in allowed:
        raise _Invalid()
    if not frag:
        # Empty strings are never useful values — reject so search cannot
        # win with degenerate minimal outputs.
        raise _Invalid()
    if wordlist is not None and free and frag:
        _check_whole_words(frag, wordlist)
    return frag


def _frag_words(frag: str) -> List[str]:
    return [w for w in frag.split(" ") if w]


def _check_partial_words(frag: str, wordlist: frozenset) -> None:
    """All complete words must be known; the trailing partial word must be
    completable to a known word (checked on every prefix so dead ends prune)."""
    words = _frag_words(frag)
    if not words:
        return
    for w in words[:-1]:
        if w not in wordlist:
            raise _Invalid()
    partial = words[-1]
    if not any(v.startswith(partial) for v in wordlist):
        raise _Invalid()


def _check_whole_words(frag: str, wordlist: frozenset) -> None:
    for w in _frag_words(frag):
        if w not in wordlist:
            raise _Invalid()


def _parse_key(c: _Cursor, allowed: Dict[str, tuple], used: set, last_key: str = "") -> str:
    c.take('"')
    start = c.i
    while not c.eof() and c.peek() != '"':
        ch = c.peek()
        if not ("a" <= ch <= "z"):
            raise _Invalid()
        c.i += 1
        if c.i - start > 24:
            raise _Invalid()
    frag = c.s[start : c.i]
    if c.eof():
        if not frag or not any(
            k.startswith(frag) and k not in used and (not last_key or k > last_key) for k in allowed
        ):
            if not frag:
                raise _NeedMore()
            raise _Invalid()
        raise _NeedMore()
    c.take('"')
    # Keys are emitted in sorted order (matching training targets), which
    # keeps search on the learned manifold.
    if frag not in allowed or frag in used or (last_key and frag <= last_key):
        raise _Invalid()
    return frag


def _parse_number(c: _Cursor) -> None:
    start = c.i
    while not c.eof() and c.peek() is not None and c.peek().isdigit():
        c.i += 1
        if c.i - start > 3:
            raise _Invalid()
    if c.i == start:
        if c.eof():
            raise _NeedMore()
        raise _Invalid()


def _parse_str_array(
    c: _Cursor,
    allowed: Optional[frozenset],
    wordlist: Optional[frozenset] = None,
) -> None:
    c.take("[")
    if c.eof():
        raise _NeedMore()
    if c.peek() == "]":
        c.i += 1
        return
    count = 0
    while True:
        if count >= _MAX_GRAMMAR_ITEMS:
            raise _Invalid()
        _parse_string(c, allowed=allowed, free=allowed is None, wordlist=wordlist)
        count += 1
        if c.eof():
            raise _NeedMore()
        ch = c.peek()
        if ch == ",":
            c.i += 1
            continue
        if ch == "]":
            c.i += 1
            return
        raise _Invalid()


def _parse_typed_value(
    c: _Cursor,
    spec: tuple,
    key: str,
    food_words: Optional[frozenset] = None,
    craving_words: Optional[frozenset] = None,
    ingredient_words: Optional[frozenset] = None,
) -> None:
    kind, vals = spec
    if kind == "enum":
        assert vals is not None
        _parse_string(c, allowed=vals)
    elif kind == "enumarr":
        assert vals is not None
        _parse_str_array(c, allowed=vals)
    elif kind == "str":
        _parse_string(c, free=True, wordlist=craving_words)
    elif kind == "strarr":
        # Ingredients exclude negated words (a rejected food must surface
        # in allergies/avoidFoods, never as a wanted ingredient).
        wl = ingredient_words if key == "ingredients" else food_words
        _parse_str_array(c, allowed=None, wordlist=wl)
    elif kind == "num":
        _parse_number(c)
    elif kind == "signals":
        _parse_object(c, _GRAMMAR_SIGNALS, top=False, ordered=False)
    else:  # pragma: no cover - unknown spec
        raise _Invalid()


def _parse_object(
    c: _Cursor,
    allowed: Dict[str, tuple],
    top: bool,
    food_words: Optional[frozenset] = None,
    craving_words: Optional[frozenset] = None,
    ingredient_words: Optional[frozenset] = None,
    ordered: bool = True,
) -> None:
    c.take("{")
    used: set = set()
    last_key = ""
    if c.eof():
        raise _NeedMore()
    if c.peek() == "}":
        c.i += 1
        if top and not c.eof():
            raise _Invalid()
        return
    while True:
        if len(used) >= _MAX_GRAMMAR_KEYS:
            raise _Invalid()
        key = _parse_key(c, allowed, used, last_key if ordered else "")
        used.add(key)
        last_key = key
        c.take(":")
        _parse_typed_value(c, allowed[key], key, food_words, craving_words, ingredient_words)
        if c.eof():
            raise _NeedMore()
        ch = c.peek()
        if ch == ",":
            c.i += 1
            continue
        if ch == "}":
            c.i += 1
            if top and not c.eof():
                raise _Invalid()
            return
        raise _Invalid()


def valid_prefix(
    s: str,
    vocab: Optional[frozenset] = None,
    craving_vocab: Optional[frozenset] = None,
    ingredient_vocab: Optional[frozenset] = None,
) -> bool:
    """True if `s` could still become a valid Flavora intent JSON document.

    `vocab` bounds allergy/avoid-food strings, `ingredient_vocab` bounds
    ingredients (excludes negated words), `craving_vocab` bounds cravings.
    Omitted sets → syntax-only checks for that slot.
    """
    if len(s) > _MAX_GRAMMAR_DOC:
        return False
    try:
        c = _Cursor(s)
        _parse_object(
            c, _GRAMMAR_KEYS, top=True,
            food_words=vocab, craving_words=craving_vocab,
            ingredient_words=ingredient_vocab if ingredient_vocab is not None else vocab,
        )
        return c.eof()
    except _Invalid:
        return False
    except _NeedMore:
        return True


def _negated_words(text: str) -> set:
    """Words under negation scope ("dont want X", "allergic to Y", "no Z").

    These may only fill allergy/avoid-food slots — never ingredients — so a
    rejected food cannot resurface as a wanted one. Scope runs from the cue
    to clause end, skipping filler verbs/prepositions, capped at 3 words.
    """
    cues = {
        "dont", "not", "no", "without", "avoid", "allergic", "never",
        "cant", "cannot", "hate", "dislike", "except",
    }
    filler = {
        "to", "for", "me", "want", "eat", "eating", "have", "the", "a",
        "any", "my", "of", "too", "so", "really", "just", "please",
    }
    clauses = re.split(r"[.?!;]|\bbut\b", text.lower())
    out: set = set()
    for clause in clauses:
        words = re.findall(r"[a-z0-9]+", clause)
        i = 0
        while i < len(words):
            if words[i] in cues:
                taken = 0
                j = i + 1
                while j < len(words) and taken < 3:
                    w = words[j]
                    if w in filler:
                        j += 1
                        continue
                    if len(w) >= 3:
                        out.add(w)
                        taken += 1
                    j += 1
                i = j
            else:
                i += 1
    return out


def _content_words(text: str) -> set:
    """Request words usable as values (lenient length, stopwords excluded)."""
    stopwords = frozenset(
        "i me my we you he she it they them us our your his her its their "
        "a an the and or but of in on at to for from with without by as "
        "is are was were be been have has had do does did "
        "want wants like likes give gives get gets make makes can could will "
        "would should just only also very too so than then that this these "
        "those what which who whom how when where why something anything "
        "everything nothing whatever please tonight today now here there "
        "dont cant cannot im ive".split()
    )
    return {
        w
        for w in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)?", text.lower())
        if len(w) >= 3 and w not in stopwords
    }


def _open_key(gen_text: str) -> str:
    """Innermost object key whose value is currently being filled ('' if
    between keys/values). Drives field-aware bonus routing during search."""
    m = re.search(r'"([a-z]+)"\s*:\s*[^}{]*$', gen_text)
    if m:
        return m.group(1)
    m2 = re.search(r'\[\s*"([a-z0-9 \-.]*)?$', gen_text)
    if m2:
        outer = re.search(r'"([a-z]+)"\s*:\s*\[[^]]*$', gen_text)
        if outer:
            return outer.group(1)
    return ""


_ALLERGEN_WORDS = frozenset(
    "peanut peanuts groundnut dairy milk cheese butter cream yogurt egg eggs "
    "gluten wheat flour bread shellfish shrimp crab soy tofu sesame almond "
    "walnut cashew fish mustard celery nut nuts".split()
)


def _copy_bonus_set(text: str) -> tuple:
    """Words/numbers worth copying from the request (whole-word matches)."""
    words = {w for w in _content_words(text) if len(w) >= 4}
    numbers = set(re.findall(r"\d+", text))
    return words, numbers


_COPY_BONUS = 3.0


def _piece_base(piece: str) -> str:
    if piece == "</w>":
        return ""
    if piece.endswith("</w>"):
        return piece[: -len("</w>")]
    return piece
