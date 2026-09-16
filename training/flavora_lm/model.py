"""FlavoraLM — a decoder-only Transformer language model built for Flavora.

The architecture is defined entirely in this repository and initialized
from scratch with random weights. Training uses causal next-token
prediction; inference is autoregressive sampling with temperature,
top-k and top-p controls.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict, field
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

MODEL_NAME = "FlavoraLM"
ARCHITECTURE = "decoder_transformer"


@dataclass
class FlavoraLMConfig:
    """Architecture hyperparameters — stored explicitly in config.json artifacts."""

    model_name: str = MODEL_NAME
    version: str = "0.1"
    architecture: str = ARCHITECTURE
    vocab_size: int = 4096
    context_length: int = 256
    embedding_dim: int = 256
    layers: int = 6
    attention_heads: int = 8
    feed_forward_dim: int = 1024
    dropout: float = 0.1

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "FlavoraLMConfig":
        known = {f for f in cls.__dataclass_fields__}  # ignore unknown fields
        return cls(**{k: v for k, v in d.items() if k in known})

    def save(self, path) -> None:
        import json
        from pathlib import Path

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path) -> "FlavoraLMConfig":
        import json
        from pathlib import Path

        d = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(d)


class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: FlavoraLMConfig):
        super().__init__()
        assert cfg.embedding_dim % cfg.attention_heads == 0
        self.heads = cfg.attention_heads
        self.dim = cfg.embedding_dim
        self.qkv = nn.Linear(cfg.embedding_dim, 3 * cfg.embedding_dim)
        self.proj = nn.Linear(cfg.embedding_dim, cfg.embedding_dim)
        self.attn_dropout = nn.Dropout(cfg.dropout)
        self.resid_dropout = nn.Dropout(cfg.dropout)

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        # (B, heads, T, head_dim)
        q = q.view(B, T, self.heads, C // self.heads).transpose(1, 2)
        k = k.view(B, T, self.heads, C // self.heads).transpose(1, 2)
        v = v.view(B, T, self.heads, C // self.heads).transpose(1, 2)
        # Causal scaled dot-product attention.
        att = (q @ k.transpose(-2, -1)) / math.sqrt(k.size(-1))
        mask = torch.triu(torch.ones(T, T, dtype=torch.bool, device=x.device), diagonal=1)
        att = att.masked_fill(mask, float("-inf"))
        att = F.softmax(att, dim=-1)
        att = self.attn_dropout(att)
        y = att @ v
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.resid_dropout(self.proj(y))


class TransformerBlock(nn.Module):
    def __init__(self, cfg: FlavoraLMConfig):
        super().__init__()
        self.ln1 = nn.LayerNorm(cfg.embedding_dim)
        self.attn = CausalSelfAttention(cfg)
        self.ln2 = nn.LayerNorm(cfg.embedding_dim)
        self.ff = nn.Sequential(
            nn.Linear(cfg.embedding_dim, cfg.feed_forward_dim),
            nn.GELU(),
            nn.Linear(cfg.feed_forward_dim, cfg.embedding_dim),
            nn.Dropout(cfg.dropout),
        )

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        x = x + self.ff(self.ln2(x))
        return x


class FlavoraLM(nn.Module):
    """Decoder-only Transformer: embeddings → blocks → layernorm → LM head."""

    def __init__(self, cfg: FlavoraLMConfig):
        super().__init__()
        self.cfg = cfg
        self.tok_emb = nn.Embedding(cfg.vocab_size, cfg.embedding_dim)
        self.pos_emb = nn.Embedding(cfg.context_length, cfg.embedding_dim)
        self.drop = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList([TransformerBlock(cfg) for _ in range(cfg.layers)])
        self.ln_f = nn.LayerNorm(cfg.embedding_dim)
        self.head = nn.Linear(cfg.embedding_dim, cfg.vocab_size, bias=False)
        # Weight tying — standard for small LMs.
        self.head.weight = self.tok_emb.weight
        self.apply(self._init_weights)

    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def forward(self, idx, targets: Optional[torch.Tensor] = None):
        B, T = idx.shape
        if T > self.cfg.context_length:
            raise ValueError(f"sequence length {T} exceeds context_length {self.cfg.context_length}")
        pos = torch.arange(T, device=idx.device)
        x = self.tok_emb(idx) + self.pos_emb(pos)
        x = self.drop(x)
        for block in self.blocks:
            x = block(x)
        x = self.ln_f(x)
        if targets is None:
            logits = self.head(x)
            return logits, None
        # Next-token prediction: predict targets shifted by one position.
        logits = self.head(x)
        loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.reshape(-1), ignore_index=-100)
        return logits, loss

    @torch.no_grad()
    def generate(
        self,
        idx: torch.Tensor,
        max_new_tokens: int = 64,
        temperature: float = 0.7,
        top_k: Optional[int] = 40,
        top_p: Optional[float] = 0.9,
        repetition_penalty: float = 1.15,
        eos_id: Optional[int] = None,
    ) -> torch.Tensor:
        """Autoregressive sampling with generation controls (temperature, top-k, top-p, repetition penalty)."""
        self.eval()
        was_training = False
        for _ in range(max_new_tokens):
            idx_cond = idx if idx.size(1) <= self.cfg.context_length else idx[:, -self.cfg.context_length :]
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :] / max(temperature, 1e-5)

            # Repetition penalty: discourage tokens already present in the output.
            if repetition_penalty and repetition_penalty != 1.0:
                for b in range(idx.size(0)):
                    seen = set(idx[b].tolist())
                    for tok in seen:
                        if logits[b, tok] > 0:
                            logits[b, tok] /= repetition_penalty
                        else:
                            logits[b, tok] *= repetition_penalty

            if top_k is not None and top_k > 0:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = float("-inf")

            if top_p is not None and 0.0 < top_p < 1.0:
                sorted_logits, sorted_idx = torch.sort(logits, descending=True)
                probs = F.softmax(sorted_logits, dim=-1)
                cum = torch.cumsum(probs, dim=-1)
                remove = cum - probs > top_p  # keep tokens until cumulative prob exceeds top_p
                sorted_logits[remove] = float("-inf")
                logits = torch.full_like(logits, float("-inf")).scatter(1, sorted_idx, sorted_logits)

            probs = F.softmax(logits, dim=-1)
            next_tok = torch.multinomial(probs, num_samples=1)
            idx = torch.cat([idx, next_tok], dim=1)
            if eos_id is not None and bool((next_tok == eos_id).all()):
                break
        return idx

    # ---------------- artifact I/O ----------------

    def save_pretrained(self, dir_path, tokenizer_version: str, extra: Optional[dict] = None) -> dict:
        """Save model.pt (+ metadata) into dir_path. Returns the metadata written."""
        import json
        from pathlib import Path

        d = Path(dir_path)
        d.mkdir(parents=True, exist_ok=True)
        meta = {
            "model": self.cfg.model_name,
            "version": self.cfg.version,
            "architecture": self.cfg.architecture,
            "config": self.cfg.to_dict(),
            "parameterCount": self.num_parameters(),
            "contextLength": self.cfg.context_length,
            "tokenizerVersion": tokenizer_version,
            "trainedAt": None,
            **(extra or {}),
        }
        torch.save(
            {"config": self.cfg.to_dict(), "model_state": self.state_dict()},
            d / "model.pt",
        )
        (d / "model_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta

    @classmethod
    def load_pretrained(cls, dir_path, map_location: str = "cpu") -> "FlavoraLM":
        import json
        from pathlib import Path

        d = Path(dir_path)
        blob = torch.load(d / "model.pt", map_location=map_location)
        cfg = FlavoraLMConfig.from_dict(blob["config"])
        model = cls(cfg)  # random init first, then real weights overwrite
        model.load_state_dict(blob["model_state"])
        model.eval()
        return model
