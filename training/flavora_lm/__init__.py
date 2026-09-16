"""FlavoraLM — Flavora's own small language model.

Everything in this package is built from scratch for Flavora:
the tokenizer (trained on the Flavora corpus), the decoder-only
Transformer architecture, the training pipeline, and the inference
helpers. No pretrained weights, no pretrained tokenizer, no external
inference service.
"""

from .tokenizer import BPETokenizer, SPECIAL_TOKENS, train_tokenizer
from .model import FlavoraLMConfig, FlavoraLM

__all__ = [
    "BPETokenizer",
    "SPECIAL_TOKENS",
    "train_tokenizer",
    "FlavoraLMConfig",
    "FlavoraLM",
]
