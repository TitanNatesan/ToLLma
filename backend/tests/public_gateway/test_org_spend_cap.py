"""Org spend-cap enforcement at request time (spend-time hard upper bound).

The org `max_spend` cap is enforced in the limits engine via a shared
atomic Valkey counter per org (`apilim:{org_id}:org-spend`), reserved in
`check_request` alongside per-key budgets and reconciled in `record_usage`.
Every org-key gateway request passes its org's live cap; personal keys
(`org_id=None`) and uncapped orgs are unaffected.

Covers: cap exhaustion blocking, cross-key pool sharing, personal-key
isolation, concurrent-burst non-overspend, reconciliation, overbudget flag.
Real Valkey, unique org per test (no cross-test pollution).
"""

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from tollms.services.api_keys.keys import KeyContext, KeyPolicy
from tollms.services.cache import client as cache_client
from tollms.services.gateway import limits

NOW = datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc)


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def _require_valkey() -> None:
    assert _run(cache_client.connect()) is True, "Valkey must be reachable"


def _org_ctx(org_id: uuid.UUID, policy: KeyPolicy | None = None) -> KeyContext:
    return KeyContext(
        key_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="org-cap-test",
        key_prefix="tma_sk_live_test",
        enabled=True,
        expires_at=None,
        policy=policy or KeyPolicy(),
        model_permissions=(),
        org_id=org_id,
    )


def _check(ctx, cap, *, cost="0.001", tokens=10):
    return limits.check_request(
        ctx,
        provider_id=uuid.uuid4(),
        model_id=uuid.uuid4(),
        estimated_tokens=tokens,
        estimated_cost=Decimal(cost),
        org_max_spend_usd=cap,
    )


@pytest.fixture(autouse=True)
def _valkey(monkeypatch: pytest.MonkeyPatch):
    _require_valkey()
    monkeypatch.setattr(limits, "_now", lambda: NOW)


def test_org_cap_blocks_when_exhausted() -> None:
    org = uuid.uuid4()
    ctx = _org_ctx(org)
    cap = Decimal("0.002")
    assert _check(ctx, cap).allowed is True
    assert _check(ctx, cap).allowed is True  # exactly at cap: allowed
    denied = _check(ctx, cap)
    assert denied.allowed is False
    assert denied.reason == "org_budget"
    assert denied.status_code == 403


def test_org_cap_none_means_unlimited() -> None:
    org = uuid.uuid4()
    ctx = _org_ctx(org)
    for _ in range(5):
        assert _check(ctx, None).allowed is True


def test_personal_key_ignores_org_counter() -> None:
    org = uuid.uuid4()
    # Exhaust the org pool with an org key first.
    assert _check(_org_ctx(org), Decimal("0.001")).allowed is True
    assert _check(_org_ctx(org), Decimal("0.001")).allowed is False
    # A personal key (org_id None) is unaffected by that pool.
    personal = _org_ctx(None)
    assert personal.org_id is None
    for _ in range(3):
        assert _check(personal, None).allowed is True


def test_org_spend_shared_across_keys() -> None:
    org = uuid.uuid4()
    cap = Decimal("0.002")
    key_a, key_b = _org_ctx(org), _org_ctx(org)
    assert key_a.key_id != key_b.key_id
    assert _check(key_a, cap).allowed is True
    assert _check(key_a, cap).allowed is True
    # Second key sees the shared pool: blocked even though it spent nothing.
    denied = _check(key_b, cap)
    assert denied.allowed is False
    assert denied.reason == "org_budget"


def test_org_cap_concurrent_burst_cannot_overspend() -> None:
    org = uuid.uuid4()
    cap = Decimal("0.005")  # 5000 micros; each request reserves 1000
    results = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [
            pool.submit(
                limits.check_request,
                _org_ctx(org),
                provider_id=uuid.uuid4(),
                model_id=uuid.uuid4(),
                estimated_tokens=10,
                estimated_cost=Decimal("0.001"),
                org_max_spend_usd=cap,
            )
            for _ in range(10)
        ]
        results = [f.result() for f in futures]
    allowed = [d for d in results if d.allowed]
    # Exactly 5 × 1000 micros fit; the 6th+ reservation is denied + rolled back.
    assert len(allowed) == 5
    assert all(d.allowed is False and d.reason == "org_budget" for d in results if not d.allowed)


def test_record_usage_reconciles_org_counter() -> None:
    org = uuid.uuid4()
    cap = Decimal("0.010")
    ctx = _org_ctx(org)
    pid, mid = uuid.uuid4(), uuid.uuid4()
    rid = f"req-{uuid.uuid4().hex[:8]}"
    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=10,
        estimated_cost=Decimal("0.001"), request_id=rid, org_max_spend_usd=cap,
    ).allowed is True
    limits.record_usage(
        ctx, tokens=150, cost=Decimal("0.002"), provider_id=pid, model_id=mid,
        request_id=rid, org_max_spend_usd=cap,
    )
    from tollms.services.cache.manager import call_sync, get_manager

    raw = call_sync(get_manager().get(limits._org_spend_key(org)))
    assert raw is not None and int(raw) == 2000


def test_org_overshoot_trips_overbudget_flag() -> None:
    org = uuid.uuid4()
    cap = Decimal("0.001")
    ctx = _org_ctx(org)
    pid, mid = uuid.uuid4(), uuid.uuid4()
    rid = f"req-{uuid.uuid4().hex[:8]}"
    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=10,
        estimated_cost=Decimal("0.001"), request_id=rid, org_max_spend_usd=cap,
    ).allowed is True
    # Actuals land over the cap -> flag trips -> next request denied up front.
    limits.record_usage(
        ctx, tokens=500, cost=Decimal("0.005"), provider_id=pid, model_id=mid,
        request_id=rid, org_max_spend_usd=cap,
    )
    denied = _check(ctx, cap)
    assert denied.allowed is False
    assert denied.reason in ("budget", "org_budget")
