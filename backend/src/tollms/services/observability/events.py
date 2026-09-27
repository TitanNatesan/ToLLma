"""Structured observability events: security audit + gateway telemetry.

``emit`` writes one JSON line per event on the dedicated ``tollms.events``
logger (event name + ids/codes/reasons only — never passwords, tokens,
credentials, keys, or content). ``incr_counter`` bumps a Valkey counter for
metrics dashboards. Both never raise: metrics are fail-open, enforcement
stays fail-closed where it already is.
"""

import json
import logging
from typing import Any

from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import call_sync, get_manager

logger = logging.getLogger("tollms.events")

_METRICS_TTL = 90 * 86400  # counters age out; dashboards read recent windows

# Field names that must never reach the log (substring match, case-insensitive).
# Call sites pass ids/codes/reasons only; this is the backstop.
_SECRET_MARKERS = (
    "password",
    "passwd",
    "token",
    "secret",
    "credential",
    "api_key",
    "apikey",
    "key_hash",
    "private_key",
    "access_key",
    "refresh",
    "auth",
    "cookie",
    "session_id",
    "prompt",
    "content",
    "payload",
    "message",
    "text",
    "body",
    "email",
    "ip",
    "user_agent",
    "avatar",
    "name",
)

_MAX_FIELD_LEN = 256


def _safe_value(value: Any) -> str | int | float | bool | None:
    """Coerce to a log-safe scalar; complex values become short strings."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    text = value if isinstance(value, str) else repr(value)
    return text[:_MAX_FIELD_LEN]


def _is_secret_field(field: str) -> bool:
    lowered = field.lower()
    return any(marker in lowered for marker in _SECRET_MARKERS)


def emit(event: str, **fields: Any) -> None:
    """Log one structured event. Never raises; falls back to a plain warning."""
    try:
        safe = {
            key: _safe_value(value)
            for key, value in fields.items()
            if not _is_secret_field(key)
        }
        logger.info(json.dumps({"event": event, **safe}, default=str))
    except Exception:
        logger.warning("observability emit failed: event=%s", event, exc_info=True)


def _sanitize_label_part(value: str) -> str:
    return "".join(c if c.isalnum() or c in ("-", "_", ".") else "_" for c in value.lower())[:64]


def incr_counter(name: str, labels: dict[str, str] | None = None, amount: int = 1) -> None:
    """Best-effort Valkey counter bump (metrics only, fail-open). Never raises."""
    try:
        clean_labels = {
            _sanitize_label_part(str(key)): _sanitize_label_part(str(value))
            for key, value in (labels or {}).items()
        }
        key = cache_keys.metrics_counter(_sanitize_label_part(name), clean_labels)

        async def _incr() -> int | None:
            client = await get_manager().resolved_client()
            if client is None:
                return None
            value = await client.incrby(key, amount)
            try:
                await client.expire(key, _METRICS_TTL, nx=True)
            except TypeError:
                await client.expire(key, _METRICS_TTL)
            return int(value)

        call_sync(_incr(), default=None)
    except Exception:
        logger.warning("observability counter failed: name=%s", name, exc_info=True)
