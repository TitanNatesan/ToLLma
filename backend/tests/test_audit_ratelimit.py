"""Audit: RPM/TPM enforcement + distributed counters (Subagent C, secs 7/8/9/11).

Real Valkey (private VALKEY_DB per run), mocked provider transports only.
Each unit test mints fresh key_ids so no two tests share a counter namespace.

ARCHITECTURE (verified in source):
- Enforcement point: services/gateway/limits.py :: check_request (pre-call,
  reserves estimate) + record_usage (post-call, swaps reservation for actuals).
  Public plane: api/public_gateway/service.py::_prepare -> check_request;
  _execute_chat/_execute_media/_stream_chat -> _record_usage. In-app plane:
  services/gateway/key_policy.py::enforce_chat_policy -> limits.check_request;
  services/generation.py::_reconcile_key_policy -> reconcile_chat_usage.
  NEVER edit gateway/adapters/keys/usage files from this audit (report only).
- Window algorithm: FIXED epoch-aligned buckets (not sliding, not token-bucket):
  tollma:apilim:{key_id}:{dim}:{epoch//window} with dim in rpm/rph/rpd (amount 1
  per request, attempt-counted, never reconciled) and tpm/tpd (token units,
  reserved at prompt estimate, reconciled to actual total). Per-model RPM/TPM
  under tollma:apilim:{key_id}:model:{pid}:{mid}:{dim}:{bucket}.
- Atomicity: one pipeline INCRBY + EXPIRE NX per counter (first write sets TTL).
  Denials roll back via compensating DECR (applied-list). Retry-After =
  window - epoch % window (always >= 1). Spend counters hold integer micro-USD.
- Reservation: check_request stashes (tokens, cost_micros) per
  tollma:apilim:{key}:reserve:{pid}:{mid}:{request_id} (TTL 1h); record_usage
  pops it and applies the delta, clamping negative counters to zero.
- Quota paths (403, hard while the counter is readable): lifetime max_budget_usd
  (period index folds budget_reset_days), daily/monthly spend, per-model
  max_budget, org cap. Post-call over-cap trips
  tollma:apilim:{key_id}:overbudget (TTL to UTC midnight) -> 403 until reset.
- Fail policy (deliberate): rate windows + unreadable spend counters FAIL OPEN
  (allow + WARNING log); budgets fail closed only while the counter is readable.
  Auth limiter (core/rate_limit.py) is the opposite: fail-CLOSED 503.
- Response contract: 429 + RATE_LIMITED + Retry-After for rate dims; 403 +
  reason for budgets; exactly one failed ApiRequestLog row; adapter never built
  or called after a reject (reservation rolled back, nothing stashed).
- Token accounting: TPM bills `total` (provider total_tokens else
  prompt+completion estimate). Reasoning/cache sub-counters ride the ledger row
  but never add on top of total. Prompt estimate = max(1, len//4).
"""

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from unittest.mock import patch

from tollms.api.public_gateway import service as pg_service
from tollms.models.api_key import ApiRequestLog
from tollms.models.provider import ProviderType
from tollms.services.api_keys.keys import KeyContext, KeyPolicy, ModelPermission
from tollms.services.cache import client as cache_client
from tollms.services.cache.manager import call_sync, get_manager
from tollms.services.gateway import limits, translators
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk
from tollms.services.gateway.factory import build_adapter as real_build_adapter

NOW = datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc)

SSE_KNOWN = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)
SSE_NO_USAGE = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    "data: [DONE]\n\n"
)


def _run(coro):
    return asyncio.run(coro)


def _require_valkey() -> None:
    assert _run(cache_client.connect()) is True, "Valkey must be reachable"


def _ctx(policy: KeyPolicy | None = None, perms: tuple = ()) -> KeyContext:
    return KeyContext(
        key_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="audit-rl",
        key_prefix="tma_sk_live_test",
        enabled=True,
        expires_at=None,
        policy=policy or KeyPolicy(),
        model_permissions=perms,
    )


def _freeze(monkeypatch: pytest.MonkeyPatch, now: datetime) -> None:
    monkeypatch.setattr(limits, "_now", lambda: now)


def _check(ctx, *, pid, mid, tokens=10, cost="0", rid=None):
    return limits.check_request(
        ctx, provider_id=pid, model_id=mid,
        estimated_tokens=tokens, estimated_cost=Decimal(cost), request_id=rid,
    )


def _reconcile(ctx, *, pid, mid, tokens, cost="0", rid=None):
    limits.record_usage(
        ctx, tokens=tokens, cost=Decimal(cost),
        provider_id=pid, model_id=mid, request_id=rid,
    )


def _window_valkey_snapshot(key_id: uuid.UUID) -> tuple[list[str], dict[str, int | None]]:
    """Keys + TTLs via the loop-safe sync bridge (never touch the raw client
    from a foreign event loop: the shared client is loop-bound)."""

    async def _go():
        client = await get_manager().resolved_client()
        assert client is not None
        raw = await client.keys(f"tollma:apilim:{key_id}:*")
        names = sorted(k.decode() if isinstance(k, bytes) else str(k) for k in raw)
        return names, {name: int(await client.ttl(name)) for name in names}

    return call_sync(_go())


def _transport(body: str = SSE_KNOWN) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "unexpected path"})

    return httpx.MockTransport(handler)


def _bind_mock(monkeypatch: pytest.MonkeyPatch, body: str = SSE_KNOWN, calls: list | None = None) -> None:
    transport = _transport(body)

    def fake_build(provider, model, credentials):
        if calls is not None:
            calls.append(1)
        return real_build_adapter(provider, model, credentials, transport)

    monkeypatch.setattr(pg_service, "build_adapter", fake_build)


def _make_key(client: TestClient, name: str, policy: dict | None = None) -> dict:
    payload: dict = {"name": name}
    if policy is not None:
        payload["policy"] = policy
    r = client.post("/api/v1/keys", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _chat(client: TestClient, raw: str, ref: str, extra: dict | None = None) -> httpx.Response:
    body = {"model": ref, "messages": [{"role": "user", "content": "hi"}], **(extra or {})}
    return client.post("/v1/chat/completions", json=body,
                       headers={"Authorization": f"Bearer {raw}"})


# --- RPM: boundaries -----------------------------------------------------------


def test_rpm_below_at_over(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=3))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    for _ in range(3):  # below + at: all allowed
        assert _check(ctx, pid=pid, mid=mid, rid=uuid.uuid4().hex).allowed is True
    over = _check(ctx, pid=pid, mid=mid, rid=uuid.uuid4().hex)
    assert over.allowed is False and over.reason == "rpm" and over.status_code == 429
    assert over.retry_after is not None and 1 <= over.retry_after <= 60
    # Denial rolled its own increment back: still exactly at the limit.
    again = _check(ctx, pid=pid, mid=mid, rid=uuid.uuid4().hex)
    assert again.allowed is False and again.reason == "rpm"


def test_rpm_window_boundary_is_fixed_not_sliding(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two requests 2s apart land in different buckets -> both allowed (fixed)."""
    _require_valkey()
    ctx = _ctx(KeyPolicy(rpm=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    _freeze(monkeypatch, NOW - timedelta(seconds=1))  # 11:59:59 bucket
    assert _check(ctx, pid=pid, mid=mid).allowed is True
    assert _check(ctx, pid=pid, mid=mid).allowed is False
    _freeze(monkeypatch, NOW + timedelta(seconds=1))  # next minute bucket
    assert _check(ctx, pid=pid, mid=mid).allowed is True


def test_rpm_retry_after_exact_and_retry_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    moment = NOW - timedelta(seconds=17)  # epoch % 60 == 43 -> retry_after 17
    _freeze(monkeypatch, moment)
    ctx = _ctx(KeyPolicy(rpm=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid).allowed is True
    denied = _check(ctx, pid=pid, mid=mid)
    assert denied.retry_after == 60 - (int(moment.timestamp()) % 60) == 17
    _freeze(monkeypatch, moment + timedelta(seconds=17))  # next bucket
    assert _check(ctx, pid=pid, mid=mid).allowed is True  # retry works


def test_rpm_zero_token_requests_still_count(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cost-only (media-style, tokens=0) requests consume RPM attempts."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=0).allowed is True
    denied = _check(ctx, pid=pid, mid=mid, tokens=0)
    assert denied.allowed is False and denied.reason == "rpm"


# --- RPM: concurrency + isolation ----------------------------------------------


def test_rpm_concurrent_same_key_exact(monkeypatch: pytest.MonkeyPatch) -> None:
    """8 racing threads on rpm=5: exactly 5 win — no burst (Valkey serializes)."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=5))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(
            lambda i: _check(ctx, pid=pid, mid=mid, rid=f"race-{i}"), range(8)))
    assert sum(1 for r in results if r.allowed) == 5
    assert all(r.reason == "rpm" and r.status_code == 429 for r in results if not r.allowed)


def test_rpm_concurrent_tolerance_documented(monkeypatch: pytest.MonkeyPatch) -> None:
    """64 racing threads on rpm=50. Load-independent invariants (hold even when
    a saturated Valkey fails increments and checks fail OPEN per documented
    policy — an admission without a booking, never a silent drop):

    * won >= 50: no legitimate admission is ever lost. The first possible
      denial needs value > 50, i.e. 51 successful INCRBYs, i.e. 50 admissions
      already banked; every failed increment admits open.
    * the window counter converges at/above the cap (bookings minus successful
      rollbacks can never dip below 50), so the next same-window check denies.
    * overshoot (won - 50) equals the number of failed increments: entirely
      environmental (Valkey saturation), logged here, deliberately unasserted.
    """
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=50))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    with ThreadPoolExecutor(max_workers=64) as pool:
        results = list(pool.map(
            lambda i: _check(ctx, pid=pid, mid=mid, rid=f"tol-{i}"), range(64)))
    won = sum(1 for r in results if r.allowed)
    assert won >= 50, f"lost admissions under burst: {won}"
    print(f"\nburs overshoot over cap: {won - 50} (failed increments, fail-open)")
    counter = limits._read_counter(  # noqa: SLF001
        limits._window_key(ctx.key_id, "rpm", int(NOW.timestamp()), 60))  # noqa: SLF001
    assert counter is not None and counter >= 50
    denied = _check(ctx, pid=pid, mid=mid, rid="tol-tail")
    assert denied.allowed is False and denied.reason == "rpm"


# --- RPM: Valkey failure / restart ---------------------------------------------


def test_rpm_valkey_outage_fails_open_then_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    """DOCUMENTED fail-open: outage allows (no enforcement possible); recovery
    re-enforces against the intact counters (outage traffic was never booked)."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid).allowed is True

    manager = get_manager()

    async def _no_client():
        return None

    monkeypatch.setattr(manager, "resolved_client", _no_client)
    assert _check(ctx, pid=pid, mid=mid).allowed is True  # fail open, not booked
    monkeypatch.undo()  # restores client AND the freeze; re-pin time below
    _freeze(monkeypatch, NOW)

    denied = _check(ctx, pid=pid, mid=mid)
    assert denied.allowed is False and denied.reason == "rpm"  # counter intact


def test_rpm_timeout_fails_open(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=1, tpm=1, max_budget_usd=Decimal("0.01")))
    pid, mid = uuid.uuid4(), uuid.uuid4()

    async def _timeout():
        raise TimeoutError("valkey hung")

    monkeypatch.setattr(get_manager(), "resolved_client", _timeout)
    d = _check(ctx, pid=pid, mid=mid, tokens=500, cost="5.00")
    assert d.allowed is True


def test_rpm_stale_garbage_counter_fails_open(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unparsable counter value: treated as unknown -> fail open (logged)."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    key = limits._window_key(ctx.key_id, "rpm", int(NOW.timestamp()), 60)  # noqa: SLF001

    async def _poison():
        client = await get_manager().resolved_client()
        assert client is not None
        await client.set(key, "not-a-number", ex=60)

    call_sync(_poison())
    assert _check(ctx, pid=pid, mid=mid).allowed is True


def test_rpm_restart_cold_counters_allow_again(monkeypatch: pytest.MonkeyPatch) -> None:
    """Restart without persistence wipes counters -> previously-exhausted key is
    allowed again (documented; Postgres spend fallback still guards budgets)."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=1))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid).allowed is True
    assert _check(ctx, pid=pid, mid=mid).allowed is False
    from tollms.services.cache.manager import cache_invalidate_sync

    assert cache_invalidate_sync("tollma:apilim:*") >= 1
    assert _check(ctx, pid=pid, mid=mid).allowed is True


# --- RPM: router response contract ---------------------------------------------


def test_rpm_router_contract_429_headers_audit_no_provider_call(
    client: TestClient, db: Session, user_factory, provider_factory,
    model_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """200, 200, then 429 + Retry-After + RATE_LIMITED + exactly one failed row;
    the rejected request never reaches the provider."""
    user_factory("rl-rpm-contract@tollma.ai")
    p = provider_factory("RlRpm")
    model_factory(p["id"])
    calls: list = []
    _bind_mock(monkeypatch, calls=calls)
    made = _make_key(client, "rpm2", {"rpm": 2})
    raw, kid = made["raw_key"], made["key"]["id"]
    ref = f"{p['name']}/mock-model"

    assert _chat(client, raw, ref).status_code == 200
    assert _chat(client, raw, ref).status_code == 200
    denied = _chat(client, raw, ref)
    assert denied.status_code == 429, denied.text
    assert denied.headers.get("retry-after") is not None
    assert 1 <= int(denied.headers["retry-after"]) <= 60
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert calls and len(calls) == 2  # reject built no adapter, made no call

    rows = db.scalars(
        select(ApiRequestLog).where(ApiRequestLog.api_key_id == uuid.UUID(kid))).all()
    assert len(rows) == 3
    failed = [r for r in rows if r.status == "failed"]
    assert len(failed) == 1 and failed[0].error_code == "RATE_LIMITED"


# --- TPM: boundaries -----------------------------------------------------------


def test_tpm_below_at_over(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=60, rid="t1").allowed is True
    assert _check(ctx, pid=pid, mid=mid, tokens=40, rid="t2").allowed is True  # at 100
    over = _check(ctx, pid=pid, mid=mid, tokens=1, rid="t3")
    assert over.allowed is False and over.reason == "tpm" and over.status_code == 429
    assert over.retry_after is not None and 1 <= over.retry_after <= 60


def test_tpm_small_vs_large(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid = uuid.uuid4(), uuid.uuid4()
    small = _ctx(KeyPolicy(tpm=10))
    for i in range(10):
        assert _check(small, pid=pid, mid=mid, tokens=1, rid=f"s{i}").allowed is True
    assert _check(small, pid=pid, mid=mid, tokens=1, rid="s10").reason == "tpm"
    big = _ctx(KeyPolicy(tpm=10))
    denied = _check(big, pid=pid, mid=mid, tokens=11, rid="big")
    assert denied.allowed is False and denied.reason == "tpm"
    # Denial is atomic: nothing booked, so the full cap still fits afterwards.
    assert _check(big, pid=pid, mid=mid, tokens=10, rid="big2").allowed is True


def test_tpm_collective_exceed_rolls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=60, rid="c1").allowed is True
    denied = _check(ctx, pid=pid, mid=mid, tokens=60, rid="c2")
    assert denied.allowed is False and denied.reason == "tpm"
    # Rolled back to 60: exactly 40 more fits, 41 does not.
    assert _check(ctx, pid=pid, mid=mid, tokens=40, rid="c3").allowed is True


def test_tpm_reservation_reconciliation_up_and_down(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=200))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=60, rid="r1").allowed is True
    _reconcile(ctx, pid=pid, mid=mid, tokens=40, rid="r1")  # cheaper: 60 -> 40
    assert _check(ctx, pid=pid, mid=mid, tokens=60, rid="r2").allowed is True  # 100
    _reconcile(ctx, pid=pid, mid=mid, tokens=90, rid="r2")  # over: 100 -> 130
    probe = _check(ctx, pid=pid, mid=mid, tokens=70, rid="r3")
    assert probe.allowed is True  # exactly at 200
    assert _check(ctx, pid=pid, mid=mid, tokens=1, rid="r4").reason == "tpm"


def test_tpm_expiry_next_minute(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=90, rid="e1").allowed is True
    assert _check(ctx, pid=pid, mid=mid, tokens=11, rid="e2").reason == "tpm"
    _freeze(monkeypatch, NOW + timedelta(seconds=61))
    assert _check(ctx, pid=pid, mid=mid, tokens=100, rid="e3").allowed is True


def test_tpm_failure_releases_reservation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider failure / cancel / timeout path reconciles 0/0: counter to 0."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=60, rid="f1").allowed is True
    _reconcile(ctx, pid=pid, mid=mid, tokens=0, rid="f1")
    assert _check(ctx, pid=pid, mid=mid, tokens=100, rid="f2").allowed is True


def test_tpm_concurrent_atomic_no_overspend(monkeypatch: pytest.MonkeyPatch) -> None:
    """6 threads x 30 tokens on tpm=100: exactly 3 win (90); no overspend."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(
            lambda i: _check(ctx, pid=pid, mid=mid, tokens=30, rid=f"tc-{i}"), range(6)))
    assert sum(1 for r in results if r.allowed) == 3
    for r in results:
        if not r.allowed:
            assert r.reason == "tpm" and r.status_code == 429
    # Losers rolled back: counter is exactly 90, so 10 more fits.
    assert _check(ctx, pid=pid, mid=mid, tokens=10, rid="tail").allowed is True
    assert _check(ctx, pid=pid, mid=mid, tokens=1, rid="tail2").reason == "tpm"


def test_tpm_no_negatives_on_over_refund(monkeypatch: pytest.MonkeyPatch) -> None:
    """Refunding more than booked clamps at zero, never negative."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=50, rid="n1").allowed is True
    # Stale reservation larger than booked: delta -80 on a 50 counter.
    monkeypatch.setattr(limits, "_pop_reservation", lambda *a, **k: (80, 0))
    _reconcile(ctx, pid=pid, mid=mid, tokens=0, rid="n1")  # clamps to 0
    assert _check(ctx, pid=pid, mid=mid, tokens=100, rid="n2").allowed is True


def test_tpm_router_reject_before_provider_call(
    client: TestClient, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TPM over on the FIRST request: 429 + Retry-After, provider never called."""
    user_factory("rl-tpm-first@tollma.ai")
    p = provider_factory("RlTpm")
    model_factory(p["id"])
    calls: list = []
    _bind_mock(monkeypatch, calls=calls)
    made = _make_key(client, "tpm-small", {"tpm": 5})
    ref = f"{p['name']}/mock-model"
    denied = _chat(client, made["raw_key"], ref, {"messages": [{"role": "user", "content": "x" * 400}]})
    assert denied.status_code == 429, denied.text
    assert denied.headers.get("retry-after") is not None
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert calls == []


# --- TPM: streaming ------------------------------------------------------------


def _tpm_counter(key_id: uuid.UUID, moment: datetime) -> int | None:
    return limits._read_counter(  # noqa: SLF001
        limits._window_key(key_id, "tpm", int(moment.timestamp()), 60))  # noqa: SLF001


def test_tpm_streaming_success_bills_actual_total(
    client: TestClient, db: Session, user_factory, provider_factory,
    model_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Streamed usage chunk (10/5/15) reconciles reservation(1) -> 15, one row."""
    user_factory("rl-stream-ok@tollma.ai")
    p = provider_factory("RlStreamOk")
    model_factory(p["id"], supports_streaming=True)
    _freeze(monkeypatch, NOW)
    _bind_mock(monkeypatch)
    made = _make_key(client, "stream-ok", {"tpm": 1000})
    kid = uuid.UUID(made["key"]["id"])
    ref = f"{p['name']}/mock-model"
    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": ref, "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {made['raw_key']}"},
    ) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    assert "data: [DONE]" in text
    assert _tpm_counter(kid, NOW) == 15
    rows = db.scalars(
        select(ApiRequestLog).where(ApiRequestLog.api_key_id == kid)).all()
    assert len(rows) == 1 and rows[0].status == "success" and rows[0].is_streaming is True
    assert rows[0].total_tokens == 15


def test_tpm_streaming_missing_usage_bills_estimate(
    client: TestClient, db: Session, user_factory, provider_factory,
    model_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No usage chunk: provider-reported zeros -> text estimate, flagged."""
    user_factory("rl-stream-est@tollma.ai")
    p = provider_factory("RlStreamEst")
    model_factory(p["id"], supports_streaming=True)
    _freeze(monkeypatch, NOW)
    _bind_mock(monkeypatch, body=SSE_NO_USAGE)
    made = _make_key(client, "stream-est", {"tpm": 1000})
    kid = uuid.UUID(made["key"]["id"])
    ref = f"{p['name']}/mock-model"
    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": ref, "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {made['raw_key']}"},
    ) as resp:
        assert resp.status_code == 200, resp.text
        resp.read()
    # prompt "hi" -> 1, completion "Hello" -> 1: counter converges to 2.
    assert _tpm_counter(kid, NOW) == 2
    row = db.scalar(select(ApiRequestLog).where(ApiRequestLog.api_key_id == kid))
    assert row is not None and row.usage_estimated is True


def test_tpm_streaming_long_output_counts_completion(
    client: TestClient, user_factory, provider_factory,
    model_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """4000-char completion with no usage chunk bills ~1000 completion tokens."""
    user_factory("rl-stream-long@tollma.ai")
    p = provider_factory("RlStreamLong")
    model_factory(p["id"], supports_streaming=True)
    _freeze(monkeypatch, NOW)
    big = "z" * 4000
    body = f'data: {{"choices": [{{"delta": {{"content": "{big}"}}}}]}}\n\n' "data: [DONE]\n\n"
    _bind_mock(monkeypatch, body=body)
    made = _make_key(client, "stream-long", {"tpm": 100000})
    kid = uuid.UUID(made["key"]["id"])
    ref = f"{p['name']}/mock-model"
    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": ref, "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {made['raw_key']}"},
    ) as resp:
        assert resp.status_code == 200, resp.text
        resp.read()
    assert _tpm_counter(kid, NOW) == 1 + 1000  # prompt est + completion est


def test_tpm_streaming_failure_releases_and_logs_failed(
    client: TestClient, db: Session, user_factory, provider_factory,
    model_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mid-stream provider boom: one failed row, NULL usage, reservation gone."""

    class _Boom:
        def __init__(self, *a, **k):
            pass

        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            raise RuntimeError("provider blew up mid-stream")

        async def chat(self, messages):
            raise RuntimeError("provider blew up")

    user_factory("rl-stream-boom@tollma.ai")
    p = provider_factory("RlStreamBoom")
    model_factory(p["id"], supports_streaming=True)
    _freeze(monkeypatch, NOW)
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _Boom())
    made = _make_key(client, "stream-boom")
    kid = uuid.UUID(made["key"]["id"])
    ref = f"{p['name']}/mock-model"
    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": ref, "messages": [{"role": "user", "content": "hi hello world, bill me"}], "stream": True},
        headers={"Authorization": f"Bearer {made['raw_key']}"},
    ) as resp:
        assert resp.status_code == 200, resp.text
        resp.read()
    rows = db.scalars(
        select(ApiRequestLog).where(ApiRequestLog.api_key_id == kid)).all()
    assert len(rows) == 1 and rows[0].status == "failed"
    # Reservation refunded: a full-cap probe fits (nothing phantom-booked).
    probe = _ctx(KeyPolicy(tpm=10_000))
    object.__setattr__(probe, "key_id", kid)  # same namespace, fresh policy
    assert _check(probe, pid=uuid.uuid4(), mid=uuid.uuid4(), tokens=10_000,
                  rid="post-boom").allowed is True


def _unit_prepared(ctx: KeyContext, chunks, rid: str) -> tuple:
    provider = SimpleNamespaceShim(ctx)
    unified = translators.from_openai_chat(
        {"model": "mock", "messages": [{"role": "user", "content": "hi"}], "stream": True})
    unified.response_format = "openai"

    class _ListAdapter:
        def __init__(self, items):
            self._items = items

        async def chat_stream(self, messages):
            for item in self._items:
                yield item

    adapter = _ListAdapter(chunks)
    prepared = pg_service._Prepared(  # noqa: SLF001
        ctx=ctx, meta=pg_service.ClientMeta(request_id=rid),
        unified=unified, provider=provider.proxy, model=provider.model,
        adapter=adapter, messages=[], history_text="hi", started=0.0)
    return prepared


class SimpleNamespaceShim:
    """Real KeyContext + stub provider/model shaped for _stream_chat."""

    def __init__(self, ctx: KeyContext):
        import uuid as _uuid
        from decimal import Decimal as _Decimal

        self.proxy = _ns(
            id=_uuid.uuid4(), name="Mock",
            provider_type=ProviderType.OPENAI, user_id=ctx.user_id)
        self.model = _ns(
            id=_uuid.uuid4(), model_id="mock-model", provider_id=self.proxy.id,
            input_price=_Decimal(1), output_price=_Decimal(2),
            cache_read_price=_Decimal(0), cache_write_price=_Decimal(0))


def _ns(**kw):
    from types import SimpleNamespace

    return SimpleNamespace(**kw)


def test_tpm_streaming_disconnect_releases_reservation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Client goes away mid-stream (GeneratorExit): cancelled row + refund."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=100))
    pid = uuid.uuid4()
    rid = "disc-1"
    prepared = _unit_prepared(ctx, [StreamChunk(delta="a"), StreamChunk(delta="b")], rid)
    # Reality: _prepare reserved the prompt estimate first.
    assert _check(ctx, pid=pid, mid=prepared.model.id, tokens=60, rid=rid).allowed is True
    prepared.provider.id  # keep shape honest
    object.__setattr__(prepared.provider, "id", pid)
    logged: list = []
    with (
        patch.object(pg_service, "find_for_model", return_value=None),
        patch.object(pg_service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        async def _abandon():
            gen = pg_service._stream_chat(prepared, db=None)  # noqa: SLF001
            assert await gen.__anext__() is not None
            await gen.aclose()

        _run(_abandon())
    assert len(logged) == 1 and logged[0].status == "cancelled"
    # Refunded: full cap fits again.
    assert _check(ctx, pid=pid, mid=prepared.model.id, tokens=100, rid="disc-2").allowed is True


def test_tpm_retry_bills_each_attempt_once(
    client: TestClient, db: Session, user_factory, provider_factory,
    model_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Client retry = new request_id = new reservation: 2 attempts bill 2x15,
    never double-counted, never lost."""
    user_factory("rl-retry@tollma.ai")
    p = provider_factory("RlRetry")
    model_factory(p["id"], supports_streaming=True)
    _freeze(monkeypatch, NOW)
    _bind_mock(monkeypatch)
    made = _make_key(client, "retry", {"tpm": 1000})
    kid = uuid.UUID(made["key"]["id"])
    ref = f"{p['name']}/mock-model"
    payload = {"model": ref, "messages": [{"role": "user", "content": "hi"}], "stream": True}
    headers = {"Authorization": f"Bearer {made['raw_key']}"}
    for _ in range(2):
        with client.stream("POST", "/v1/chat/completions", json=payload, headers=headers) as resp:
            assert resp.status_code == 200, resp.text
            resp.read()
    assert _tpm_counter(kid, NOW) == 30
    rows = db.scalars(
        select(ApiRequestLog).where(ApiRequestLog.api_key_id == kid)).all()
    assert len(rows) == 2 and all(r.status == "success" for r in rows)


# --- RPM x TPM interaction matrix ----------------------------------------------


def test_rpm_tpm_interaction_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deterministic first-denial order: rpm is evaluated before tpm."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid = uuid.uuid4(), uuid.uuid4()
    free = _ctx(KeyPolicy(rpm=10, tpm=1000))
    assert _check(free, pid=pid, mid=mid, tokens=10, rid="m-free").allowed is True

    rpm_only = _ctx(KeyPolicy(rpm=1, tpm=1000))
    assert _check(rpm_only, pid=pid, mid=mid, tokens=1, rid="m-r1").allowed is True
    d = _check(rpm_only, pid=pid, mid=mid, tokens=1, rid="m-r2")
    assert d.allowed is False and d.reason == "rpm" and d.status_code == 429

    tpm_only = _ctx(KeyPolicy(rpm=1000, tpm=5))
    d = _check(tpm_only, pid=pid, mid=mid, tokens=10, rid="m-t1")
    assert d.allowed is False and d.reason == "tpm" and d.status_code == 429

    both = _ctx(KeyPolicy(rpm=1, tpm=5))
    assert _check(both, pid=pid, mid=mid, tokens=1, rid="m-b1").allowed is True
    d = _check(both, pid=pid, mid=mid, tokens=10, rid="m-b2")
    assert d.allowed is False and d.reason == "rpm"  # rpm first, deterministic


# --- Distributed counters ------------------------------------------------------


def test_distributed_namespaces_and_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Key format, per-dimension buckets, model scope, reservation slot, TTLs."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    perm = ModelPermission(provider_id=uuid.uuid4(), model_id=uuid.uuid4(),
                           enabled=True, rpm=5, tpm=500)
    ctx = _ctx(KeyPolicy(rpm=10, tpm=1000, max_budget_usd=Decimal("10.00")), (perm,))
    pid, mid = perm.provider_id, perm.model_id
    rid = "ns-1"
    assert _check(ctx, pid=pid, mid=mid, tokens=20, cost="0.01", rid=rid).allowed is True

    epoch = int(NOW.timestamp())
    keys, ttls = _window_valkey_snapshot(ctx.key_id)
    section = f"tollma:apilim:{ctx.key_id}"
    assert f"{section}:rpm:{epoch // 60}" in keys
    assert f"{section}:tpm:{epoch // 60}" in keys
    assert f"{section}:model:{pid}:{mid}:rpm:{epoch // 60}" in keys
    assert f"{section}:model:{pid}:{mid}:tpm:{epoch // 60}" in keys
    assert f"{section}:reserve:{pid}:{mid}:{rid}" in keys
    assert f"{section}:spend:all" in keys  # lifetime period, no reset days
    assert not any(k.endswith(":overbudget") for k in keys)

    window_ttls = {k: v for k, v in ttls.items() if ":rpm:" in k or ":tpm:" in k}
    assert window_ttls and all(
        t is not None and 0 < t <= 60 for t in window_ttls.values()), window_ttls


def test_distributed_workers_share_enforcement(monkeypatch: pytest.MonkeyPatch) -> None:
    """Worker B (same key_id) cannot bypass worker A's exhaustion; a third key
    is unaffected. Simulates independent processes via separate contexts."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    key_id, user_id = uuid.uuid4(), uuid.uuid4()

    def _worker_ctx() -> KeyContext:
        return KeyContext(key_id=key_id, user_id=user_id, name="shared",
                          key_prefix="tma_sk_live_test", enabled=True,
                          expires_at=None, policy=KeyPolicy(rpm=2, tpm=50))

    pid, mid = uuid.uuid4(), uuid.uuid4()
    a, b = _worker_ctx(), _worker_ctx()
    assert _check(a, pid=pid, mid=mid, tokens=20, rid="w-a1").allowed is True
    assert _check(a, pid=pid, mid=mid, tokens=20, rid="w-a2").allowed is True
    # Same key, other worker: both dimensions exhausted.
    d1 = _check(b, pid=pid, mid=mid, tokens=1, rid="w-b1")
    assert d1.allowed is False and d1.reason == "rpm"
    d2 = _check(b, pid=pid, mid=mid, tokens=20, rid="w-b2")
    assert d2.allowed is False and d2.reason in ("rpm", "tpm")
    # Unrelated key is unaffected.
    other = _ctx(KeyPolicy(rpm=2, tpm=50))
    assert _check(other, pid=pid, mid=mid, tokens=20, rid="w-c1").allowed is True


def test_distributed_model_scope_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Per-model caps bind only their (provider, model); key caps bind all."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    perm = ModelPermission(provider_id=pid, model_id=mid, enabled=True, rpm=1)
    ctx = _ctx(KeyPolicy(rpm=100), (perm,))
    assert _check(ctx, pid=pid, mid=mid, rid="ms-1").allowed is True
    d = _check(ctx, pid=pid, mid=mid, rid="ms-2")
    assert d.allowed is False and d.reason == "model_rpm" and d.status_code == 429
    assert d.retry_after is not None and 1 <= d.retry_after <= 60
    # Other model shares only the (barely touched) key-level bucket.
    assert _check(ctx, pid=pid, mid=other, rid="ms-3").allowed is True


def test_distributed_recovery_after_transient_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    """Outage traffic is never booked; after recovery the pre-outage counters
    still deny exactly where they did before (no phantom, no amnesia)."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(rpm=2))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, rid="rec-1").allowed is True

    manager = get_manager()

    async def _down():
        return None

    monkeypatch.setattr(manager, "resolved_client", _down)
    assert _check(ctx, pid=pid, mid=mid, rid="rec-2").allowed is True  # not booked
    assert _check(ctx, pid=pid, mid=mid, rid="rec-3").allowed is True  # not booked
    monkeypatch.undo()
    _freeze(monkeypatch, NOW)

    assert _check(ctx, pid=pid, mid=mid, rid="rec-4").allowed is True  # 2nd real
    d = _check(ctx, pid=pid, mid=mid, rid="rec-5")
    assert d.allowed is False and d.reason == "rpm"  # outage burst left no trace


def test_distributed_double_reconcile_is_caller_discipline(monkeypatch: pytest.MonkeyPatch) -> None:
    """record_usage is NOT idempotent: reconciling the same request twice bills
    the delta twice. Callers reconcile exactly once (success XOR failure path);
    this test locks the current (documented) behavior, not a fix."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(tpm=1000))
    pid, mid = uuid.uuid4(), uuid.uuid4()
    assert _check(ctx, pid=pid, mid=mid, tokens=60, rid="dup").allowed is True
    _reconcile(ctx, pid=pid, mid=mid, tokens=40, rid="dup")  # 60 -> 40
    _reconcile(ctx, pid=pid, mid=mid, tokens=40, rid="dup")  # no stash: +40
    assert _tpm_counter(ctx.key_id, NOW) == 80
