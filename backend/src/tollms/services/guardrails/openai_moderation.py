"""OpenAI moderation evaluator: validate + evaluate. Secrets never logged."""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_API = "https://api.openai.com/v1"
_MODEL = "omni-moderation-latest"


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def field_errors(credentials: dict[str, Any] | None) -> list[str]:
    """Static field check: api_key present. Never touches the network."""
    if not isinstance(credentials, dict) or not (credentials.get("api_key") or "").strip():
        return ["api_key is required"]
    return []


async def validate(credentials: dict[str, Any] | None,
                   timeout_s: float = 10.0) -> tuple[bool, str, float]:
    """Live check: GET /v1/models with the key. Never logs the key."""
    errors = field_errors(credentials)
    if errors:
        return False, "; ".join(errors), 0.0
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(f"{_API}/models", headers=_headers(credentials["api_key"]))
        latency_ms = (time.monotonic() - started) * 1000
        if response.status_code == 200:
            return True, "openai key valid", latency_ms
        if response.status_code in (401, 403):
            return False, "openai rejected the api key", latency_ms
        return False, f"openai models check returned {response.status_code}", latency_ms
    except Exception as exc:
        logger.warning("openai moderation validate failed", exc_info=True)
        return False, f"{type(exc).__name__}: request failed", (time.monotonic() - started) * 1000


async def evaluate(text: str, credentials: dict[str, Any],
                   timeout_ms: int | None = None) -> dict[str, Any]:
    """POST /v1/moderations. Raises on failure (caller applies failure_action)."""
    errors = field_errors(credentials)
    if errors:
        raise ValueError("; ".join(errors))
    timeout_s = max(1.0, min((timeout_ms or 10000) / 1000, 30.0))
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                f"{_API}/moderations",
                headers=_headers(credentials["api_key"]),
                json={"model": _MODEL, "input": (text or "")[:32768]},
            )
        latency_ms = (time.monotonic() - started) * 1000
        response.raise_for_status()
        data = response.json()
        results = (data.get("results") or [{}])[0]
        flagged = bool(results.get("flagged"))
        cats = results.get("categories") or {}
        matched = sorted(k for k, v in cats.items() if v)
        scores = results.get("category_scores") or {}
        confidence = max([float(scores.get(k, 0.0)) for k in matched] or [0.0])
        return {
            "verdict": "block" if flagged else "allow",
            "confidence": confidence if flagged else 1.0 - confidence,
            "matched_categories": matched,
            "reason": ("openai moderation flagged: " + ", ".join(matched[:5]))[:500] if flagged else "",
            "latency_ms": latency_ms,
            "model_version": _MODEL,
        }
    except Exception:
        logger.warning("openai moderation evaluate failed", exc_info=True)
        raise
