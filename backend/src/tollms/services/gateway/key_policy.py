"""Shared API-key policy enforcement for keyed traffic (public + in-app chat).

The public gateway (`api/public_gateway`) enforces key policy via
`services/gateway/limits.py` (Valkey reservations). In-app chat
(`api/gateway`) historically only checked key existence/owner/enabled/expired
plus the model allow-list — never IP rules, budgets, or rates, and never wrote
Valkey usage. Result: exhausted keys kept generating, and display spend
(Postgres SUMs) diverged from enforcement spend (Valkey counters, stuck at 0
for chat traffic).

This module is the single enforcement point both planes share:

* `ip_allowed` — deny-wins IP rules (unparseable client IP fails CLOSED when
  the key has any rules, open when it has none).
* `chat_key_context` — compile a `KeyContext` for an in-app `ApiKey` row.
* `postgres_spend` — one-round-trip Postgres spend fallback: SUMs both ledgers
  (`api_request_logs.cost` + `request_logs.total_cost`) for one key over a
  window. Exists because chat never wrote Valkey, so Valkey can read 0 while
  Postgres shows the key exhausted. The fallback denies before Valkey when the
  stored spend already covers the cap; the Valkey check still runs after for
  atomic reservation. Fail-open: any Postgres error returns 0 (the Valkey
  check remains the live gate).
* `org_cap_usd` — live org spend cap (None = personal key or uncapped).
* `enforce_chat_policy` — ordered gate raising 404-oracle / 403 / 429.

Budget windows mirror `limits._period_index`: fixed epoch buckets for
`budget_reset_days`, UTC calendar day/month for daily/monthly caps.
"""

import ipaddress
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import (
    AccountPendingDeletionError,
    ForbiddenError,
    NotFoundError,
    TooManyRequestsError,
)
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.request_log import RequestLog
from tollms.services.api_keys.keys import KeyContext, compile_context
from tollms.services.gateway import limits

logger = logging.getLogger(__name__)


# --- IP rules (shared by public + in-app) -------------------------------------


def _match_network(address: ipaddress.IPv4Address | ipaddress.IPv6Address, cidr: str) -> bool:
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return False
    try:
        return address in network
    except TypeError:
        return False


def ip_allowed(ctx: KeyContext, ip_text: str | None) -> bool:
    """Deny rules win; an empty rule set allows every address.

    Fail-closed: a missing or unparseable client address denies when the key
    has any IP rules (it cannot be evaluated against them), and allows only
    when the key has no rules at all. Never raises.
    """
    if not ctx.allow_rules and not ctx.deny_rules:
        return True
    if not ip_text:
        logger.warning("key policy: missing client ip for key %s; denying", ctx.key_prefix)
        return False
    try:
        address = ipaddress.ip_address(ip_text)
    except ValueError:
        logger.warning("key policy: unparseable client ip for key %s; denying", ctx.key_prefix)
        return False
    if any(_match_network(address, rule) for rule in ctx.deny_rules):
        return False
    if not ctx.allow_rules:
        return True
    return any(_match_network(address, rule) for rule in ctx.allow_rules)


# --- context / caps ------------------------------------------------------------


def chat_key_context(db: Session, api_key: ApiKey) -> KeyContext:
    """Compile a `KeyContext` for an in-app key row.

    The caller already loaded `api_key` (owner + policy/permission rows ride
    the same session via lazy load — one key, no N+1). Owner status is read
    live so a deleted/disabled owner blocks immediately.
    """
    from tollms.models.user import User

    owner = db.get(User, api_key.user_id) if api_key.user_id is not None else None
    return compile_context(api_key, owner)


def org_cap_usd(db: Session, ctx: KeyContext) -> Decimal | None:
    """Live org spend cap for keyed requests. None = personal key or uncapped.

    Read per request (indexed PK lookup): caps take effect immediately after
    PATCH without waiting on a cache TTL. None on any failure (fail-open;
    the key policy check still applies).
    """
    org_id = getattr(ctx, "org_id", None)
    if org_id is None:
        return None
    try:
        from tollms.models.organization import Organization

        org = db.get(Organization, org_id)
        if org is None or org.is_deleted:
            return None
        return org.max_spend
    except Exception:
        logger.warning("key policy: org cap lookup failed", exc_info=True)
        return None


# --- Postgres spend fallback ----------------------------------------------------


def _window_start(days: int | None, now: datetime) -> datetime | None:
    """Period start mirroring `limits._period_index` (fixed epoch buckets)."""
    if days is None or days <= 0:
        return None
    epoch = int(now.timestamp())
    return datetime.fromtimestamp(epoch - epoch % (int(days) * 86400), tz=timezone.utc)


def postgres_spend(db: Session, key_id, *, since: datetime | None = None) -> Decimal:
    """Stored spend for one key since `since` (or all-time when None).

    One round trip: two indexed scalar subqueries (both ledgers share the
    `(api_key_id, created_at)` composite). Counts every row regardless of
    status — mirrors the analytics SUMs, and conservative (fail-closed)
    direction keeps the pre-check safe. Never raises (0 on error).
    """
    try:
        api_sum = select(func.coalesce(func.sum(ApiRequestLog.cost), 0)).where(
            ApiRequestLog.api_key_id == key_id
        )
        chat_sum = select(func.coalesce(func.sum(RequestLog.total_cost), 0)).where(
            RequestLog.api_key_id == key_id
        )
        if since is not None:
            api_sum = api_sum.where(ApiRequestLog.created_at >= since)
            chat_sum = chat_sum.where(RequestLog.created_at >= since)
        total = db.execute(select(api_sum.scalar_subquery() + chat_sum.scalar_subquery())).scalar()
        return Decimal(str(total or 0))
    except Exception:
        logger.warning("key policy: postgres spend lookup failed", exc_info=True)
        return Decimal(0)


def postgres_deny(db: Session, ctx: KeyContext, estimated_cost: Decimal) -> tuple[str, int | None] | None:
    """(reason, retry_after) when stored Postgres spend already covers a cap.

    Shared by the in-app and public gates so both planes enforce identical
    budget truth even when the Valkey counters are cold (flush/restart) or
    behind. One aggregate call per configured cap; None when the key is
    uncapped. Dated caps carry a UTC retry_after mirroring the Valkey path
    (`limits._seconds_until_*`); lifetime budgets carry none. Never raises
    (None on error — Valkey remains the live gate).
    """
    return _deny_over_postgres(db, ctx, estimated_cost, datetime.now(timezone.utc))


def _deny_over_postgres(
    db: Session, ctx: KeyContext, estimated_cost: Decimal, now: datetime
) -> tuple[str, int | None] | None:
    """(reason, retry_after) when stored spend already covers a cap, else None.

    One aggregate call per configured cap (keys usually carry 0-1 caps, so
    usually zero calls); early-exits on the first denial. Skipped entirely
    when the key has no spend caps.
    """
    from tollms.services.gateway.limits import (  # shared engine internals
        _seconds_until_utc_day_end,
        _seconds_until_utc_month_end,
    )

    policy = ctx.policy
    candidates: list[tuple[Decimal | None, datetime | None, str, int | None]] = [
        (policy.max_budget_usd, _window_start(policy.budget_reset_days, now), "budget", None),
        (
            policy.daily_spend_limit,
            now.replace(hour=0, minute=0, second=0, microsecond=0),
            "daily_spend",
            _seconds_until_utc_day_end(now),
        ),
        (
            policy.monthly_spend_limit,
            now.replace(day=1, hour=0, minute=0, second=0, microsecond=0),
            "monthly_spend",
            _seconds_until_utc_month_end(now),
        ),
    ]
    for limit, since, reason, retry_after in candidates:
        if limit is None:
            continue
        spent = postgres_spend(db, ctx.key_id, since=since)
        if spent + Decimal(str(estimated_cost)) > Decimal(str(limit)):
            return reason, retry_after
    return None


# --- main gate -------------------------------------------------------------------


def enforce_chat_policy(
    db: Session,
    ctx: KeyContext,
    provider,
    model,
    estimated_tokens: int,
    estimated_cost: Decimal,
    request_id: str | None,
    client_ip: str | None,
    org_cap: Decimal | None,
) -> None:
    """Ordered key-policy gate for in-app chat. Raises on deny, else returns.

    Order: owner status (403) -> enabled/expired (404 oracle, same as the chat
    key gate — never 403, so key existence never leaks) -> IP rules (403
    ip_blocked) -> model allow-list (403 model_not_allowed) -> Postgres spend
    fallback (403 *_budget_exceeded) -> Valkey limits (403/429 with reason +
    retry_after). Emits one metrics-only deny event; enforcement itself never
    fails open beyond the documented fail-open paths in `limits`/`postgres`.
    """
    from tollms.services.observability.events import incr_counter

    def _deny(reason: str) -> None:
        incr_counter("gateway.denied", {"reason": reason})

    if ctx.owner_is_deleted or not ctx.owner_is_active:
        _deny("owner")
        raise ForbiddenError("API key owner account is disabled")
    if ctx.owner_pending_deletion:
        _deny("owner")
        raise AccountPendingDeletionError("Account scheduled for deletion.")
    if not ctx.enabled:
        _deny("disabled")
        raise NotFoundError("api key not found")
    if ctx.is_expired():
        _deny("expired")
        raise NotFoundError("api key not found")
    if not ip_allowed(ctx, client_ip):
        _deny("ip")
        raise ForbiddenError("ip_blocked: request blocked by API key IP rules")
    if not ctx.model_allowed(provider.id, model.id):
        _deny("model")
        raise ForbiddenError(f"model_not_allowed: model {model.id} is not allowed for this API key")
    denial = postgres_deny(db, ctx, Decimal(str(estimated_cost)))
    if denial is not None:
        _deny("budget")
        raise ForbiddenError(denial[0])
    decision = limits.check_request(
        ctx,
        provider_id=provider.id,
        model_id=model.id,
        estimated_tokens=max(0, int(estimated_tokens or 0)),
        estimated_cost=Decimal(str(estimated_cost)),
        request_id=request_id,
        org_max_spend_usd=org_cap,
    )
    if not decision.allowed:
        reason = decision.reason or "rate_limited"
        if decision.status_code == 429:
            _deny(reason)
            raise TooManyRequestsError(reason, retry_after=decision.retry_after)
        _deny(reason)
        raise ForbiddenError(reason)


def reconcile_chat_usage(
    ctx: KeyContext | None,
    *,
    provider_id,
    model_id,
    tokens: int,
    cost: Decimal,
    request_id: str | None,
    org_cap: Decimal | None,
) -> None:
    """Swap the pre-flight Valkey reservation for actuals. Never raises.

    No-op when the generation ran keyless (`ctx None`) or untracked. Callers
    pass 0/0 to release the reservation on provider failure/cancel/timeout.
    """
    if ctx is None or request_id is None:
        return
    try:
        limits.record_usage(
            ctx,
            tokens=max(0, int(tokens or 0)),
            cost=Decimal(str(cost or 0)),
            provider_id=provider_id,
            model_id=model_id,
            request_id=request_id,
            org_max_spend_usd=org_cap,
        )
    except Exception:
        logger.warning("key policy: usage reconciliation failed", exc_info=True)
