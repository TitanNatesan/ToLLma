"""Central cache manager: typed get/set/delete + bulk + TTL + pattern
invalidation. Every operation is failure-tolerant — Valkey errors are
logged, counted, and degrade to a cache bypass so PostgreSQL (the source
of truth) always serves the request."""

import asyncio
import logging
import threading
import time
from collections.abc import Coroutine
from typing import Any

from redis.asyncio import Redis

from tollms.core.config import get_settings
from tollms.services.cache import client as _client_mod
from tollms.services.cache.metrics import metrics
from tollms.services.cache.serializers import decode, encode

logger = logging.getLogger(__name__)


class CacheManager:
    def __init__(self, redis_client: Redis | None = None) -> None:
        # Explicit client (tests inject fakeredis); otherwise the shared
        # lifespan client resolved per operation (connect may happen later).
        self._client = redis_client

    def _resolve(self) -> Redis | None:
        if self._client is not None:
            return self._client
        if not get_settings().cache_enabled:
            return None
        return _client_mod.get_client()

    async def resolved_client(self) -> Redis | None:
        """Loop-correct client: injected fakes bypass; otherwise resolve for
        the calling loop (shared client) or the bridge loop (bridge client)."""
        if self._client is not None:
            return self._client
        return await _client_mod.resolve_client()

    async def _timed(self, label: str, coro_factory) -> Any:
        start = time.monotonic()
        try:
            return await coro_factory()
        finally:
            metrics.observe_latency((time.monotonic() - start) * 1000)

    async def get(self, key: str) -> Any:
        client = await self.resolved_client()
        if client is None:
            return None
        try:
            value = decode(await self._timed("get", lambda: client.get(key)))
        except Exception:
            logger.warning("cache GET failed: %s", key, exc_info=True)
            metrics.record_error()
            return None
        if value is None:
            metrics.record_miss()
        else:
            metrics.record_hit()
        return value

    async def set(self, key: str, value: Any, ttl: int | None = None) -> bool:
        if value is None:
            return False
        client = await self.resolved_client()
        if client is None:
            return False
        try:
            payload = encode(value)
            await self._timed("set", lambda: client.set(key, payload, ex=ttl))
        except Exception:
            logger.warning("cache SET failed: %s", key, exc_info=True)
            metrics.record_error()
            return False
        metrics.record_write()
        return True

    async def delete(self, *keys: str) -> int:
        client = await self.resolved_client()
        if client is None or not keys:
            return 0
        try:
            removed = await self._timed("delete", lambda: client.delete(*keys))
        except Exception:
            logger.warning("cache DELETE failed: %s", keys, exc_info=True)
            metrics.record_error()
            return 0
        metrics.record_invalidation(removed)
        return int(removed)

    async def exists(self, key: str) -> bool:
        client = await self.resolved_client()
        if client is None:
            return False
        try:
            return bool(await self._timed("exists", lambda: client.exists(key)))
        except Exception:
            logger.warning("cache EXISTS failed: %s", key, exc_info=True)
            metrics.record_error()
            return False

    async def mget(self, keys: list[str]) -> list[Any]:
        client = await self.resolved_client()
        if client is None or not keys:
            return [None] * len(keys)
        try:
            raw = await self._timed("mget", lambda: client.mget(keys))
            return [decode(v) for v in raw]
        except Exception:
            logger.warning("cache MGET failed", exc_info=True)
            metrics.record_error()
            return [None] * len(keys)

    async def mset(self, data: dict[str, Any], ttl: int | None = None) -> bool:
        """Bulk set; TTL applies per key via pipeline when given."""
        if not data:
            return False
        client = await self.resolved_client()
        if client is None:
            return False
        try:
            payloads = {k: encode(v) for k, v in data.items() if v is not None}
            if not payloads:
                return False

            async def _write() -> None:
                if ttl is None:
                    await client.mset(payloads)
                else:
                    pipe = client.pipeline(transaction=False)
                    for k, v in payloads.items():
                        pipe.set(k, v, ex=ttl)
                    await pipe.execute()

            await self._timed("mset", _write)
        except Exception:
            logger.warning("cache MSET failed", exc_info=True)
            metrics.record_error()
            return False
        for _ in payloads:
            metrics.record_write()
        return True

    async def ttl(self, key: str) -> int | None:
        client = await self.resolved_client()
        if client is None:
            return None
        try:
            value = await self._timed("ttl", lambda: client.ttl(key))
            return int(value)
        except Exception:
            logger.warning("cache TTL failed: %s", key, exc_info=True)
            metrics.record_error()
            return None

    async def expire(self, key: str, ttl: int) -> bool:
        client = await self.resolved_client()
        if client is None:
            return False
        try:
            return bool(await self._timed("expire", lambda: client.expire(key, ttl)))
        except Exception:
            logger.warning("cache EXPIRE failed: %s", key, exc_info=True)
            metrics.record_error()
            return False

    async def sadd(self, key: str, *members: str) -> int:
        """Add members to a set (used by the auth-session index)."""
        client = await self.resolved_client()
        if client is None or not members:
            return 0
        try:
            return int(await self._timed("sadd", lambda: client.sadd(key, *members)))
        except Exception:
            logger.warning("cache SADD failed: %s", key, exc_info=True)
            metrics.record_error()
            return 0

    async def srem(self, key: str, *members: str) -> int:
        client = await self.resolved_client()
        if client is None or not members:
            return 0
        try:
            return int(await self._timed("srem", lambda: client.srem(key, *members)))
        except Exception:
            logger.warning("cache SREM failed: %s", key, exc_info=True)
            metrics.record_error()
            return 0

    async def smembers(self, key: str) -> "set[str]":
        client = await self.resolved_client()
        if client is None:
            return set()
        try:
            values = await self._timed("smembers", lambda: client.smembers(key))
        except Exception:
            logger.warning("cache SMEMBERS failed: %s", key, exc_info=True)
            metrics.record_error()
            return set()
        return {v.decode() if isinstance(v, bytes) else str(v) for v in values}

    async def invalidate_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern via SCAN (safe on large keyspaces)."""
        client = await self.resolved_client()
        if client is None:
            return 0
        removed = 0
        try:
            async for key in client.scan_iter(match=pattern, count=200):
                await client.delete(key)
                removed += 1
        except Exception:
            logger.warning("cache invalidate failed: %s", pattern, exc_info=True)
            metrics.record_error()
            return removed
        metrics.record_invalidation(removed)
        return removed


_manager = CacheManager()


def get_manager() -> CacheManager:
    return _manager


# --- sync bridge -----------------------------------------------------------
# Sync service code (SQLAlchemy sessions, threadpool endpoints, APScheduler
# jobs) cannot await. A dedicated daemon loop runs cache coroutines for
# them — safe from any thread, even one with a running event loop.

_bridge_lock = threading.RLock()
_bridge_loop: asyncio.AbstractEventLoop | None = None
_bridge_starting = False


def _bridge() -> asyncio.AbstractEventLoop | None:
    global _bridge_loop, _bridge_starting
    with _bridge_lock:
        if _bridge_loop is not None and _bridge_loop.is_running():
            return _bridge_loop
        if not _bridge_starting:
            _bridge_starting = True

            def _run() -> None:
                global _bridge_loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                with _bridge_lock:
                    _bridge_loop = loop
                loop.run_forever()

            threading.Thread(target=_run, name="cache-bridge", daemon=True).start()
    # Poll WITHOUT holding the lock: _run() needs it to publish the loop.
    # Holding it across the sleep deadlocks startup (the child blocks until
    # we time out) and every first call_sync in a process silently no-ops.
    # Thread scheduling under load can exceed 1s; allow up to ~5s.
    for _ in range(100):
        with _bridge_lock:
            if _bridge_loop is not None:
                if _bridge_loop.is_running():
                    return _bridge_loop
                # Dead loop: allow a fresh bridge on the next call.
                _bridge_loop = None
                _bridge_starting = False
        time.sleep(0.05)
    return None


def call_sync(coro: Coroutine[Any, Any, Any], *, timeout: float = 5.0, default: Any = None) -> Any:
    """Run a cache coroutine from sync code. Never raises; default on failure."""

    async def _scoped() -> Any:
        token = _client_mod._bridge_mode.set(True)
        try:
            return await coro
        finally:
            _client_mod._bridge_mode.reset(token)

    try:
        loop = _bridge()
        if loop is None:
            coro.close()
            return default
        return asyncio.run_coroutine_threadsafe(_scoped(), loop).result(timeout=timeout)
    except Exception:
        logger.warning("cache sync bridge failed", exc_info=True)
        return default


def call_sync_strict(coro: Coroutine[Any, Any, Any], *, timeout: float = 5.0) -> Any:
    """Bridge that propagates ApplicationException (rate-limit 429,
    fail-closed 503) instead of swallowing it. Bridge/transport failures
    become ServiceUnavailableError (fail-closed). For quota-style gates that
    must deny, never default-allow."""

    async def _scoped_strict() -> Any:
        token = _client_mod._bridge_mode.set(True)
        try:
            return await coro
        finally:
            _client_mod._bridge_mode.reset(token)

    from tollms.core.exceptions import ApplicationException, ServiceUnavailableError

    try:
        loop = _bridge()
        if loop is None:
            coro.close()
            raise ServiceUnavailableError("validation limiter unavailable")
        return asyncio.run_coroutine_threadsafe(_scoped_strict(), loop).result(timeout=timeout)
    except ApplicationException:
        raise
    except Exception:
        logger.warning("strict cache sync bridge failed", exc_info=True)
        raise ServiceUnavailableError("validation limiter unavailable") from None


def cache_get_sync(key: str) -> Any:
    return call_sync(get_manager().get(key))


def cache_set_sync(key: str, value: Any, ttl: int | None = None) -> bool:
    return bool(call_sync(get_manager().set(key, value, ttl=ttl), default=False))


def cache_delete_sync(*keys: str) -> int:
    if not keys:
        return 0
    return int(call_sync(get_manager().delete(*keys), default=0) or 0)


def cache_invalidate_sync(*specs: str) -> int:
    """Delete exact keys or glob patterns from sync code. Never raises."""

    async def _go() -> int:
        manager = get_manager()
        total = 0
        for spec in specs:
            if "*" in spec:
                total += await manager.invalidate_pattern(spec)
            else:
                total += await manager.delete(spec)
        return total

    if not specs:
        return 0
    return int(call_sync(_go(), default=0) or 0)
