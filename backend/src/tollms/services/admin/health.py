"""Platform health engine for the admin console.

Bounded probes only: a database ping, a cache set/get round-trip, the
in-process generation registry, and fixed-lookback aggregates (1h error rate,
24h latency from ``messages``). Every probe is defensive — a failure
downgrades that check and never raises. Privacy invariant: counts, latencies
and statuses only; no content, prompts or credentials.

Engines return plain mappings (validated by the router's ``AdminHealth``
response model); this package never imports from ``tollms.api``.
"""

import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.core.config import get_settings
from tollms.models.message import Message, Role
from tollms.models.request_log import RequestLog, RequestStatus
from tollms.services.cache.manager import cache_delete_sync, cache_get_sync, cache_set_sync
from tollms.services.generation import manager as generation_manager

logger = logging.getLogger(__name__)

_STARTED_AT = time.monotonic()
ERROR_WINDOW = timedelta(hours=1)
LATENCY_WINDOW = timedelta(hours=24)
_PROBE_TTL_SECONDS = 30
_BRIDGE_SETTLE_SECONDS = 0.1


def _ms(start: float) -> float:
    return round((time.monotonic() - start) * 1000, 2)


def _check(name: str, status: str, *, latency_ms: float | None = None, detail: str | None = None) -> dict[str, Any]:
    return {"name": name, "status": status, "latency_ms": latency_ms, "detail": detail}


def _rollback_quietly(db: Session) -> None:
    try:
        db.rollback()
    except Exception:
        logger.warning("admin health: rollback failed", exc_info=True)


def _check_database(db: Session) -> dict[str, Any]:
    start = time.monotonic()
    try:
        db.execute(select(1)).scalar_one()
    except Exception as exc:  # class name only — never the message (may hold secrets)
        logger.warning("admin health: database check failed: %s", type(exc).__name__)
        _rollback_quietly(db)
        return _check("database", "down", detail=type(exc).__name__)
    return _check("database", "ok", latency_ms=_ms(start))


def _cache_round_trip(key: str) -> tuple[bool, Any]:
    """Best-effort probe write/read/delete (all helpers swallow Valkey errors)."""
    wrote = cache_set_sync(key, {"probe": "ok"}, ttl=_PROBE_TTL_SECONDS)
    value = cache_get_sync(key) if wrote else None
    if wrote:
        cache_delete_sync(key)
    return wrote, value


def _check_cache() -> dict[str, Any]:
    """Probe key round-trip; unreachable cache is degraded, never down.

    PostgreSQL stays authoritative (matching ``/health/cache`` semantics), so
    a Valkey outage must not report the whole platform as down.
    """
    if not get_settings().cache_enabled:
        return _check("cache", "degraded", detail="cache disabled")
    key = f"tollma:admin:health:probe:{uuid.uuid4().hex[:12]}"
    start = time.monotonic()
    try:
        wrote, value = _cache_round_trip(key)
        if not wrote:
            # The sync bridge starts lazily in a daemon thread; the very first
            # call in a process can race that startup (manager._bridge holds
            # its lock while polling). Give the loop a moment, then retry once
            # so a healthy cache is not misreported as unreachable.
            time.sleep(_BRIDGE_SETTLE_SECONDS)
            wrote, value = _cache_round_trip(key)
    except Exception as exc:  # helpers never raise; keep the endpoint safe anyway
        logger.warning("admin health: cache probe failed: %s", type(exc).__name__)
        return _check("cache", "degraded", detail=type(exc).__name__)
    latency = _ms(start)
    if wrote and value == {"probe": "ok"}:
        return _check("cache", "ok", latency_ms=latency)
    if wrote:
        return _check("cache", "degraded", latency_ms=latency, detail="probe read-back mismatch")
    return _check("cache", "degraded", latency_ms=latency, detail="cache unreachable")


def _active_generations() -> int:
    """In-process driver count (single-process assumption, see generation.py)."""
    try:
        return len(generation_manager._active)
    except Exception as exc:
        logger.warning("admin health: active generation count failed: %s", type(exc).__name__)
        return 0


def _error_rate_1h(db: Session, now: datetime) -> float:
    failed = func.count().filter(RequestLog.status == RequestStatus.FAILED.value).label("failed")
    cancelled = func.count().filter(RequestLog.status == RequestStatus.CANCELLED.value).label("cancelled")
    total, failed_count, cancelled_count = db.execute(
        select(func.count(), failed, cancelled).where(
            RequestLog.request_completed_at >= now - ERROR_WINDOW,
            RequestLog.request_completed_at <= now,
        )
    ).one()
    if not total:
        return 0.0
    return round((int(failed_count) + int(cancelled_count)) / int(total) * 100, 2)


def _latency_stats(db: Session, now: datetime) -> tuple[float | None, float | None]:
    """(avg, p95) latency over the last 24h from assistant messages."""
    avg, p95 = db.execute(
        select(
            func.avg(Message.latency_ms),
            func.percentile_cont(0.95).within_group(Message.latency_ms.asc()),
        ).where(
            Message.role == Role.ASSISTANT,
            Message.is_deleted.is_(False),
            Message.latency_ms.is_not(None),
            Message.created_at >= now - LATENCY_WINDOW,
            Message.created_at <= now,
        )
    ).one()
    return (float(avg) if avg is not None else None, float(p95) if p95 is not None else None)


def health(db: Session) -> dict[str, Any]:
    """Platform health snapshot (matches ``AdminHealth``)."""
    now = datetime.now(timezone.utc)
    active = _active_generations()
    checks = [
        _check_database(db),
        _check_cache(),
        _check(
            "generation_queue",
            "ok",
            detail=f"{active} active generation(s)",
        ),
    ]

    error_rate = 0.0
    avg_latency = None
    p95_latency = None
    try:
        error_rate = _error_rate_1h(db, now)
        avg_latency, p95_latency = _latency_stats(db, now)
    except Exception as exc:
        logger.warning("admin health: aggregate metrics failed: %s", type(exc).__name__)
        _rollback_quietly(db)

    statuses = {check["status"] for check in checks}
    status = "down" if "down" in statuses else ("degraded" if "degraded" in statuses else "ok")
    return {
        "status": status,
        "checked_at": now,
        "uptime_seconds": round(time.monotonic() - _STARTED_AT, 3),
        "active_generations": active,
        "error_rate_1h": error_rate,
        "avg_latency_ms": avg_latency,
        "p95_latency_ms": p95_latency,
        "checks": checks,
    }
