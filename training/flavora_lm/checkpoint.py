"""Checkpoint utilities: full reproducible training state, not just weights.

A checkpoint contains model weights, optimizer state, scheduler state,
step counters, config, tokenizer version, metrics, and the seed.
"""

from __future__ import annotations

import json
import platform
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

import torch

from .model import FlavoraLM, FlavoraLMConfig

METRICS_FILE = "metrics.json"


@dataclass
class TrainingMeta:
    model: str
    version: str
    seed: int
    dataset_version: str
    tokenizer_version: str
    epochs: int
    steps: int
    learning_rate: float
    batch_size: int
    optimizer: str
    hardware: str
    python_version: str
    pytorch_version: str
    platform: str
    final_train_loss: Optional[float] = None
    final_val_loss: Optional[float] = None
    final_val_perplexity: Optional[float] = None
    dataset_sha256: Optional[Dict[str, str]] = None
    created_at: Optional[str] = None
    extra: Dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "extra"} | dict(self.extra)

    def save(self, path) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")


def set_seed(seed: int) -> None:
    import os

    random.seed(seed)
    torch.manual_seed(seed)
    try:
        import numpy as np

        np.random.seed(seed % (2**32))
    except ImportError:
        pass
    os.environ["PYTHONHASHSEED"] = str(seed)
    try:
        torch.use_deterministic_algorithms(True, warn_only=True)
    except (AttributeError, RuntimeError):
        pass


def save_checkpoint(
    path,
    model: FlavoraLM,
    optimizer,
    scheduler,
    step: int,
    epoch: int,
    meta: TrainingMeta,
    val_metrics: Optional[Dict] = None,
) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "optimizer_state": optimizer.state_dict(),
            "scheduler_state": scheduler.state_dict() if scheduler else None,
            "step": step,
            "epoch": epoch,
            "seed": meta.seed,
            "config": model.cfg.to_dict(),
            "tokenizer_version": meta.tokenizer_version,
            "metrics": val_metrics or {},
        },
        path,
    )
    if val_metrics is not None:
        Path(path).with_name(METRICS_FILE).write_text(
            json.dumps({"step": step, **val_metrics}, indent=2), encoding="utf-8"
        )


def load_checkpoint(path, model: FlavoraLM, optimizer=None, scheduler=None, map_location: str = "cpu") -> Dict:
    blob = torch.load(path, map_location=map_location)
    model.load_state_dict(blob["model_state"])
    if optimizer is not None and blob.get("optimizer_state"):
        optimizer.load_state_dict(blob["optimizer_state"])
    if scheduler is not None and blob.get("scheduler_state"):
        scheduler.load_state_dict(blob["scheduler_state"])
    return blob


def hardware_description() -> str:
    if torch.cuda.is_available():
        return f"cuda:{torch.cuda.get_device_name(0)}"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return f"cpu ({platform.machine()})"
