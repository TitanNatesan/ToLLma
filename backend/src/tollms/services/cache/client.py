"""Valkey connection lifecycle. redis.asyncio speaks RESP, so it drives
Valkey unchanged. Connect is tolerant: when Valkey is unreachable the
client stays None and the manager bypasses the cache (PostgreSQL stays
authoritative, requests keep working).

Loop affinity: asyncio Redis clients are bound to the loop that created
them. The shared client transparently reconnects when the running loop
changes (tests, reloads); the sync bridge owns a separate client bound to
its own loop so the two never steal each other."""

import asyncio
import contextvars
import logging
import time
from typing import Any

from redis.asyncio import Redis

from tollms.core.config import get_settings

logger = logging.getLogger(__name__)

_client: Redis | None = None
_loop: asyncio.AbstractEventLoop | None = None

# Set inside sync-bridge coroutines: resolve the bridge client, not shared.
_bridge_mode: contextvars.ContextVar[bool] = contextvars.ContextVar("cache_bridge", default=False)
_bridge_client: Redis | None = None


def _params() -> dict[str, Any]:
    settings = get_settings()
    return {
        "host": settings.valkey_host,
        "port": settings.valkey_port,
        "password": settings.valkey_password or None,
        "db": settings.valkey_db,
        "decode_responses": True,
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
        "health_check_interval": 30,
        "max_connections": 50,
    }


def get_client() -> Redis | None:
    return _client


async def connect() -> bool:
    """Create the pooled client and validate with PING. Never raises."""
    global _client, _loop
    settings = get_settings()
    if not settings.cache_enabled:
        logger.info("cache disabled (CACHE_ENABLED=false); running without Valkey")
        return False
    try:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        client = Redis(**_params())
        await client.ping()
        _client = client
        _loop = running
        logger.info("cache connected: %s:%s db=%s", settings.valkey_host, settings.valkey_port, settings.valkey_db)
        return True
    except Exception:
        logger.warning(
            "cache unreachable at %s:%s; continuing without Valkey",
            settings.valkey_host, settings.valkey_port,
        )
        _client = None
        _loop = None
        return False


async def ensure_client() -> Redis | None:
    """Shared client for the calling loop; reconnects when the loop changed."""
    global _client, _loop
    if not get_settings().cache_enabled:
        return None
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        return _client
    if _client is None or _loop is not running:
        await disconnect()
        await connect()
    return _client


async def _bridge_connect() -> Redis | None:
    """Separate client owned by the sync-bridge loop. Never touches shared state."""
    global _bridge_client
    if not get_settings().cache_enabled:
        return None
    if _bridge_client is not None:
        return _bridge_client
    try:
        client = Redis(**_params())
        await client.ping()
        _bridge_client = client
        return client
    except Exception:
        logger.warning("cache bridge unreachable; bypassing", exc_info=True)
        return None


async def resolve_client() -> Redis | None:
    """Loop-correct client for the current context (async callers only)."""
    if _bridge_mode.get(False):
        return await _bridge_connect()
    return await ensure_client()


async def disconnect() -> None:
    global _client, _loop
    client, loop = _client, _loop
    _client, _loop = None, None
    if client is None:
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is not None and running is not loop:
        return  # owned by another (possibly dead) loop; just drop the reference
    try:
        await client.aclose()
    except Exception:
        logger.exception("cache disconnect failed")
    logger.info("cache disconnected")


async def ping() -> bool:
    client = await ensure_client()
    try:
        return client is not None and bool(await client.ping())
    except Exception:
        return False


async def server_info() -> dict[str, Any]:
    """Memory/clients/uptime/keyspace for the health endpoint. Never raises."""
    client = await ensure_client()
    if client is None:
        return {}
    try:
        start = time.monotonic()
        info = await client.info(section="server")
        memory = await _client.info(section="memory")
        clients = await _client.info(section="clients")
        keyspace = await _client.info(section="keyspace")
        dbsize = await _client.dbsize()
        return {
            "latency_ms": round((time.monotonic() - start) * 1000, 2),
            # Valkey reports redis_version for RESP compatibility; the real
            # release is valkey_version.
            "version": info.get("valkey_version") or info.get("redis_version"),
            "mode": info.get("redis_mode"),
            "uptime_seconds": info.get("uptime_in_seconds"),
            "used_memory_human": memory.get("used_memory_human"),
            "connected_clients": clients.get("connected_clients"),
            "keys": dbsize,
            "keyspace": {k: v for k, v in keyspace.items() if k.startswith("db")},
        }
    except Exception:
        logger.exception("cache info failed")
        return {}
