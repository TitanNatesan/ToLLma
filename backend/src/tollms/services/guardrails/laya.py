"""Laya evaluator: POST {LAYA_URL}/evaluate over httpx (async)."""

import asyncio
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_SEMAPHORE = asyncio.Semaphore(20)

_health_cache: dict[str, Any] = {"at": 0.0, "payload": None}
HEALTH_TTL_S = 30.0

MAX_TEXT_CHARS = 64 * 1024


def laya_url() -> str:
    from tollms.core.config import get_settings

    return (get_settings().laya_url or "http://laya:8001").rstrip("/")


def laya_timeout_ms(explicit: int | None = None) -> int:
    from tollms.core.config import get_settings

    if explicit:
        return max(100, min(explicit, 30000))
    return max(100, min(get_settings().laya_timeout_ms, 30000))


async def health(force: bool = False) -> dict[str, Any]:
    """Laya /health, cached 30s. Never raises — unreachable is a payload."""
    now = time.monotonic()
    if not force and now - _health_cache["at"] < HEALTH_TTL_S and _health_cache["payload"]:
        return dict(_health_cache["payload"])
    payload: dict[str, Any] = {"reachable": False}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{laya_url()}/health")
            if response.status_code == 200:
                body = response.json() if response.content else {}
                payload = {"reachable": True, **(body if isinstance(body, dict) else {})}
            else:
                payload = {"reachable": False, "status": response.status_code}
    except Exception as exc:
        logger.warning("laya health check failed", exc_info=True)
        payload = {"reachable": False, "error": type(exc).__name__}
    _health_cache.update(at=now, payload=payload)
    return dict(payload)


async def evaluate(text: str, categories: list[str] | None = None,
                   timeout_ms: int | None = None) -> dict[str, Any]:
    """Normalize Laya's verdict to {verdict, confidence, categories, reason}.

    Raises on transport/validation failure — the caller applies failure_action.
    """
    body = (text or "")[:MAX_TEXT_CHARS]
    started = time.monotonic()
    try:
        async with _SEMAPHORE:
            async with httpx.AsyncClient(timeout=laya_timeout_ms(timeout_ms) / 1000) as client:
                response = await client.post(
                    f"{laya_url()}/evaluate",
                    json={"text": body, "categories": categories or []},
                )
        latency_ms = (time.monotonic() - started) * 1000
        if response.status_code == 413:
            raise ValueError("laya rejected oversize payload")
        response.raise_for_status()
        data = response.json()
        verdict = str(data.get("verdict", "allow")).lower()
        if verdict not in ("allow", "warn", "block"):
            verdict = "allow"
        return {
            "verdict": verdict,
            "confidence": float(data.get("confidence", 0.5)),
            "matched_categories": list(data.get("matched_categories", []) or []),
            "reason": str(data.get("reason", "") or "")[:500],
            "latency_ms": latency_ms,
            "model_version": data.get("model_version"),
        }
    except Exception:
        logger.warning("laya evaluate failed", exc_info=True)
        raise
