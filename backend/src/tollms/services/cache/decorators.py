"""Cache decorators for async callables. Cache failures never break the
wrapped function — misses and errors fall through to the source."""

import functools
import inspect
import logging
from collections.abc import Awaitable, Callable
from typing import Any, ParamSpec, TypeVar

from tollms.services.cache.manager import get_manager

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

KeySpec = str | Callable[..., str]


def _resolve_key(spec: KeySpec, args: tuple, kwargs: dict) -> str | None:
    try:
        return spec(*args, **kwargs) if callable(spec) else spec
    except Exception:
        logger.warning("cache key builder failed", exc_info=True)
        return None


def cached(key: KeySpec, ttl: int | None = None) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Cache an async function's return value. Miss -> compute, store, return."""

    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            cache_key = _resolve_key(key, args, kwargs)
            manager = get_manager()
            if cache_key is not None:
                hit = await manager.get(cache_key)
                if hit is not None:
                    return hit
            result = await func(*args, **kwargs)
            if cache_key is not None and result is not None:
                await manager.set(cache_key, result, ttl=ttl)
            return result

        return wrapper

    return decorator


def cache_invalidate(*specs: KeySpec) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Invalidate keys/patterns after the wrapped function runs (sync or async)."""

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
                result = await func(*args, **kwargs)
                await _invalidate(specs, args, kwargs)
                return result

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(func)
        def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            import asyncio as _asyncio

            result = func(*args, **kwargs)
            try:
                loop = _asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop is not None:
                loop.create_task(_invalidate(specs, args, kwargs))
            else:
                _asyncio.run(_invalidate(specs, args, kwargs))
            return result

        return sync_wrapper  # type: ignore[return-value]

    return decorator


async def _invalidate(specs: tuple[KeySpec, ...], args: tuple, kwargs: dict) -> None:
    manager = get_manager()
    for spec in specs:
        cache_key = _resolve_key(spec, args, kwargs)
        if cache_key is None:
            continue
        if "*" in cache_key:
            await manager.invalidate_pattern(cache_key)
        else:
            await manager.delete(cache_key)


def cache_refresh(key: KeySpec, ttl: int | None = None) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Always recompute and overwrite the cache entry, then return it."""

    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            result = await func(*args, **kwargs)
            cache_key = _resolve_key(key, args, kwargs)
            if cache_key is not None and result is not None:
                await get_manager().set(cache_key, result, ttl=ttl)
            return result

        return wrapper

    return decorator
