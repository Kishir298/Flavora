"""FlavoraLM tokenizer: a deterministic byte-pair-encoding (BPE) tokenizer trained
from scratch on the Flavora corpus.

Design notes
------------
* This is *our* tokenizer. Its vocabulary and merge table are learned from the
  Flavora training corpus by this module; nothing is loaded from a pretrained
  model or tokenizer library.
* Special tokens are fixed and always occupy the first ids, so ids are stable
  across retrains as long as the special-token list does not change.
* Training is deterministic for a given corpus and vocab size: pair counting
  order is broken by token id, never by hash order.
* Serialization is a single JSON file (vocab + merges + metadata), which is
  the artifact the inference service loads.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

# Special tokens always occupy ids 0..len(SPECIAL_TOKENS)-1.
SPECIAL_TOKENS: Tuple[str, ...] = ("<PAD>", "<UNK>", "<BOS>", "<EOS>", "<USER>", "<ASSISTANT>")

PAD, UNK, BOS, EOS, USER, ASSISTANT = SPECIAL_TOKENS

TOKENIZER_VERSION = "0.2"

# Single-character structural tokens. These are NEVER stripped or merged:
# the model must reproduce JSON syntax exactly ({"intent":...}) for
# structured intent generation, so braces/quotes/colons survive
# tokenization round-trips. Each occupies one vocab id and encodes to itself.
STRUCTURAL_SINGLETONS: Tuple[str, ...] = ("{", "}", "[", "]", '"', ":", ",")

# Punctuation stripped from the edges of natural-language words.
# NOTE: JSON structural chars are NOT in this set — they are split out
# as singleton tokens by _split_pieces() instead of being stripped.
STRIP_CHARS = ".,!?;()'"


@dataclass
class TrainedTokenizer:
    """Result of tokenizer training: vocab + ordered merge list."""

    vocab: Dict[str, int]
    merges: List[Tuple[str, str]]


def _split_pieces(text: str, lowercase: bool = True) -> List[str]:
    """Split text into tokenizable pieces.

    Whitespace-separated tokens are further split so every JSON structural
    character ({ } [ ] " : ,) becomes its own piece; remaining word parts
    are edge-stripped of sentence punctuation and lowercased. Deterministic.
    """
    singletons = set(STRUCTURAL_SINGLETONS)
    pieces: List[str] = []
    for raw in text.split():
        buf: List[str] = []

        def flush() -> None:
            word = "".join(buf).strip(STRIP_CHARS)
            if lowercase:
                word = word.lower()
            if word:
                pieces.append(word)
            buf.clear()

        for ch in raw:
            if ch in singletons:
                flush()
                pieces.append(ch)
            else:
                buf.append(ch)
        flush()
    return pieces


def _word_to_symbols(word: str) -> List[str]:
    """Split a word into characters, marking the end-of-word with a sentinel."""
    chars = list(word)
    if not chars:
        return chars
    chars[-1] = chars[-1] + "</w>"
    return chars


def _count_pairs(words: Sequence[List[str]]) -> Dict[Tuple[str, str], int]:
    counts: Dict[Tuple[str, str], int] = {}
    for symbols in words:
        for a, b in zip(symbols, symbols[1:]):
            counts[(a, b)] = counts.get((a, b), 0) + 1
    return counts


def _merge_word(symbols: List[str], pair: Tuple[str, str], merged: str) -> List[str]:
    out: List[str] = []
    i = 0
    n = len(symbols)
    while i < n:
        if i < n - 1 and symbols[i] == pair[0] and symbols[i + 1] == pair[1]:
            out.append(merged)
            i += 2
        else:
            out.append(symbols[i])
            i += 1
    return out


def train_tokenizer(
    corpus: Iterable[str],
    vocab_size: int,
    lowercase: bool = True,
    max_word_length: int = 32,
) -> TrainedTokenizer:
    """Train a BPE tokenizer on the given corpus.

    Deterministic: pair ties are broken by (count desc, symbol pair asc),
    so the same corpus always produces the same tokenizer.
    """
    if vocab_size <= len(SPECIAL_TOKENS) + 10:
        raise ValueError("vocab_size too small for a useful tokenizer")

    # 1. Piece frequency table (structural singletons kept, words stripped).
    word_freq: Dict[str, int] = {}
    for line in corpus:
        for piece in _split_pieces(line, lowercase=lowercase):
            word = piece if piece in STRUCTURAL_SINGLETONS else piece.strip(STRIP_CHARS)
            if not word or (word not in STRUCTURAL_SINGLETONS and len(word) > max_word_length):
                continue
            word_freq[word] = word_freq.get(word, 0) + 1

    if not word_freq:
        raise ValueError("empty corpus: cannot train tokenizer")

    # 2. Initialize symbol sequences (one symbol per char, last carries </w>).
    words = [[w, f] for w, f in word_freq.items()]
    symbol_words: List[List[str]] = []
    for word, _freq in words:
        symbol_words.append(_word_to_symbols(word))

    # 3. Seed vocab: special tokens, structural singletons (never merged),
    # then all characters seen + the </w> end-of-word marker.
    vocab: Dict[str, int] = {}
    for tok in SPECIAL_TOKENS:
        vocab[tok] = len(vocab)
    for singleton in STRUCTURAL_SINGLETONS:
        if singleton not in vocab:
            vocab[singleton] = len(vocab)
    # Digits and numeric punctuation always get ids: time limits, servings
    # and quantities must survive tokenization even when a particular digit
    # never appeared in the training corpus.
    for ch in "0123456789-.":
        if ch not in vocab:
            vocab[ch] = len(vocab)
    for word, _freq in words:
        for sym in _word_to_symbols(word):
            base = sym[:-4] if sym.endswith("</w>") else sym
            for piece in (base, "</w>"):
                if piece and piece not in vocab:
                    vocab[piece] = len(vocab)
    vocab["</w>"] = vocab.get("</w>", len(vocab))

    merges: List[Tuple[str, str]] = []

    # 4. Merge loop until vocab_size reached or no pairs left.
    num_base = len(vocab)
    while len(vocab) < vocab_size:
        counts = _count_pairs(symbol_words)
        if not counts:
            break
        # Deterministic tie-break: highest count, then lexicographically smallest pair.
        best = min(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        merged = best[0] + best[1]
        if merged in vocab:
            # Already merged (can happen via </w> bookkeeping); drop the pair.
            symbol_words = [_merge_word(w, best, merged) for w in symbol_words]
            continue
        merges.append(best)
        vocab[merged] = len(vocab)
        symbol_words = [_merge_word(w, best, merged) for w in symbol_words]
        if len(vocab) == num_base:  # safety: no growth possible
            break

    return TrainedTokenizer(vocab=vocab, merges=merges)


class BPETokenizer:
    """Encode/decode with a trained FlavoraLM BPE vocabulary."""

    def __init__(self, vocab: Dict[str, int], merges: Sequence[Tuple[str, str]], version: str = TOKENIZER_VERSION):
        self.vocab = dict(vocab)
        self.id_to_token: Dict[int, str] = {i: t for t, i in self.vocab.items()}
        self.merges = [(a, b) for a, b in merges]
        # Rank lookup for encode: merge order = priority.
        self.merge_ranks: Dict[Tuple[str, str], int] = {pair: i for i, pair in enumerate(self.merges)}
        self.version = version
        self.pad_id = self.vocab[PAD]
        self.unk_id = self.vocab[UNK]
        self.bos_id = self.vocab[BOS]
        self.eos_id = self.vocab[EOS]
        self.user_id = self.vocab[USER]
        self.assistant_id = self.vocab[ASSISTANT]

    # ---------------- serialization ----------------

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "type": "flavora-bpe",
            "version": self.version,
            "special_tokens": list(SPECIAL_TOKENS),
            "vocab": self.vocab,
            "merges": [[a, b] for a, b in self.merges],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "BPETokenizer":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("type") != "flavora-bpe":
            raise ValueError(f"not a FlavoraLM tokenizer artifact: {path}")
        return cls(vocab=payload["vocab"], merges=[tuple(m) for m in payload["merges"]], version=payload.get("version", "0"))

    # ---------------- encoding ----------------

    def _encode_word(self, word: str) -> List[str]:
        """Apply learned merges to one word (BPE rank algorithm).

        Structural singletons ({, }, [, ], ", :, ,) bypass BPE entirely —
        they always encode to themselves.
        """
        if word in STRUCTURAL_SINGLETONS:
            return [word]
        symbols = _word_to_symbols(word)
        if len(symbols) <= 1:
            return symbols
        while True:
            best_rank = None
            best_idx = None
            for i, (a, b) in enumerate(zip(symbols, symbols[1:])):
                rank = self.merge_ranks.get((a, b))
                if rank is not None and (best_rank is None or rank < best_rank):
                    best_rank = rank
                    best_idx = i
            if best_rank is None:
                break
            a, b = symbols[best_idx], symbols[best_idx + 1]
            symbols = symbols[:best_idx] + [a + b] + symbols[best_idx + 2 :]
        return symbols

    def _piece_ids(self, piece: str) -> List[int]:
        """Map one BPE piece to ids: exact vocab hit, else base + </w>, else char fallback."""
        if piece in self.vocab:
            return [self.vocab[piece]]
        if piece.endswith("</w>"):
            base = piece[: -len("</w>")]
            ids: List[int] = []
            # Prefer the merged base token when it exists on its own.
            if base and base in self.vocab:
                ids.append(self.vocab[base])
            else:
                for ch in base:
                    ids.append(self.vocab[ch] if ch in self.vocab else self.unk_id)
            ids.append(self.vocab["</w>"] if "</w>" in self.vocab else self.unk_id)
            return ids
        # Unknown middle-of-word piece: character fallback, then <UNK> if nothing matched.
        ids = [self.vocab[ch] if ch in self.vocab else self.unk_id for ch in piece]
        return ids if ids else [self.unk_id]

    def encode(self, text: str, add_special: bool = False) -> List[int]:
        """Encode text deterministically. Unknown pieces fall back to chars/`<UNK>`."""
        ids: List[int] = []
        if add_special:
            ids.append(self.bos_id)
            ids.append(self.user_id)
        singletons = set(STRUCTURAL_SINGLETONS)
        for raw in text.lower().split():
            # Split off JSON structural chars so {"a":1} keeps its syntax.
            buf: List[str] = []

            def flush() -> None:
                word = "".join(buf).strip(STRIP_CHARS)
                if word:
                    for piece in self._encode_word(word):
                        ids.extend(self._piece_ids(piece))
                buf.clear()

            for ch in raw:
                if ch in singletons:
                    flush()
                    ids.extend(self._piece_ids(ch))
                else:
                    buf.append(ch)
            flush()
        if add_special:
            ids.append(self.eos_id)
        return ids

    def decode(self, ids: Sequence[int], skip_special: bool = True) -> str:
        """Decode ids back to text; `</w>` markers become spaces.

        Spaces adjacent to JSON structural characters ({ } [ ] " : ,) are
        removed so decoded JSON parses with exact keys/values
        (``{"intent":"recommend"}``, not ``{ "intent " : ... }``).
        """
        import re

        specials = set(SPECIAL_TOKENS)
        out: List[str] = []
        for i in ids:
            tok = self.id_to_token.get(int(i))
            if tok is None:
                continue
            if skip_special and tok in specials:
                continue
            if tok == "</w>":
                out.append(" ")
            elif tok.endswith("</w>"):
                out.append(tok[: -len("</w>")] + " ")
            else:
                out.append(tok)
        text = " ".join("".join(out).split())
        return re.sub(r"\s*([{}\[\]\",:])\s*", r"\1", text)

    # ---------------- metadata ----------------

    @property
    def vocab_size(self) -> int:
        return len(self.vocab)
