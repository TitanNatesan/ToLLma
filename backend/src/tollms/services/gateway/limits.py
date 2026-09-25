"""Per-key limits engine for the public gateway: rate windows + hard budgets.

Everything the public API needs to enforce a virtual key's policy lives here.
Windows are fixed, epoch-aligned baskets in Valkey with atomic counters:

    tollma:apilim:{key_id}:rpm:{epoch_minute}
    tollma:apilim:{key_id}:rph:{epoch_hour}
    tollma:apilim:{key_id}:rpd:{epoch_day}
    tollma:apilim:{key_id}:tpm:{epoch_minute}      (token units)
    tollma:apilim:{key_id}:tpd:{epoch_day}         (token units)
    tollma:apilim:{key_id}:model:{provider}:{model}:rpm|tpm:{bucket}
    tollma:apilim:{key_id}:spend:{period}          (micro-USD lifetime/period)
    tollma:apilim:{key_id}:spend:d:{YYYY-MM-DD}    (micro-USD daily)
    tollma:apilim:{key_id}:spend:m:{YYYY-MM}       (micro-USD monthly)
    tollma:apilim:{key_id}:model:{provider}:{model}:spend:{period}

Money counters store integer micro-USD (1e-6) so ``INCRBY`` stays atomic and
every arithmetic step remains Decimal-exact. ``budget_reset_days`` folds the
period index (``epoch_seconds // (days * 86400)``) into the spend key, so the
lifetime counter resets automatically every N days; without it the counter has
no expiry. Daily/monthly spend keys are date-based and reset naturally (UTC).

Reservations: ``check_request`` INCRs token and cost counters by the estimate;
``record_usage`` replaces the estimate with the actual values via an INCRBY
delta (clamped at zero), so a request that ends cheaper refunds the difference.
The frozen interface carries no request id, so the estimate is kept under a
short-lived reservation key scoped to ``(key, provider, model)``; concurrent
in-flight requests for the same scope reconcile against the latest snapshot
(best effort).

Fail-open / fail-closed policy (deliberate):
* A Valkey outage must never block all public API traffic, so rate windows — and
  budgets whose spend counter cannot be read — fail open (logged at WARNING).
* Budgets are hard while a spend counter is readable: the check reserves and
  verifies atomically, denies with HTTP 403 the moment ``spend + estimate`` would
  exceed the cap, and rolls its own reservation back. Spend can therefore never
  run over the cap, not even by one micro-dollar. When the counter is unreadable
  there is nothing to enforce against, so the request is allowed.
"""

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_CEILING, Decimal
from typing import Any

from tollms.services.api_keys.keys import KeyContext
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import call_sync, get_manager

logger = logging.getLogger(__name__)

__all__ = ["LimitsDecision", "check_request", "current_spend", "record_usage"]

_bridge_checked = False  # process-wide: the shared sync bridge warms up once

_SECTION = "apilim"
_MICROS_PER_USD = Decimal(1_000_000)
_MICRO_USD = Decimal("0.000001")
_WINDOW_SECONDS = {"rpm": 60, "rph": 3600, "rpd": 86400, "tpm": 60, "tpd": 86400}
_DAILY_TTL = 2 * 86400
_MONTHLY_TTL = 40 * 86400
_RESERVATION_TTL = 3600


@dataclass
class LimitsDecision:
    """Outcome of one limit check. `reason` names the first dimension that blocked."""

    allowed: bool
    reason: str | None = None
    retry_after: int | None = None
    status_code: int = 429


# --- clock / key helpers ----------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _period_index(days: int | None, now: datetime | None = None) -> str:
    """Budget period bucket: reset every `days`; "all" = never resets."""
    if days is None or days <= 0:
        return "all"
    epoch = int((now or _now()).timestamp())
    return str(epoch // (int(days) * 86400))


def _period_ttl(days: int | None) -> int | None:
    return int(days) * 86400 if days and days > 0 else None


def _bucket(epoch: int, window: int) -> int:
    return epoch // window


def _window_key(key_id: uuid.UUID, dimension: str, epoch: int, window: int, scope: str | None = None) -> str:
    prefix = f"{scope}:" if scope else ""
    return cache_keys._key(_SECTION, f"{key_id}:{prefix}{dimension}:{_bucket(epoch, window)}")  # noqa: SLF001


def _model_scope(provider_id: Any, model_id: Any) -> str:
    return f"model:{provider_id}:{model_id}"


def _spend_key(ctx: KeyContext, now: datetime) -> str:
    period = _period_index(ctx.policy.budget_reset_days, now)
    return cache_keys._key(_SECTION, f"{ctx.key_id}:spend:{period}")  # noqa: SLF001


def _daily_spend_key(ctx: KeyContext, now: datetime) -> str:
    return cache_keys._key(_SECTION, f"{ctx.key_id}:spend:d:{now.date().isoformat()}")  # noqa: SLF001


def _monthly_spend_key(ctx: KeyContext, now: datetime) -> str:
    return cache_keys._key(_SECTION, f"{ctx.key_id}:spend:m:{now.strftime('%Y-%m')}")  # noqa: SLF001


def _model_spend_key(ctx: KeyContext, provider_id: Any, model_id: Any, now: datetime) -> str:
    period = _period_index(ctx.policy.budget_reset_days, now)
    return cache_keys._key(  # noqa: SLF001
        _SECTION, f"{ctx.key_id}:{_model_scope(provider_id, model_id)}:spend:{period}"
    )


def _reservation_key(ctx: KeyContext, provider_id: Any, model_id: Any) -> str:
    return cache_keys._key(_SECTION, f"{ctx.key_id}:reserve:{provider_id}:{model_id}")  # noqa: SLF001


def _retry_after(epoch: int, window: int) -> int:
    return max(1, window - epoch % window)


def _seconds_until_utc_day_end(now: datetime) -> int:
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def _seconds_until_utc_month_end(now: datetime) -> int:
    if now.month == 12:
        first = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        first = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((first - now).total_seconds()))


def _as_uuid(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (AttributeError, TypeError, ValueError):
        return None


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_micros(amount: Decimal | float | int | str | None) -> int:
    """USD -> integer micro-USD, rounded up so an estimate never under-reserves."""
    if amount is None:
        return 0
    try:
        value = Decimal(str(amount)) * _MICROS_PER_USD
    except Exception:
        logger.warning("limits: unparsable money amount %r; treating as 0", amount)
        return 0
    return max(0, int(value.to_integral_value(rounding=ROUND_CEILING)))


# --- cache primitives (never raise; None = cache unavailable) ---------------


async def _client_incr(key: str, amount: int, ttl: int | None) -> Any:
    client = await get_manager().resolved_client()
    if client is None:
        return None
    pipe = client.pipeline(transaction=True)
    pipe.incrby(key, amount)
    if ttl is not None:
        pipe.expire(key, ttl, nx=True)
    values = await pipe.execute()
    return int(values[0])


def _cache_call(factory: Any, default: Any = None) -> Any:
    """Run a cache coroutine through the sync bridge, warming it up once.

    The shared bridge starts its loop lazily; early calls can race that
    start-up and come back empty even with a healthy Valkey. Until the first
    warm-up cycle completes, retry a couple of times with a short pause so the
    loop can come up. Once checked, an empty result is a genuine cache
    miss/failure and is returned without further delay.
    """
    global _bridge_checked
    attempts = 1 if _bridge_checked else 3
    for attempt in range(attempts):
        try:
            value = call_sync(factory(), default=None)
        except Exception:
            logger.warning("limits: cache call failed", exc_info=True)
            value = None
        if value is not None:
            _bridge_checked = True
            return value
        if attempt + 1 < attempts:
            time.sleep(0.05)  # let the lazily started bridge loop come up
    _bridge_checked = True
    return default


def _incr_counter(key: str, amount: int, ttl: int | None = None) -> int | None:
    """INCRBY + EXPIRE for one window key. Returns the new value, None on failure."""
    value = _cache_call(lambda: _client_incr(key, amount, ttl))
    if value is None:
        logger.warning("limits: counter increment unavailable: %s", key)
        return None
    return int(value)


async def _client_get(key: str) -> Any:
    client = await get_manager().resolved_client()
    if client is None:
        return None
    return await client.get(key)


def _read_counter(key: str) -> int | None:
    raw = _cache_call(lambda: _client_get(key))
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        logger.warning("limits: unparsable counter %r at %s; treating as unknown", raw, key)
        return None


async def _client_set_zero(key: str) -> Any:
    client = await get_manager().resolved_client()
    if client is None:
        return None
    return await client.set(key, 0, keepttl=True)


def _set_counter_zero(key: str) -> None:
    _cache_call(lambda: _client_set_zero(key))


class _Applied:
    """Increments issued during one check; rolled back if any dimension denies."""

    def __init__(self) -> None:
        self._items: list[tuple[str, int]] = []

    def incr(self, key: str, amount: int, ttl: int | None = None) -> int | None:
        if amount == 0:
            return _read_counter(key)
        value = _incr_counter(key, amount, ttl)
        if value is not None:
            self._items.append((key, amount))
        return value

    def add(self, key: str, amount: int) -> None:
        self._items.append((key, amount))

    def rollback(self) -> None:
        while self._items:
            key, amount = self._items.pop()
            try:
                _incr_counter(key, -amount)
            except Exception:
                logger.warning("limits: rollback failed for %s", key, exc_info=True)


# --- window checks ----------------------------------------------------------


def _check_window(
    applied: _Applied,
    key: str,
    limit: int | None,
    amount: int,
    window: int,
    reason: str,
    epoch: int,
) -> LimitsDecision | None:
    """None = allowed; a decision = denied."""
    if limit is None:
        return None
    if limit <= 0:
        return LimitsDecision(allowed=False, reason=reason, retry_after=_retry_after(epoch, window))
    if amount == 0:
        return None  # nothing to add; an existing counter can only be at the limit already
    value = applied.incr(key, amount, ttl=window)
    if value is None:
        logger.warning("limits: %s counter unavailable; failing open", reason)
        return None
    if value > limit:
        return LimitsDecision(allowed=False, reason=reason, retry_after=_retry_after(epoch, window))
    return None


def _reserve_money(applied: _Applied, key: str, amount: int, limit: int) -> bool | None:
    """True = within budget (and reserved), False = over, None = unreadable/fail open."""
    if amount <= 0:
        current = _read_counter(key)
        if current is None:
            logger.warning("limits: spend counter %s unreadable; failing open", key)
            return None
        return current <= limit
    new_value = _incr_counter(key, amount)
    if new_value is not None:
        if new_value > limit:
            _incr_counter(key, -amount)  # give back our own reservation
            return False
        applied.add(key, amount)
        return True
    current = _read_counter(key)
    if current is None:
        logger.warning("limits: spend counter %s unreadable; failing open", key)
        return None
    return current + amount <= limit


def _check_money(
    applied: _Applied,
    key: str,
    limit: Decimal | None,
    amount: int,
    reason: str,
    retry_after: int | None,
) -> LimitsDecision | None:
    if limit is None:
        return None
    allowed = _reserve_money(applied, key, amount, _to_micros(limit))
    if allowed is False:
        return LimitsDecision(allowed=False, reason=reason, retry_after=retry_after, status_code=403)
    return None


def _evaluate(
    ctx: KeyContext,
    now: datetime,
    provider_id: Any,
    model_id: Any,
    provider: uuid.UUID | None,
    model: uuid.UUID | None,
    tokens: int,
    cost_micros: int,
    applied: _Applied,
) -> LimitsDecision | None:
    """Run every dimension in order; return the first denial or None when allowed."""
    policy = ctx.policy
    epoch = int(now.timestamp())

    for reason in ("rpm", "rph", "rpd"):
        window = _WINDOW_SECONDS[reason]
        key = _window_key(ctx.key_id, reason, epoch, window)
        denied = _check_window(applied, key, getattr(policy, reason), 1, window, reason, epoch)
        if denied is not None:
            return denied
    for reason in ("tpm", "tpd"):
        window = _WINDOW_SECONDS[reason]
        key = _window_key(ctx.key_id, reason, epoch, window)
        denied = _check_window(applied, key, getattr(policy, reason), tokens, window, reason, epoch)
        if denied is not None:
            return denied

    override = None
    if provider is not None or model is not None:
        override = ctx.model_override(provider, model)  # type: ignore[arg-type]
    if override is not None:
        scope = _model_scope(provider_id, model_id)
        for reason, amount in (("model_rpm", 1), ("model_tpm", tokens)):
            window = _WINDOW_SECONDS[reason.removeprefix("model_")]
            key = _window_key(ctx.key_id, reason.removeprefix("model_"), epoch, window, scope=scope)
            denied = _check_window(applied, key, getattr(override, reason.removeprefix("model_")), amount, window, reason, epoch)
            if denied is not None:
                return denied

    daily = _check_money(
        applied,
        _daily_spend_key(ctx, now),
        policy.daily_spend_limit,
        cost_micros,
        "daily_spend",
        _seconds_until_utc_day_end(now),
    )
    if daily is not None:
        return daily
    monthly = _check_money(
        applied,
        _monthly_spend_key(ctx, now),
        policy.monthly_spend_limit,
        cost_micros,
        "monthly_spend",
        _seconds_until_utc_month_end(now),
    )
    if monthly is not None:
        return monthly
    lifetime = _check_money(
        applied, _spend_key(ctx, now), policy.max_budget_usd, cost_micros, "budget", None
    )
    if lifetime is not None:
        return lifetime
    if override is not None and override.max_budget is not None:
        return _check_money(
            applied,
            _model_spend_key(ctx, provider_id, model_id, now),
            override.max_budget,
            cost_micros,
            "model_budget",
            None,
        )
    return None


# --- reservations -----------------------------------------------------------


def _stash_reservation(
    ctx: KeyContext, provider_id: Any, model_id: Any, tokens: int, cost_micros: int
) -> None:
    try:
        _cache_call(
            lambda: get_manager().set(
                _reservation_key(ctx, provider_id, model_id),
                {"tokens": tokens, "cost_micros": cost_micros},
                ttl=_RESERVATION_TTL,
            )
        )
    except Exception:
        logger.warning("limits: reservation stash failed for key %s", ctx.key_id, exc_info=True)


def _pop_reservation(ctx: KeyContext, provider_id: Any, model_id: Any) -> tuple[int, int]:
    key = _reservation_key(ctx, provider_id, model_id)
    data = _cache_call(lambda: get_manager().get(key))
    _cache_call(lambda: get_manager().delete(key))
    if isinstance(data, dict):
        return _as_int(data.get("tokens")), _as_int(data.get("cost_micros"))
    return 0, 0


# --- public API -------------------------------------------------------------


def check_request(
    ctx: KeyContext,
    *,
    provider_id: uuid.UUID | str | None,
    model_id: uuid.UUID | str | None,
    estimated_tokens: int,
    estimated_cost: Decimal,
) -> LimitsDecision:
    """Check every limit and reserve the estimate. Never raises; fails open."""
    now = _now()
    tokens = max(0, _as_int(estimated_tokens))
    cost_micros = _to_micros(estimated_cost)
    provider = _as_uuid(provider_id)
    model = _as_uuid(model_id)
    applied = _Applied()
    try:
        denial = _evaluate(
            ctx, now, provider_id, model_id, provider, model, tokens, cost_micros, applied
        )
        if denial is not None:
            applied.rollback()
            return denial
        _stash_reservation(ctx, provider_id, model_id, tokens, cost_micros)
        return LimitsDecision(allowed=True)
    except Exception:
        logger.warning("limits: check failed for key %s; failing open", ctx.key_id, exc_info=True)
        try:
            applied.rollback()
        except Exception:
            logger.warning("limits: rollback after failure failed", exc_info=True)
        return LimitsDecision(allowed=True)


def _apply_delta(key: str, delta: int, ttl: int | None) -> None:
    if delta == 0:
        return
    if delta > 0:
        _incr_counter(key, delta, ttl)
        return
    value = _incr_counter(key, delta)
    if value is not None and value < 0:
        _set_counter_zero(key)


def record_usage(
    ctx: KeyContext,
    *,
    tokens: int,
    cost: Decimal,
    provider_id: uuid.UUID | str | None,
    model_id: uuid.UUID | str | None,
) -> None:
    """Reconcile the reservation with actual usage. Never raises."""
    now = _now()
    actual_tokens = max(0, _as_int(tokens))
    actual_micros = _to_micros(cost)
    provider = _as_uuid(provider_id)
    model = _as_uuid(model_id)
    try:
        reserved_tokens, reserved_micros = _pop_reservation(ctx, provider_id, model_id)
        delta_tokens = actual_tokens - reserved_tokens
        delta_micros = actual_micros - reserved_micros
        policy = ctx.policy
        epoch = int(now.timestamp())
        if delta_tokens:
            if policy.tpm is not None:
                _apply_delta(_window_key(ctx.key_id, "tpm", epoch, 60), delta_tokens, 60)
            if policy.tpd is not None:
                _apply_delta(_window_key(ctx.key_id, "tpd", epoch, 86400), delta_tokens, 86400)
        override = None
        if provider is not None or model is not None:
            override = ctx.model_override(provider, model)  # type: ignore[arg-type]
        if override is not None and delta_tokens and override.tpm is not None:
            scope = _model_scope(provider_id, model_id)
            _apply_delta(_window_key(ctx.key_id, "tpm", epoch, 60, scope=scope), delta_tokens, 60)
        if delta_micros:
            period_ttl = _period_ttl(policy.budget_reset_days)
            if policy.max_budget_usd is not None:
                _apply_delta(_spend_key(ctx, now), delta_micros, period_ttl)
            if policy.daily_spend_limit is not None:
                _apply_delta(_daily_spend_key(ctx, now), delta_micros, _DAILY_TTL)
            if policy.monthly_spend_limit is not None:
                _apply_delta(_monthly_spend_key(ctx, now), delta_micros, _MONTHLY_TTL)
            if override is not None and override.max_budget is not None:
                _apply_delta(_model_spend_key(ctx, provider_id, model_id, now), delta_micros, period_ttl)
    except Exception:
        logger.warning("limits: usage reconciliation failed for key %s", ctx.key_id, exc_info=True)


def current_spend(ctx: KeyContext) -> Decimal:
    """Spend booked for the key in the current budget period (0 when unavailable)."""
    micros = _read_counter(_spend_key(ctx, _now()))
    if micros is None:
        return Decimal(0)
    return Decimal(micros) * _MICRO_USD
