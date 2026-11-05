"""Environment-driven configuration for the Laya guardrail service.

Every knob is an operational setting (model selection, device, concurrency,
timeouts, decision thresholds) — never a content-classification rule.
Content judgments come only from the loaded Laya checkpoint.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _str(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def service_version() -> str:
    return (Path(__file__).parent / "MODEL_VERSION").read_text().strip()


@dataclass(frozen=True)
class Settings:
    """Resolved once at startup; immutable afterwards."""

    # Checkpoint pinned for every predict call (resolved by laya Router:
    # "english" | "multilingual" | "typed-decisions", aliases accepted).
    model: str = field(default_factory=lambda: _str("LAYA_MODEL", "typed-decisions"))
    device: str = field(default_factory=lambda: _str("LAYA_DEVICE", "cpu"))
    max_concurrent: int = field(default_factory=lambda: _int("LAYA_MAX_CONCURRENT", 4))
    inference_timeout_s: float = field(
        default_factory=lambda: _float("LAYA_INFERENCE_TIMEOUT", 25.0))
    max_text_chars: int = field(
        default_factory=lambda: _int("LAYA_MAX_TEXT_CHARS", 64 * 1024))
    # Decision-mapping thresholds (calibration config, tuned on the eval set —
    # they gate model probabilities, they never classify content themselves).
    # Calibrated on eval/raw_td.json sweep (49 cases): 0.4 gives F1 0.809
    # with 2 silent-pass misses; 0.5 gives F1 0.800 with 3 (incl. a
    # credential-exfiltration pass). They gate probabilities, never classify.
    match_threshold: float = field(
        default_factory=lambda: _float("LAYA_MATCH_THRESHOLD", 0.4))
    block_threshold: float = field(
        default_factory=lambda: _float("LAYA_BLOCK_THRESHOLD", 0.7))
    # A `block` action below this confidence is a plurality without majority —
    # treated as review, not a block. Same class of knob as the thresholds.
    action_block_min_conf: float = field(
        default_factory=lambda: _float("LAYA_ACTION_BLOCK_MIN_CONF", 0.5))
    torch_threads: int = field(default_factory=lambda: (
        int(os.environ["LAYA_THREADS"])
        if os.environ.get("LAYA_THREADS", "").strip().isdigit()
        # Measured: 4 threads beats 16 on a 16-vCPU box (7.6s -> 2.0s per
        # 3-question call); oversubscription hurts encoder inference.
        else min(4, os.cpu_count() or 4)
    ))
    model_version: str = field(default_factory=service_version)


def get_settings() -> Settings:
    return Settings()
