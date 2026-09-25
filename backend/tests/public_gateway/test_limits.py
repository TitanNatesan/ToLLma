"""Targeted tests for the public-gateway limits engine (real Valkey).

Covers rate windows and their reset boundaries, hard budgets with exact
micro-USD arithmetic, daily/monthly spend, per-model overrides, reservation
reconciliation and the fail-open/fail-closed policy.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from tollms.services.api_keys.keys import KeyContext, KeyPolicy, ModelPermission
from tollms.services.cache import client as cache_client
from tollms.services.gateway import limits

NOW = datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.run(coro)


def _require_valkey() -> None:
    assert _run(cache_client.connect()) is True, "Valkey must be reachable for limits tests"


def _ctx(policy: KeyPolicy | None = None, perms: tuple[ModelPermission, ...] = ()) -> KeyContext:
    return KeyContext(
        key_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="limits-test",
        key_prefix="tma_sk_live_test",
        enabled=True,
        expires_at=None,
        policy=policy or KeyPolicy(),
        model_permissions=perms,
    )


def _freeze(monkeypatch: pytest.MonkeyPatch, now: datetime) -> None:
    monkeypatch.setattr(limits, "_now", lambda: now)


def _check(
    ctx: KeyContext,
    *,
    provider_id: uuid.UUID,
    model_id: uuid.UUID,
    tokens: int = 10,
    cost: str = "0.001",
) -> limits.LimitsDecision:
    return limits.check_request(
        ctx,
        provider_id=provider_id,
        model_id=model_id,
        estimated_tokens=tokens,
        estimated_cost=Decimal(cost),
    )


# --- rate windows ------------------------------------------------------------


def test_rpm_window_trips_and_resets(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=2))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert _check(ctx, provider_id=pid, model_id=mid).allowed is True
    assert _check(ctx, provider_id=pid, model_id=mid).allowed is True

    denied = _check(ctx, provider_id=pid, model_id=mid)
    assert denied.allowed is False
    assert denied.reason == "rpm"
    assert denied.status_code == 429
    assert denied.retry_after is not None and 1 <= denied.retry_after <= 60

    # The denied request rolled its own increment back: same window still trips.
    _freeze(monkeypatch, NOW + timedelta(seconds=59))
    assert _check(ctx, provider_id=pid, model_id=mid).allowed is False

    # Next minute window resets.
    _freeze(monkeypatch, NOW + timedelta(seconds=61))
    assert _check(ctx, provider_id=pid, model_id=mid).allowed is True


def test_rph_and_rpd_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid = uuid.uuid4(), uuid.uuid4()

    hourly = _ctx(KeyPolicy(rph=1))
    assert _check(hourly, provider_id=pid, model_id=mid).allowed is True
    denied = _check(hourly, provider_id=pid, model_id=mid)
    assert denied.reason == "rph" and denied.retry_after is not None
    assert 1 <= denied.retry_after <= 3600

    daily = _ctx(KeyPolicy(rpd=1))
    assert _check(daily, provider_id=pid, model_id=mid).allowed is True
    denied = _check(daily, provider_id=pid, model_id=mid)
    assert denied.reason == "rpd" and denied.retry_after is not None
    assert 1 <= denied.retry_after <= 86400

    _freeze(monkeypatch, NOW + timedelta(seconds=3601))
    assert _check(hourly, provider_id=pid, model_id=mid).allowed is True
    assert _check(daily, provider_id=pid, model_id=mid).allowed is False  # same UTC day

    _freeze(monkeypatch, NOW + timedelta(days=1, seconds=1))
    assert _check(daily, provider_id=pid, model_id=mid).allowed is True


def test_tpm_and_tpd_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100, tpd=150))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert _check(ctx, provider_id=pid, model_id=mid, tokens=60).allowed is True
    denied = _check(ctx, provider_id=pid, model_id=mid, tokens=50)
    assert denied.reason == "tpm" and denied.status_code == 429

    # tpm resets next minute; tpd still holds the earlier 60.
    _freeze(monkeypatch, NOW + timedelta(seconds=61))
    assert _check(ctx, provider_id=pid, model_id=mid, tokens=60).allowed is True

    # tpd now at 120: +60 crosses the day cap (and rolls both counters back).
    _freeze(monkeypatch, NOW + timedelta(seconds=122))
    denied = _check(ctx, provider_id=pid, model_id=mid, tokens=60)
    assert denied.reason == "tpd"

    # Next UTC day resets tpd.
    _freeze(monkeypatch, NOW + timedelta(days=1))
    assert _check(ctx, provider_id=pid, model_id=mid, tokens=60).allowed is True


def test_record_usage_refunds_unused_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert _check(ctx, provider_id=pid, model_id=mid, tokens=90).allowed is True
    denied = _check(ctx, provider_id=pid, model_id=mid, tokens=30)
    assert denied.reason == "tpm"

    # Actual usage was 40 of the 90 reserved: refund 50, then 50 more fit.
    limits.record_usage(ctx, tokens=40, cost=Decimal("0"), provider_id=pid, model_id=mid)
    assert _check(ctx, provider_id=pid, model_id=mid, tokens=50).allowed is True
    assert _check(ctx, provider_id=pid, model_id=mid, tokens=10).allowed is True  # exactly at 100
    assert _check(ctx, provider_id=pid, model_id=mid, tokens=1).allowed is False


# --- budgets -----------------------------------------------------------------


def test_hard_budget_denies_without_overage(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("0.10")))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert _check(ctx, provider_id=pid, model_id=mid, cost="0.06").allowed is True
    assert limits.current_spend(ctx) == Decimal("0.06")

    denied = _check(ctx, provider_id=pid, model_id=mid, cost="0.05")
    assert denied.allowed is False
    assert denied.reason == "budget" and denied.status_code == 403
    assert limits.current_spend(ctx) == Decimal("0.06")  # own reservation rolled back

    # Exactly at the cap is allowed; one micro-dollar over is not.
    ctx2 = _ctx(KeyPolicy(max_budget_usd=Decimal("1.00")))
    assert _check(ctx2, provider_id=pid, model_id=mid, tokens=0, cost="1.00").allowed is True
    denied = _check(ctx2, provider_id=pid, model_id=mid, tokens=0, cost="0.000001")
    assert denied.allowed is False and denied.reason == "budget"

    # Reconciliation refunds the reservation difference.
    limits.record_usage(ctx, tokens=10, cost=Decimal("0.02"), provider_id=pid, model_id=mid)
    assert limits.current_spend(ctx) == Decimal("0.02")
    assert _check(ctx, provider_id=pid, model_id=mid, cost="0.05").allowed is True
    assert limits.current_spend(ctx) == Decimal("0.07")


def test_budget_reset_period_rollover(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("0.10"), budget_reset_days=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert _check(ctx, provider_id=pid, model_id=mid, cost="0.10").allowed is True
    denied = _check(ctx, provider_id=pid, model_id=mid, cost="0.01")
    assert denied.reason == "budget" and denied.status_code == 403

    later = NOW + timedelta(days=1)
    assert limits._period_index(1, NOW) != limits._period_index(1, later)  # noqa: SLF001
    _freeze(monkeypatch, later)
    assert _check(ctx, provider_id=pid, model_id=mid, cost="0.10").allowed is True
    assert limits.current_spend(ctx) == Decimal("0.10")


def test_daily_and_monthly_spend_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid = uuid.uuid4(), uuid.uuid4()

    daily = _ctx(KeyPolicy(daily_spend_limit=Decimal("0.05")))
    assert _check(daily, provider_id=pid, model_id=mid, cost="0.05").allowed is True
    denied = _check(daily, provider_id=pid, model_id=mid, cost="0.01")
    assert denied.reason == "daily_spend" and denied.status_code == 403

    _freeze(monkeypatch, NOW + timedelta(days=1))
    assert _check(daily, provider_id=pid, model_id=mid, cost="0.05").allowed is True

    monthly = _ctx(KeyPolicy(monthly_spend_limit=Decimal("0.05")))
    assert _check(monthly, provider_id=pid, model_id=mid, cost="0.05").allowed is True
    denied = _check(monthly, provider_id=pid, model_id=mid, cost="0.01")
    assert denied.reason == "monthly_spend" and denied.status_code == 403

    _freeze(monkeypatch, NOW + timedelta(days=32))  # next UTC month
    assert _check(monthly, provider_id=pid, model_id=mid, cost="0.05").allowed is True


def test_record_usage_clamps_refunds_at_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("1.00")))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    assert _check(ctx, provider_id=pid, model_id=mid, cost="0.05").allowed is True
    # Simulate a stale/duplicate reservation larger than the booked spend.
    monkeypatch.setattr(limits, "_pop_reservation", lambda *a, **k: (0, 100_000))
    limits.record_usage(ctx, tokens=0, cost=Decimal("0"), provider_id=pid, model_id=mid)
    assert limits.current_spend(ctx) == Decimal(0)


# --- per-model overrides -----------------------------------------------------


def test_per_model_overrides_only_tighten_their_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    perm = ModelPermission(
        provider_id=pid, model_id=mid, enabled=True, max_budget=Decimal("0.02"), rpm=1, tpm=10
    )
    ctx = _ctx(KeyPolicy(rpm=100, tpm=1000), (perm,))

    assert _check(ctx, provider_id=pid, model_id=mid, tokens=5, cost="0.01").allowed is True
    denied = _check(ctx, provider_id=pid, model_id=mid, tokens=5, cost="0.01")
    assert denied.reason == "model_rpm" and denied.status_code == 429

    _freeze(monkeypatch, NOW + timedelta(seconds=61))
    denied = _check(ctx, provider_id=pid, model_id=mid, tokens=20, cost="0.01")
    assert denied.reason == "model_tpm"

    _freeze(monkeypatch, NOW + timedelta(seconds=122))
    denied = _check(ctx, provider_id=pid, model_id=mid, tokens=5, cost="0.03")
    assert denied.reason == "model_budget" and denied.status_code == 403

    # Another model matches no override: only the (loose) key policy applies.
    assert _check(ctx, provider_id=pid, model_id=other, tokens=5, cost="0.03").allowed is True


# --- failure policy ----------------------------------------------------------


def test_limits_fail_open_on_cache_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _ctx(KeyPolicy(rpm=1, tpm=1, max_budget_usd=Decimal("0.01")))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    def _boom(*args, **kwargs):
        raise RuntimeError("valkey down")

    monkeypatch.setattr(limits, "_incr_counter", _boom)
    monkeypatch.setattr(limits, "_read_counter", lambda key: None)

    decision = limits.check_request(
        ctx,
        provider_id=pid,
        model_id=mid,
        estimated_tokens=500,
        estimated_cost=Decimal("5.00"),
    )
    assert decision.allowed is True
    limits.record_usage(ctx, tokens=500, cost=Decimal("5.00"), provider_id=pid, model_id=mid)


def test_budget_fails_closed_when_spend_counter_readable(monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("0.10")))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    monkeypatch.setattr(limits, "_incr_counter", lambda *a, **k: None)
    monkeypatch.setattr(limits, "_read_counter", lambda key: 50_000)  # $0.05 already spent

    denied = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=0, estimated_cost=Decimal("0.06")
    )
    assert denied.allowed is False and denied.reason == "budget" and denied.status_code == 403

    allowed = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=0, estimated_cost=Decimal("0.01")
    )
    assert allowed.allowed is True


def test_current_spend_unavailable_is_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("1.00")))
    monkeypatch.setattr(limits, "_read_counter", lambda key: None)
    assert limits.current_spend(ctx) == Decimal(0)
