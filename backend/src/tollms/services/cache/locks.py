"""Distributed locks over Valkey (SET NX PX + token-checked release).
Used for repository sync, provider refresh, and scheduler jobs so duplicate
workers never run the same job twice."""

import logging
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from typing import Any

from tollms.services.cache.manager import call_sync, get_manager

logger = logging.getLogger(__name__)

_RELEASE_LUA = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
"""


async def acquire(name: str, ttl_ms: int, *, blocking: bool = False, timeout_ms: int = 0) -> str | None:
    """Acquire a lock; returns the holder token, or None when busy.

    Non-blocking by default (caller skips the job). blocking=True polls
    until timeout_ms for critical sections.
    """
    import asyncio as _asyncio

    manager = get_manager()
    client = await manager.resolved_client()  # loop-correct, failure-tolerant
    if client is None:
        return None
    token = uuid.uuid4().hex
    deadline = _asyncio.get_event_loop().time() + timeout_ms / 1000
    while True:
        try:
            if await client.set(name, token, nx=True, px=ttl_ms):
                return token
        except Exception:
            logger.warning("lock acquire failed: %s", name, exc_info=True)
            return None
        if not blocking:
            return None
        if _asyncio.get_event_loop().time() >= deadline:
            return None
        await _asyncio.sleep(0.05)


async def release(name: str, token: str) -> bool:
    """Release only if still held by token. Never raises."""
    manager = get_manager()
    client = await manager.resolved_client()
    if client is None or not token:
        return False
    try:
        try:
            released = await client.eval(_RELEASE_LUA, 1, name, token)
        except Exception:
            # Clients without Lua (some fakes): compare-and-delete fallback.
            current = await client.get(name)
            released = 0
            if current == token:
                released = await client.delete(name)
        return bool(released)
    except Exception:
        logger.warning("lock release failed: %s", name, exc_info=True)
        return False


@asynccontextmanager
async def locked(name: str, ttl_ms: int) -> AsyncIterator[bool]:
    """Non-blocking lock scope. Yields True when held, False when busy —
    the caller skips the job when busy (no exceptions for contention)."""
    token = await acquire(name, ttl_ms)
    try:
        yield token is not None
    finally:
        if token is not None:
            await release(name, token)


@contextmanager
def locked_sync(name: str, ttl_ms: int) -> Iterator[bool]:
    """Sync version of `locked` for sync service code. Never raises."""
    token = call_sync(acquire(name, ttl_ms))
    try:
        yield token is not None
    finally:
        if token is not None:
            call_sync(release(name, token), default=False)


def lock_status(name: str) -> dict[str, Any]:
    return {"lock": name}
