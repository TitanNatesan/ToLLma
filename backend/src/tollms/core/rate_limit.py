"""Auth abuse protection: Valkey fixed-window rate limiter + login lockout.

Fail CLOSED: every helper denies with 503 when Valkey is unreachable, since
sessions already require Valkey. Audit logs never carry passwords, tokens,
credentials or keys — only scopes, counters and non-reversible digests.

Phase 3 hook: a verification-resend endpoint reuses `limit("auth:resend")`
with no changes to this module.
"""

import hashlib
import logging
from typing import Any

from fastapi import Request
from redis.asyncio import Redis

from tollms.core.config import get_settings
from tollms.core.exceptions import ServiceUnavailableError, TooManyRequestsError
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager

logger = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """Best-effort client IP for keying. Never trusted for auth decisions."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64] or "unknown"
    if request.client is not None:
        return request.client.host[:64]
    return "unknown"


async def _client_or_raise() -> Redis:
    """Valkey client or fail-closed 503. Never returns None, never leaks details."""
    try:
        client = await get_manager().resolved_client()
    except Exception:
        logger.exception("auth limiter: Valkey resolution failed, denying")
        raise ServiceUnavailableError("authentication temporarily unavailable") from None
    if client is None:
        logger.error("auth limiter: Valkey unavailable, denying auth path")
        raise ServiceUnavailableError("authentication temporarily unavailable")
    return client


async def _window_incr(client: Redis, key: str, window_seconds: int) -> tuple[int, int]:
    """INCR + first-write EXPIRE. Returns (count, ttl_seconds)."""
    try:
        pipe = client.pipeline(transaction=True)
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)
        pipe.ttl(key)
        count, _, ttl = await pipe.execute()
        return int(count), int(ttl)
    except Exception:
        logger.exception("auth limiter: Valkey command failed, denying")
        raise ServiceUnavailableError("authentication temporarily unavailable") from None


async def check_fixed_window(*, key: str, limit: int, window_seconds: int, scope: str) -> None:
    """Allow, or raise 429 with Retry-After (503 when Valkey is down)."""
    client = await _client_or_raise()
    count, ttl = await _window_incr(client, key, window_seconds)
    if count > limit:
        retry_after = ttl if ttl and ttl > 0 else window_seconds
        logger.warning("rate limit exceeded: scope=%s count=%d", scope, count)
        raise TooManyRequestsError(
            "too many requests, please try again later", retry_after=retry_after
        )


def limit(scope: str, *, max_attempts: int | None = None, window_seconds: int | None = None) -> Any:
    """FastAPI dependency factory: fixed-window limit per scope + client IP."""

    async def _dependency(request: Request) -> None:
        settings = get_settings()
        await check_fixed_window(
            key=cache_keys.auth_rate_limit(scope, client_ip(request)),
            limit=settings.auth_rate_limit_attempts if max_attempts is None else max_attempts,
            window_seconds=(
                settings.auth_rate_limit_window_seconds
                if window_seconds is None
                else window_seconds
            ),
            scope=scope,
        )

    return _dependency


def _attempt_digest(email: str, ip: str | None) -> str:
    return hashlib.sha256(f"{email.strip().lower()}|{(ip or 'unknown')[:64]}".encode()).hexdigest()


async def check_login_lockout(email: str, ip: str | None) -> None:
    """Raise 429 while the email+IP pair is locked (503 when Valkey is down)."""
    settings = get_settings()
    client = await _client_or_raise()
    key = cache_keys.login_attempts(_attempt_digest(email, ip))
    try:
        raw = await client.get(key)
        ttl = await client.ttl(key)
    except Exception:
        logger.exception("auth limiter: lockout read failed, denying")
        raise ServiceUnavailableError("authentication temporarily unavailable") from None
    count = 0
    if raw is not None:
        try:
            count = int(raw)
        except (TypeError, ValueError):
            logger.warning("auth limiter: unparsable attempt counter, denying")
            raise ServiceUnavailableError("authentication temporarily unavailable") from None
    threshold = max(1, settings.login_max_attempts)
    if count >= threshold:
        retry_after = ttl if isinstance(ttl, int) and ttl > 0 else settings.login_lockout_seconds
        logger.warning("login locked out: attempts=%d retry_after=%d", count, retry_after)
        raise TooManyRequestsError(
            "too many failed login attempts, try again later", retry_after=retry_after
        )


async def record_failed_login(email: str, ip: str | None) -> int:
    """Count a failed attempt. Returns the new total (503 when Valkey is down)."""
    settings = get_settings()
    client = await _client_or_raise()
    key = cache_keys.login_attempts(_attempt_digest(email, ip))
    count, _ = await _window_incr(client, key, settings.login_lockout_seconds)
    threshold = max(1, settings.login_max_attempts)
    if count >= threshold:
        logger.warning(
            "login lockout engaged: attempts=%d lockout=%ds", count, settings.login_lockout_seconds
        )
    else:
        logger.info("login failed: attempts=%d", count)
    return count


async def clear_failed_logins(email: str, ip: str | None) -> None:
    """Reset the counter after a successful login. Best-effort; never raises."""
    try:
        await get_manager().delete(cache_keys.login_attempts(_attempt_digest(email, ip)))
    except Exception:
        logger.warning("auth limiter: attempt reset failed", exc_info=True)
