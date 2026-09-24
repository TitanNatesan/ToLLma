"""Real-time admin health sampling for the `/api/admin/health/stream` SSE feed.

One :func:`sample` call gathers the frozen live-health payload from bounded
probes:

- host metrics via psutil (CPU primed once at import, memory, disk, load),
- backend process counters (uptime, in-flight requests, active generations),
- PostgreSQL (`SELECT 1` latency plus `pg_stat_activity` connection count),
- Valkey (`INFO memory` -> ``used_memory`` in MB),
- generation queue depth (local drivers plus RUNNING rows without a driver).

Failure isolation: every probe catches its own exceptions, logs a warning and
zeroes/downgrades only its own section — :func:`sample` never raises. The cache
probe runs through the cache manager's sync bridge with a one-second budget;
the very first call in a process may also pay the bridge startup (~1s).

Queue approximation: `pending_jobs` counts assistant messages still RUNNING
whose id is not in the local driver registry (orphans from a restart, or rows
driven by another process). `running_jobs` is the local registry count. The
generation registry is per-process (documented in `services/generation.py`), so
the two views are exact on a single-process deployment.

Engines return plain mappings (validated by the router's ``AdminLiveHealth``
model); this package never imports from ``tollms.api``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

import psutil
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from tollms.core.config import get_settings
from tollms.db.session import SessionLocal
from tollms.models.message import Message, MessageStatus, Role
from tollms.services.admin.activity import active_requests
from tollms.services.cache.manager import call_sync, get_manager
from tollms.services.generation import manager as generation_manager

logger = logging.getLogger(__name__)

SSE_INTERVAL_SECONDS = 2.0
_CACHE_PROBE_TIMEOUT_SECONDS = 1.0
_BRIDGE_SETTLE_SECONDS = 0.1
_BYTES_PER_MB = 1024 * 1024
_BYTES_PER_GB = 1024**3

_DB_CONNECTIONS_SQL = text(
    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
)

# psutil's first non-blocking CPU read is always 0.0; prime it at import so the
# first streamed sample already reports a real interval.
psutil.cpu_percent(interval=None)
try:
    _PROCESS_STARTED_AT: float | None = psutil.Process().create_time()
except Exception:  # pragma: no cover - defensive (host permissions)
    logger.warning("live health: process start time unavailable", exc_info=True)
    _PROCESS_STARTED_AT = None

# Only the first cache probe in a process retries the lazy bridge startup;
# later probes stay bounded even when the cache is unreachable.
_cache_bridge_warmed = False


def _utc_timestamp() -> str:
    """ISO-8601 UTC with a `Z` suffix (frozen wire format)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rollback_quietly(db: Session) -> None:
    try:
        db.rollback()
    except Exception:
        logger.warning("live health: rollback failed", exc_info=True)


def _zero_server_metrics() -> dict[str, Any]:
    return {
        "cpu_percent": 0.0,
        "memory_percent": 0.0,
        "memory_used_mb": 0,
        "memory_total_mb": 0,
        "disk_percent": 0.0,
        "disk_used_gb": 0.0,
        "disk_total_gb": 0.0,
        "load_average": 0.0,
    }


def _server_metrics() -> dict[str, Any]:
    """Host metrics (psutil). A probe failure zeroes the affected values only."""
    metrics = _zero_server_metrics()
    try:
        metrics["cpu_percent"] = round(float(psutil.cpu_percent(interval=None)), 1)
        memory = psutil.virtual_memory()
        metrics["memory_percent"] = round(float(memory.percent), 1)
        metrics["memory_used_mb"] = int(memory.used // _BYTES_PER_MB)
        metrics["memory_total_mb"] = int(memory.total // _BYTES_PER_MB)
        disk = psutil.disk_usage("/")
        metrics["disk_percent"] = round(float(disk.percent), 1)
        metrics["disk_used_gb"] = round(float(disk.used) / _BYTES_PER_GB, 1)
        metrics["disk_total_gb"] = round(float(disk.total) / _BYTES_PER_GB, 1)
    except Exception as exc:
        logger.warning("live health: server probe failed: %s", type(exc).__name__)
    try:
        # POSIX only; containers without /proc/loadavg degrade to 0.0.
        metrics["load_average"] = round(float(psutil.getloadavg()[0]), 2)
    except Exception as exc:
        logger.warning("live health: load average probe failed: %s", type(exc).__name__)
    return metrics


def _active_generation_ids() -> set[uuid.UUID]:
    """Ids of local generation drivers whose asyncio task is not finished."""
    try:
        return {
            generation_id
            for generation_id, active in generation_manager._active.items()
            if active.task is None or not active.task.done()
        }
    except Exception as exc:
        logger.warning("live health: generation registry read failed: %s", type(exc).__name__)
        return set()


def _process_metrics(active_generations: int) -> dict[str, Any]:
    uptime = 0.0
    if _PROCESS_STARTED_AT is not None:
        try:
            uptime = round(max(0.0, time.time() - _PROCESS_STARTED_AT), 1)
        except Exception as exc:
            logger.warning("live health: uptime probe failed: %s", type(exc).__name__)
    try:
        requests_in_flight = max(0, int(active_requests()))
    except Exception as exc:
        logger.warning("live health: request counter read failed: %s", type(exc).__name__)
        requests_in_flight = 0
    return {
        "backend_uptime_seconds": uptime,
        "active_requests": requests_in_flight,
        "active_generations": active_generations,
    }


def _database_metrics(db: Session) -> dict[str, Any]:
    """`SELECT 1` latency plus live connection count; never raises."""
    start = time.monotonic()
    try:
        db.execute(select(1)).scalar_one()
    except Exception as exc:  # class name only — messages may carry credentials
        logger.warning("live health: database probe failed: %s", type(exc).__name__)
        _rollback_quietly(db)
        return {"status": "down", "connections": 0, "latency_ms": None}
    latency_ms = round((time.monotonic() - start) * 1000, 2)
    connections = 0
    try:
        connections = int(db.execute(_DB_CONNECTIONS_SQL).scalar_one())
    except Exception as exc:
        logger.warning("live health: connection count failed: %s", type(exc).__name__)
        _rollback_quietly(db)
    return {"status": "ok", "connections": connections, "latency_ms": latency_ms}


def _pending_jobs(db: Session, active_ids: set[uuid.UUID]) -> int:
    """RUNNING assistant rows with no local driver (one bounded SQL count)."""
    try:
        statement = (
            select(func.count())
            .select_from(Message)
            .where(
                Message.role == Role.ASSISTANT,
                Message.status == MessageStatus.RUNNING,
                Message.is_deleted.is_(False),
            )
        )
        if active_ids:
            statement = statement.where(Message.id.not_in(active_ids))
        return int(db.execute(statement).scalar_one())
    except Exception as exc:
        logger.warning("live health: queue count failed: %s", type(exc).__name__)
        _rollback_quietly(db)
        return 0


async def _cache_probe() -> tuple[str, float]:
    """(status, memory_mb) from one Valkey `INFO memory`; raises only to call_sync."""
    client = await get_manager().resolved_client()
    if client is None:
        return "down", 0.0
    info = await client.info(section="memory")
    used = info.get("used_memory")
    if used is None:
        return "degraded", 0.0
    return "ok", round(float(used) / _BYTES_PER_MB, 1)


def _cache_metrics() -> dict[str, Any]:
    global _cache_bridge_warmed

    if not get_settings().cache_enabled:
        # Cache disabled is a deliberate mode (PostgreSQL stays authoritative),
        # matching `/health/cache` semantics — degraded, not down.
        return {"status": "degraded", "memory_mb": 0.0}
    result = call_sync(_cache_probe(), timeout=_CACHE_PROBE_TIMEOUT_SECONDS, default=None)
    if result is None and not _cache_bridge_warmed:
        # The sync bridge starts lazily in a daemon thread; the very first
        # call in a process can race that startup (manager._bridge holds its
        # lock while polling). Give the loop a moment, then retry once so a
        # healthy cache is not misreported as down. Only the first probe pays
        # this so a truly unreachable cache stays bounded per tick.
        time.sleep(_BRIDGE_SETTLE_SECONDS)
        result = call_sync(_cache_probe(), timeout=_CACHE_PROBE_TIMEOUT_SECONDS, default=None)
    _cache_bridge_warmed = True
    if result is None:
        logger.warning("live health: cache probe timed out or failed")
        return {"status": "down", "memory_mb": 0.0}
    status, memory_mb = result
    return {"status": status, "memory_mb": memory_mb}


def _empty_sample() -> dict[str, Any]:
    """Structurally complete payload used when a whole sample cannot be built."""
    return {
        "timestamp": _utc_timestamp(),
        "server": _zero_server_metrics(),
        "process": {
            "backend_uptime_seconds": 0.0,
            "active_requests": 0,
            "active_generations": 0,
        },
        "database": {"status": "down", "connections": 0, "latency_ms": None},
        "cache": {"status": "down", "memory_mb": 0.0},
        "queue": {"pending_jobs": 0, "running_jobs": 0},
    }


def sample(db: Session | None = None) -> dict[str, Any]:
    """One complete live-health payload (frozen contract). Never raises.

    Callers may pass an existing session (tests); the SSE stream calls
    ``sample()`` with no argument, which opens and closes a short-lived
    ``SessionLocal`` per tick so a held request session is never pinned for
    the lifetime of the stream.
    """
    session = db
    owns_session = False
    try:
        if session is None:
            session = SessionLocal()
            owns_session = True
        active_ids = _active_generation_ids()
        return {
            "timestamp": _utc_timestamp(),
            "server": _server_metrics(),
            "process": _process_metrics(len(active_ids)),
            "database": _database_metrics(session),
            "cache": _cache_metrics(),
            "queue": {
                "pending_jobs": _pending_jobs(session, active_ids),
                "running_jobs": len(active_ids),
            },
        }
    except Exception as exc:  # belt and braces: the stream must never 500
        logger.warning("live health: sample failed: %s", type(exc).__name__)
        return _empty_sample()
    finally:
        if owns_session and session is not None:
            session.close()


def encode_event(payload: dict[str, Any]) -> str:
    """Serialise one payload as a Server-Sent Events `data:` frame."""
    return f"data: {json.dumps(payload)}\n\n"


async def stream(
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    """Yield SSE frames: immediately, then every `SSE_INTERVAL_SECONDS`.

    Stops cleanly when `is_disconnected()` reports the client gone or raises.
    Sampling runs in a worker thread so a slow probe (first cache-bridge call)
    never blocks the event loop.
    """
    while True:
        try:
            if await is_disconnected():
                return
        except Exception:
            logger.info("live health: disconnect probe failed; closing stream")
            return
        try:
            payload = await asyncio.to_thread(sample)
        except Exception:  # sample never raises; keep the stream alive anyway
            logger.warning("live health: sample failed", exc_info=True)
            payload = _empty_sample()
        yield encode_event(payload)
        await asyncio.sleep(SSE_INTERVAL_SECONDS)
