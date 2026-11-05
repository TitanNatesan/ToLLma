"""Jev evaluator: configurable base_url + key, POST {base}/evaluate.

Never fabricate model access: validation probes /health (else /models) per
the deployment's own config, and reports what the server says.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".internal")


def _looks_like_blocked_literal(host: str) -> bool:
    """Hostname-spelled private ranges (no DNS is ever consulted)."""
    if host in ("::1",):
        return True
    if host.startswith(("127.", "10.", "169.254.", "192.168.")):
        return True
    if host.startswith("172."):
        try:
            second = int(host.split(".")[1])
        except (IndexError, ValueError):
            return False
        if 16 <= second <= 31:
            return True
    return False


def base_url_error(raw: object) -> str | None:
    """Allowlist for user-supplied evaluator hosts. Returns None when the
    URL is safe to contact, otherwise a short denial reason.

    Only http(s) URLs pass. Literal IPs must be globally routable
    (ipaddress rejects loopback/link-local/private/multicast/reserved);
    hostnames reject localhost, .local, .internal and private-range spellings.
    Callers must check this BEFORE attaching the user's api_key to any
    outbound Authorization header — no request leaves for denied hosts.
    """
    from urllib.parse import urlsplit

    if not raw or not str(raw).strip():
        return "base_url is required"
    try:
        parts = urlsplit(str(raw).strip())
    except Exception:
        return "base_url is not a valid URL"
    if parts.scheme not in ("http", "https"):
        return "base_url must be http(s)"
    host = (parts.hostname or "").strip().lower().rstrip(".")
    if not host:
        return "base_url must include a host"
    if host == "localhost" or host.endswith(_BLOCKED_HOST_SUFFIXES):
        return "base_url host is not allowed"
    import ipaddress

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if _looks_like_blocked_literal(host):
            return "base_url host is not allowed"
        return None
    if not ip.is_global:
        return "base_url host is not allowed"
    return None


def field_errors(config: dict[str, Any] | None) -> list[str]:
    errors: list[str] = []
    if not isinstance(config, dict):
        return ["configuration object required"]
    if not (config.get("base_url") or "").strip():
        errors.append("base_url is required")
    if not (config.get("api_key") or "").strip():
        errors.append("api_key is required")
    return errors


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


async def validate(config: dict[str, Any] | None,
                   timeout_s: float = 10.0) -> tuple[bool, str, float]:
    """Live check: {base}/health, falling back to {base}/models. Never logs keys."""
    errors = field_errors(config)
    if errors:
        return False, "; ".join(errors), 0.0
    denied = base_url_error(config.get("base_url"))
    if denied:
        return False, denied, 0.0
    base = str(config["base_url"]).rstrip("/")
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(f"{base}/health", headers=_headers(config["api_key"]))
            if response.status_code == 404:
                response = await client.get(f"{base}/models", headers=_headers(config["api_key"]))
        latency_ms = (time.monotonic() - started) * 1000
        if response.status_code == 200:
            return True, "jev endpoint reachable", latency_ms
        if response.status_code in (401, 403):
            return False, "jev rejected the api key", latency_ms
        return False, f"jev health check returned {response.status_code}", latency_ms
    except Exception as exc:
        logger.warning("jev validate failed", exc_info=True)
        return False, f"{type(exc).__name__}: request failed", (time.monotonic() - started) * 1000


async def evaluate(text: str, config: dict[str, Any],
                   categories: list[str] | None = None,
                   timeout_ms: int | None = None) -> dict[str, Any]:
    """POST {base}/evaluate. Raises on failure (caller applies failure_action)."""
    errors = field_errors(config)
    if errors:
        raise ValueError("; ".join(errors))
    denied = base_url_error(config.get("base_url"))
    if denied:
        raise ValueError(denied)
    base = str(config["base_url"]).rstrip("/")
    timeout_s = max(1.0, min((timeout_ms or 10000) / 1000, 30.0))
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                f"{base}/evaluate",
                headers=_headers(config["api_key"]),
                json={"text": (text or "")[:32768], "categories": categories or []},
            )
        latency_ms = (time.monotonic() - started) * 1000
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
        logger.warning("jev evaluate failed", exc_info=True)
        raise
