"""Health endpoints. No business logic, no auth."""

import logging

from fastapi import APIRouter
from sqlalchemy import text

from tollms.db.session import engine

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def readiness() -> dict[str, str]:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("readiness check: database unreachable")
        return {"status": "degraded", "database": "unreachable"}
    return {"status": "ok", "database": "reachable"}


@router.get("/health/cache")
async def cache_health() -> dict:
    """Valkey status + client-side hit ratio. Degraded (not 500) when down —
    PostgreSQL stays authoritative, so the app works without cache."""
    from tollms.services.cache import client as cache_client
    from tollms.services.cache.metrics import metrics

    reachable = await cache_client.ping()
    info = await cache_client.server_info() if reachable else {}
    snapshot = metrics.snapshot()
    return {
        "status": "healthy" if reachable else "degraded",
        "hit_rate": snapshot["hit_rate"],
        "keys": info.get("keys", 0),
        "metrics": snapshot,
        "server": {
            "version": info.get("version"),
            "mode": info.get("mode"),
            "uptime_seconds": info.get("uptime_seconds"),
            "used_memory_human": info.get("used_memory_human"),
            "connected_clients": info.get("connected_clients"),
            "latency_ms": info.get("latency_ms"),
        }
        if info
        else None,
    }
