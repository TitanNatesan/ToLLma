"""Unified key-policy enforcement: one gate for chat + public traffic.

`services/gateway/key_policy.py` is the single enforcement point both planes
share (in-app chat `api/gateway` + public `/v1` gateway). These tests lock
that contract end to end with mocked upstream providers only (fake adapters /
SSE transports — never live spend):

* Policy matrix (expiration, RPM/RPH/RPD, TPM/TPD, daily/monthly/total budget,
  IP allow/deny incl. deny-wins + unparseable fail-closed, model allow-list
  incl. alias/casing/endpoint-change attempts): allowed, boundary, exceeded,
  denied-before-dispatch (upstream never called), correct status/body, audit.
* Postgres spend fallback: stored spend denies even when Valkey reads zero.
* Concurrency: simultaneous requests cannot overspend a hard budget
  (reservation atomicity); fail/cancel releases the reservation.
* Endpoint compat (mock transports): Chat Completions / Responses / Anthropic
  Messages, streaming + non-streaming — shape preserved, termination correct,
  usage recorded, cancel propagates, upstream errors mapped.
* Regression: personal/org keys work, cross-owner 404, org isolation, history
  survives key/provider delete, adapters intact, trusted-proxy IP extraction.
* Ledger agreement: listing vs detail status parity, last_used stamps,
  per-key analytics reconciliation, denied traffic bills nothing and leaves
  exactly one failed audit row (no double count).
"""

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as chat_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.public_gateway import service as pg_service
from tollms.core.exceptions import ForbiddenError, NotFoundError, TooManyRequestsError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.request_log import RequestLog, RequestStatus
from tollms.services import gateway as _gateway_pkg  # noqa: F401 (ensures engines import)
from tollms.services.api_keys import keys as key_engine
from tollms.services.api_keys.keys import KeyContext, KeyPolicy
from tollms.services.cache import client as cache_client
from tollms.services.cache.manager import cache_get_sync
from tollms.services.gateway import key_policy, limits
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk

NOW = datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.run(coro)


def _require_valkey() -> None:
    assert _run(cache_client.connect()) is True, "Valkey must be reachable"


def _freeze(monkeypatch: pytest.MonkeyPatch, now: datetime) -> None:
    monkeypatch.setattr(limits, "_now", lambda: now)


# --- fakes (mock upstream only; spend accounting stays real) ------------------


class _FakePublicAdapter:
    """Public-gateway upstream double: replays fixed usage, records calls."""

    def __init__(self, calls: list, error: Exception | None = None) -> None:
        self._calls = calls
        self._error = error

    async def chat(self, messages):
        self._calls.append(("chat", list(messages)))
        if self._error is not None:
            raise self._error
        return ChatResult(text="Hello world", prompt_tokens=10, completion_tokens=5, total_tokens=15)

    async def chat_stream(self, messages):
        self._calls.append(("stream", list(messages)))
        if self._error is not None:
            yield StreamChunk(delta="partial")
            raise self._error
        yield StreamChunk(delta="Hello")
        yield StreamChunk(
            delta=" world", prompt_tokens=10, completion_tokens=5, total_tokens=15
        )


class _FakeChatAdapter:
    """In-app gateway upstream double: SSE-shaped usage, records calls."""

    def __init__(self, calls: list, error: Exception | None = None) -> None:
        self._calls = calls
        self._error = error

    async def chat_stream(self, messages):
        self._calls.append(("stream", list(messages)))
        if self._error is not None:
            raise self._error
        yield StreamChunk(delta="Hello")
        yield StreamChunk(
            delta=" world", prompt_tokens=10, completion_tokens=5, total_tokens=15
        )

    async def chat(self, messages):
        self._calls.append(("chat", list(messages)))
        if self._error is not None:
            raise self._error
        return ChatResult(text="Hello world", prompt_tokens=10, completion_tokens=5, total_tokens=15)


def _bind_public(monkeypatch: pytest.MonkeyPatch, adapter: _FakePublicAdapter) -> list:
    calls: list = adapter._calls  # noqa: SLF001
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: adapter)
    return calls


def _bind_chat(monkeypatch: pytest.MonkeyPatch, adapter: _FakeChatAdapter) -> list:
    calls: list = adapter._calls  # noqa: SLF001
    monkeypatch.setattr(chat_service, "build_adapter", lambda *a, **k: adapter)
    return calls


# --- key / request helpers ----------------------------------------------------


def _make_key(client: TestClient, **overrides) -> tuple[str, str]:
    payload = {"name": "Policy key", **overrides}
    r = client.post("/api/v1/keys", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    return body["raw_key"], body["key"]["id"]


def _auth(raw: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw}"}


def _ref(provider: dict, model_id: str = "mock-model") -> str:
    return f"{provider['name']}/{model_id}"


def _set_policy(client: TestClient, kid: str, payload: dict) -> None:
    r = client.put(f"/api/v1/keys/{kid}/policy", json=payload)
    assert r.status_code == 200, r.text


def _set_ip_rules(client: TestClient, kid: str, rules: list[dict]) -> None:
    r = client.put(f"/api/v1/keys/{kid}/ip-rules", json=rules)
    assert r.status_code == 200, r.text


def _set_model_perms(client: TestClient, kid: str, perms: list[dict]) -> None:
    r = client.put(f"/api/v1/keys/{kid}/model-permissions", json=perms)
    assert r.status_code == 200, r.text


def _expire_key(db: Session, raw: str, kid: str) -> None:
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(ApiKey.__table__.update().where(ApiKey.id == uuid.UUID(kid)).values(expires_at=past))
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))


def _pg_rows(db: Session, kid: str):
    return list(
        db.scalars(select(ApiRequestLog).where(ApiRequestLog.api_key_id == uuid.UUID(kid)))
    )


def _chat_rows(db: Session, kid: str):
    return list(
        db.scalars(select(RequestLog).where(RequestLog.api_key_id == uuid.UUID(kid)))
    )


def _chat_req(pid: str, mid: str, kid: str, **kw) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(pid), model_id=uuid.UUID(mid), message="hi",
        key_id=uuid.UUID(kid), **kw,
    )


def _ctx(policy: KeyPolicy | None = None) -> KeyContext:
    return KeyContext(
        key_id=uuid.uuid4(), user_id=uuid.uuid4(), name="policy-test",
        key_prefix="tma_sk_live_test", enabled=True, expires_at=None,
        policy=policy or KeyPolicy(), model_permissions=(),
    )


# --- expiration: denied before dispatch, oracle preserved ---------------------


def test_expiration_chat_denied_before_dispatch(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("ExpP")
    m = model_factory(p["id"])
    raw, kid = _make_key(client)
    calls = _bind_chat(monkeypatch, _FakeChatAdapter([]))

    # Allowed while live (baseline: reservation + success path works).
    ok = _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    assert ok.content == "Hello world"
    assert len(calls) == 1

    _expire_key(db, raw, kid)
    with pytest.raises(NotFoundError, match="api key not found"):
        _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    # No new provider I/O, no new billable rows after expiry.
    assert len(calls) == 1
    assert len(_chat_rows(db, kid)) == 1

    r = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": kid})
    assert r.status_code == 404, r.text
    assert r.json()["error"]["message"] == "api key not found"
    assert len(_chat_rows(db, kid)) == 1


def test_expiration_public_denied_with_single_failed_row(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    p = provider_factory("ExpPub")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _make_key(client)

    ok = client.post("/v1/chat/completions",
                     json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                     headers=_auth(raw))
    assert ok.status_code == 200, ok.text
    assert len(_pg_rows(db, kid)) == 1

    _expire_key(db, raw, kid)
    denied = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    body = denied.json()["error"]
    assert body["code"] == "FORBIDDEN" and "expired" in body["message"]
    # Auth-layer denies never reach _prepare: no new audit row at all.
    assert len(_pg_rows(db, kid)) == 1


# --- rates: allowed / boundary / exceeded + status/body/audit ----------------

@pytest.mark.parametrize("dim", ["rpm", "rph", "rpd"])
def test_rate_windows_matrix(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, dim: str,
) -> None:
    _require_valkey()
    user_factory()
    p = provider_factory(f"Rate{dim}")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _make_key(client)
    _set_policy(client, kid, {dim: 1})

    first = client.post("/v1/chat/completions",
                        json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                        headers=_auth(raw))
    assert first.status_code == 200, first.text

    second = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert second.status_code == 429, second.text
    err = second.json()["error"]
    assert err["code"] == "RATE_LIMITED" and err["message"] == dim
    assert second.headers.get("retry-after") is not None

    rows = _pg_rows(db, kid)
    assert len(rows) == 2
    failed = [r for r in rows if r.status == "failed"]
    assert len(failed) == 1  # exactly one audit row, no double count
    assert failed[0].cost is None and failed[0].total_tokens is None  # bills nothing
    assert failed[0].error_code == "RATE_LIMITED"


@pytest.mark.parametrize("dim,cap", [("tpm", 1), ("tpd", 1)])
def test_token_windows_matrix(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, dim: str, cap: int,
) -> None:
    _require_valkey()
    user_factory()
    p = provider_factory(f"Tok{dim}")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _make_key(client)
    _set_policy(client, kid, {dim: cap})

    # "hi" estimates to exactly 1 token: at-cap is allowed, the next trips.
    assert client.post("/v1/chat/completions",
                       json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                       headers=_auth(raw)).status_code == 200
    denied = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["message"] == dim
    assert denied.headers.get("retry-after") is not None
    rows = _pg_rows(db, kid)
    assert len([r for r in rows if r.status == "failed"]) == 1
    assert [r for r in rows if r.status == "failed"][0].total_tokens is None


def test_rate_boundary_exact_then_one_over(monkeypatch: pytest.MonkeyPatch) -> None:
    """Boundary arithmetic at the engine level: at-cap allowed, +1 trips."""
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid = uuid.uuid4(), uuid.uuid4()

    def _check(ctx, **kw):
        return limits.check_request(ctx, provider_id=pid, model_id=mid,
                                    estimated_tokens=kw.get("tokens", 0),
                                    estimated_cost=Decimal(kw.get("cost", "0")))

    rpm = _ctx(KeyPolicy(rpm=2))
    assert _check(rpm).allowed is True
    assert _check(rpm).allowed is True
    denied = _check(rpm)
    assert denied.allowed is False and denied.reason == "rpm"
    assert denied.status_code == 429 and denied.retry_after is not None

    tpm = _ctx(KeyPolicy(tpm=2))
    assert _check(tpm, tokens=2).allowed is True
    denied = _check(tpm, tokens=1)
    assert denied.allowed is False and denied.reason == "tpm" and denied.status_code == 429


# --- budgets: total/daily/monthly + boundary ---------------------------------

@pytest.mark.parametrize(
    "policy_key,reason",
    [("max_budget_usd", "budget"), ("daily_spend_limit", "daily_spend"),
     ("monthly_spend_limit", "monthly_spend")],
)
def test_budget_matrix_public(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch, policy_key: str, reason: str,
) -> None:
    _require_valkey()
    user_factory()
    p = provider_factory(f"Bud{reason}")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _make_key(client)

    # Allowed while uncapped.
    assert client.post("/v1/chat/completions",
                       json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                       headers=_auth(raw)).status_code == 200

    # One micro-dollar cap: the ~3-micro estimate no longer fits.
    _set_policy(client, kid, {policy_key: "0.000001"})
    denied = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    err = denied.json()["error"]
    assert err["code"] == "FORBIDDEN" and err["message"] == reason
    if reason in ("daily_spend", "monthly_spend"):
        # Dated caps tell the caller when the window resets.
        assert denied.headers.get("retry-after") is not None
    else:
        assert "retry-after" not in {k.lower() for k in denied.headers}

    rows = _pg_rows(db, kid)
    assert len([r for r in rows if r.status == "failed"]) == 1
    failed = next(r for r in rows if r.status == "failed")
    assert failed.cost is None and failed.total_tokens is None


def test_budget_boundary_exact_cap_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    pid, mid = uuid.uuid4(), uuid.uuid4()
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("1.00")))
    assert limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=0,
        estimated_cost=Decimal("1.00")).allowed is True
    denied = limits.check_request(
        ctx, provider_id=pid, model_id=mid, estimated_tokens=0,
        estimated_cost=Decimal("0.000001"))
    assert denied.allowed is False and denied.reason == "budget"
    assert denied.status_code == 403


def test_chat_total_budget_denied_before_dispatch(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Chat enforces the total budget pre-dispatch: no rows, no provider I/O."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("ChatBud")
    m = model_factory(p["id"])
    raw, kid = _make_key(client)
    calls = _bind_chat(monkeypatch, _FakeChatAdapter([]))
    _set_policy(client, kid, {"max_budget_usd": "0.000001"})

    with pytest.raises(ForbiddenError, match="budget"):
        _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    assert calls == []
    assert _chat_rows(db, kid) == []

    r = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": kid})
    assert r.status_code == 403, r.text
    assert "budget" in r.json()["error"]["message"]
    assert _chat_rows(db, kid) == []


# --- Postgres spend fallback: stored spend denies when Valkey reads zero -----

def test_postgres_fallback_denies_exhausted_key(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Chat never wrote Valkey historically: Postgres SUMs deny first."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("PgFall")
    m = model_factory(p["id"])
    raw, kid = _make_key(client)
    calls = _bind_chat(monkeypatch, _FakeChatAdapter([]))
    _set_policy(client, kid, {"max_budget_usd": "0.05"})

    before = key_policy.postgres_spend(db, uuid.UUID(kid))
    assert before == Decimal(0)

    # Stored spend over the cap across BOTH ledgers (Valkey still empty).
    db.add(ApiRequestLog(
        request_id=f"pg-{uuid.uuid4().hex[:8]}", api_key_id=uuid.UUID(kid),
        user_id=uid, provider="custom", model="mock-model",
        endpoint="/v1/chat/completions", status="success",
        cost=Decimal("0.04"), total_tokens=100))
    db.add(RequestLog(
        user_id=uid, api_key_id=uuid.UUID(kid), total_tokens=50,
        total_cost=Decimal("0.02"), status=RequestStatus.SUCCESS.value))
    db.commit()
    assert key_policy.postgres_spend(db, uuid.UUID(kid)) == Decimal("0.06")

    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None
    assert limits.current_spend(ctx) == Decimal(0)  # Valkey knows nothing

    with pytest.raises(ForbiddenError, match="budget"):
        _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    assert calls == []  # denied before dispatch
    assert _chat_rows(db, kid) == [r for r in _chat_rows(db, kid)
                                   if r.total_cost == Decimal("0.02")]  # seed only, no new row


def test_postgres_fallback_sums_both_ledgers_with_window(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    key = db.scalar(select(ApiKey).where(ApiKey.user_id == uuid.UUID(user["id"])).limit(1))
    assert key is not None
    now = datetime.now(timezone.utc)
    db.add(ApiRequestLog(
        request_id=f"w-{uuid.uuid4().hex[:8]}", api_key_id=key.id, user_id=uid,
        provider="openai", model="gpt-4o", endpoint="/v1/chat/completions",
        status="success", cost=Decimal("0.02"), total_tokens=10,
        created_at=now - timedelta(hours=1)))
    db.add(RequestLog(
        user_id=uid, api_key_id=key.id, total_tokens=20,
        total_cost=Decimal("0.03"), status=RequestStatus.SUCCESS.value,
        created_at=now - timedelta(hours=1)))
    db.add(ApiRequestLog(
        request_id=f"old-{uuid.uuid4().hex[:8]}", api_key_id=key.id, user_id=uid,
        provider="openai", model="gpt-4o", endpoint="/v1/chat/completions",
        status="success", cost=Decimal("9.99"), total_tokens=10,
        created_at=now - timedelta(days=60)))
    db.commit()
    assert key_policy.postgres_spend(db, key.id) == Decimal("10.04")
    assert key_policy.postgres_spend(db, key.id, since=now - timedelta(days=7)) == Decimal("0.05")
    # Fail-open: broken session reads as zero, Valkey remains the live gate.
    assert key_policy.postgres_spend(object(), key.id) == Decimal(0)


# --- IP rules: allow/deny, deny-wins, fail-closed, trusted proxy -------------

EMPTY = KeyPolicy()


def test_ip_allowed_matrix() -> None:
    def _ctx_with(allow=(), deny=()):
        return KeyContext(
            key_id=uuid.uuid4(), user_id=uuid.uuid4(), name="ip", key_prefix="tma_x",
            enabled=True, expires_at=None, policy=EMPTY, model_permissions=(),
            allow_rules=tuple(allow), deny_rules=tuple(deny))

    open_key = _ctx_with()
    assert key_policy.ip_allowed(open_key, None) is True
    assert key_policy.ip_allowed(open_key, "not-an-ip") is True  # no rules: open
    assert key_policy.ip_allowed(open_key, "8.8.8.8") is True

    allow = _ctx_with(allow=("1.2.3.0/24",))
    assert key_policy.ip_allowed(allow, "1.2.3.4") is True
    assert key_policy.ip_allowed(allow, "9.9.9.9") is False
    assert key_policy.ip_allowed(allow, "not-an-ip") is False  # fail-closed with rules
    assert key_policy.ip_allowed(allow, None) is False  # missing ip: fail-closed when rules exist

    deny = _ctx_with(deny=("10.0.0.0/8",))
    assert key_policy.ip_allowed(deny, "10.1.2.3") is False
    assert key_policy.ip_allowed(deny, "8.8.8.8") is True

    both = _ctx_with(allow=("0.0.0.0/0",), deny=("203.0.113.7/32",))
    assert key_policy.ip_allowed(both, "203.0.113.7") is False  # deny wins
    assert key_policy.ip_allowed(both, "8.8.8.8") is True

    v6 = _ctx_with(allow=("2001:db8::/32",))
    assert key_policy.ip_allowed(v6, "2001:db8::1") is True
    assert key_policy.ip_allowed(v6, "::1") is False


def test_gateway_client_ip_trusted_proxy() -> None:
    from tollms.core import sessions as session_mod

    def _req(peer: str | None, xff: str | None = None):
        headers = {"x-forwarded-for": xff} if xff else {}
        return SimpleNamespace(
            client=SimpleNamespace(host=peer) if peer else None, headers=headers)

    # Loopback/private peers are trusted: leftmost XFF wins.
    assert session_mod.gateway_client_ip(_req("127.0.0.1", "9.9.9.9")) == "9.9.9.9"
    assert session_mod.gateway_client_ip(_req("10.0.0.5", "1.1.1.1, 2.2.2.2")) == "1.1.1.1"
    # Public peer: forged XFF ignored, direct peer used.
    assert session_mod.gateway_client_ip(_req("8.8.8.8", "9.9.9.9")) == "8.8.8.8"
    # Unparseable peer: never trusts XFF.
    assert session_mod.gateway_client_ip(_req("testclient", "9.9.9.9")) == "testclient"
    # Extra trusted proxy via TRUSTED_PROXIES honours XFF.
    import ipaddress

    real = session_mod._trusted_proxy_nets  # noqa: SLF001
    session_mod._trusted_proxy_nets = lambda: [ipaddress.ip_network("8.8.8.0/24")]  # noqa: SLF001
    try:
        assert session_mod.gateway_client_ip(_req("8.8.8.8", "9.9.9.9")) == "9.9.9.9"
    finally:
        session_mod._trusted_proxy_nets = real  # noqa: SLF001
    # Empty peer never elects XFF (fail-closed at policy layer when rules exist); empty everything is empty.
    assert session_mod.gateway_client_ip(_req(None, "9.9.9.9")) == ""
    assert session_mod.gateway_client_ip(_req(None)) == ""


def test_public_ip_deny_before_dispatch(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    p = provider_factory("IpDeny")
    model_factory(p["id"])
    adapter = _FakePublicAdapter([])
    _bind_public(monkeypatch, adapter)
    raw, kid = _make_key(client)
    _set_ip_rules(client, kid, [{"type": "allow", "cidr": "1.2.3.4/32"}])

    # Allowed peer passes.
    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: "1.2.3.4")
    ok = client.post("/v1/chat/completions",
                     json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                     headers=_auth(raw))
    assert ok.status_code == 200, ok.text

    # Blocked peer: 403 before any provider I/O. The deny fires in the auth
    # layer (before execute_unified), so — like expired/disabled at auth — it
    # writes no audit row; _prepare-level denies are the ones audited once.
    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: "9.9.9.9")
    denied = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert "IP rules" in denied.json()["error"]["message"]
    assert len(adapter._calls) == 1  # noqa: SLF001 (only the allowed call)
    db.expire_all()
    assert len(_pg_rows(db, kid)) == 1  # the one success; no row for the deny

    # Unparseable client IP with rules present: fail-closed.
    monkeypatch.setattr(pg_service, "policy_client_ip", lambda request: "not-an-ip")
    closed = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert closed.status_code == 403, closed.text
    assert "IP rules" in closed.json()["error"]["message"]


def test_chat_ip_deny_before_dispatch(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("ChatIp")
    m = model_factory(p["id"])
    raw, kid = _make_key(client)
    calls = _bind_chat(monkeypatch, _FakeChatAdapter([]))
    key = db.get(ApiKey, uuid.UUID(kid))
    from tollms.models.api_key import ApiKeyIpRule, IpRuleType

    db.add(ApiKeyIpRule(api_key_id=key.id, type=IpRuleType.ALLOW, cidr="1.2.3.4/32"))
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))

    with pytest.raises(ForbiddenError, match="ip_blocked"):
        _run(chat_service.run_chat(
            db, _chat_req(p["id"], m["id"], kid), user_id=uid, client_ip="9.9.9.9"))
    assert calls == []
    assert _chat_rows(db, kid) == []

    allowed = _run(chat_service.run_chat(
        db, _chat_req(p["id"], m["id"], kid), user_id=uid, client_ip="1.2.3.4"))
    assert allowed.content == "Hello world"


# --- model allow-list: alias/casing/endpoint-change attempts -----------------

def test_model_allow_list_chat_and_public(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("ScopeP")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="other-model", name="Other")
    chat_calls = _bind_chat(monkeypatch, _FakeChatAdapter([]))
    pub_adapter = _FakePublicAdapter([])
    _bind_public(monkeypatch, pub_adapter)
    raw, kid = _make_key(client)
    _set_model_perms(client, kid, [{"provider_id": p["id"], "model_id": m1["id"]}])

    # Allowed model serves on both planes (authorization is by IDs).
    assert _run(chat_service.run_chat(
        db, _chat_req(p["id"], m1["id"], kid), user_id=uid)).content == "Hello world"
    allowed = client.post("/v1/chat/completions",
                          json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                          headers=_auth(raw))
    assert allowed.status_code == 200, allowed.text
    # Casing-variant identifier attempts resolve to nothing: 404, no oracle,
    # no upstream call (never a bypass of the allow-list).
    cased = client.post("/v1/chat/completions",
                        json={"model": _ref(p).upper(), "messages": [{"role": "user", "content": "hi"}]},
                        headers=_auth(raw))
    assert cased.status_code == 404, cased.text

    # Outside the allow-list: 403 on both planes, upstream never called.
    with pytest.raises(ForbiddenError, match="model_not_allowed"):
        _run(chat_service.run_chat(db, _chat_req(p["id"], m2["id"], kid), user_id=uid))
    denied = client.post("/v1/chat/completions",
                         json={"model": f"{p['name']}/other-model",
                               "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.text
    assert len(chat_calls) == 1 and len(pub_adapter._calls) == 1  # noqa: SLF001
    assert _chat_rows(db, kid) != []  # the one success only
    rows = _pg_rows(db, kid)
    # Resolution-failure 404s audit once too: cased miss + model deny.
    assert len([r for r in rows if r.status == "failed"]) == 2

    # Endpoint-change attempt: chat-only model via the images endpoint is denied.
    media_denied = client.post("/v1/images/generations",
                               json={"model": _ref(p), "prompt": "a circle"},
                               headers=_auth(raw))
    assert media_denied.status_code == 403, media_denied.text
    assert "model_not_allowed" in media_denied.text
    db.expire_all()
    failed = [r for r in _pg_rows(db, kid) if r.status == "failed"]
    assert len(failed) == 3  # cased 404 + model deny + endpoint-change deny
    assert all(r.cost is None and r.total_tokens is None for r in failed)


def test_ambiguous_alias_rejected_without_oracle(
    client: TestClient, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    a = provider_factory("AmbigA")
    model_factory(a["id"])
    b = provider_factory("AmbigB")
    model_factory(b["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, _ = _make_key(client)
    r = client.post("/v1/chat/completions",
                    json={"model": "mock-model", "messages": [{"role": "user", "content": "hi"}]},
                    headers=_auth(raw))
    assert r.status_code == 422, r.text
    assert "ambiguous_model" in r.text


# --- concurrency: no overspend; fail/cancel cleanup ---------------------------

def test_concurrent_hard_budget_cannot_overspend(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_valkey()
    _freeze(monkeypatch, NOW)
    ctx = _ctx(KeyPolicy(max_budget_usd=Decimal("0.005")))  # 5000 micros
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [
            pool.submit(
                limits.check_request, ctx, provider_id=uuid.uuid4(), model_id=uuid.uuid4(),
                estimated_tokens=10, estimated_cost=Decimal("0.001"),
                request_id=f"conc-{i}",
            )
            for i in range(10)
        ]
        results = [f.result() for f in futures]
    allowed = [d for d in results if d.allowed]
    assert len(allowed) == 5  # exactly 5 x 1000 micros fit
    assert all(d.reason == "budget" and d.status_code == 403 for d in results if not d.allowed)
    assert limits.current_spend(ctx) == Decimal("0.005")


def test_reservation_cleanup_on_fail_and_cancel(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("CleanupP")
    m = model_factory(p["id"])
    raw, kid = _make_key(client)
    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None

    # Provider failure: reservation refunded, spend stays zero, no success row.
    boom_calls: list = []
    monkeypatch.setattr(
        chat_service, "build_adapter", lambda *a, **k: _FakeChatAdapter(boom_calls, error=RuntimeError("boom")))
    with pytest.raises(Exception):
        _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    assert limits.current_spend(ctx) == Decimal(0)
    assert _chat_rows(db, kid) == []

    # Streaming cancel: reservation slot for the client_key is gone afterwards.
    from tollms.services import generation as generation_engine

    class _Slow(_FakeChatAdapter):
        async def chat_stream(self, messages):
            import asyncio as _aio

            self._calls.append(("stream", list(messages)))
            yield StreamChunk(delta="partial ")
            await _aio.sleep(30)

    monkeypatch.setattr(chat_service, "build_adapter", lambda *a, **k: _Slow([]))
    ckey = f"cancel-{uuid.uuid4().hex}"

    async def _cancel_main():
        started = await chat_service.start_generation(
            db, _chat_req(p["id"], m["id"], kid, client_key=ckey), user_id=uid)
        await chat_service.cancel_generation(db, started.generation_id)
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = _run(_cancel_main())
    db.expire_all()
    clog = db.scalar(select(RequestLog).where(RequestLog.message_id == started.message_id))
    assert clog is not None and clog.status == RequestStatus.CANCELLED.value
    slot = cache_get_sync(
        limits._reservation_key(ctx, uuid.UUID(p["id"]), uuid.UUID(m["id"]), ckey))  # noqa: SLF001
    assert slot is None  # reconciled on cancel, not leaked


# --- endpoint compat (mock transports): shape/termination/usage/cancel/errors

def _compat_key(client: TestClient, provider_factory, model_factory, monkeypatch, tag: str):
    provider = provider_factory(tag)
    model_factory(provider["id"])
    calls: list = []
    _bind_public(monkeypatch, _FakePublicAdapter(calls))
    raw, kid = _make_key(client)
    return provider, raw, kid, calls


def test_chat_completions_nonstream_compat(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p, raw, kid, calls = _compat_key(client, provider_factory, model_factory, monkeypatch, "CompatChat")
    r = client.post("/v1/chat/completions",
                    json={"model": _ref(p),
                          "messages": [{"role": "system", "content": "be nice"},
                                       {"role": "user", "content": "hi"}],
                          "temperature": 0.2, "top_p": 0.9, "max_tokens": 16, "stop": ["END"]},
                    headers=_auth(raw))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["object"] == "chat.completion" and body["model"] == _ref(p)
    assert body["choices"][0]["message"] == {"role": "assistant", "content": "Hello world"}
    assert body["choices"][0]["finish_reason"] == "stop"
    assert body["usage"]["total_tokens"] == 15
    assert calls and calls[0][0] == "chat"
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "success"
    assert rows[0].total_tokens == 15 and rows[0].cost is not None and rows[0].cost > 0
    assert rows[0].is_streaming is False


def test_chat_completions_stream_compat(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p, raw, kid, _ = _compat_key(client, provider_factory, model_factory, monkeypatch, "CompatChatS")
    with client.stream("POST", "/v1/chat/completions",
                       json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}],
                             "stream": True},
                       headers=_auth(raw)) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    assert "chat.completion.chunk" in text
    assert '"content": "Hello"' in text or '"content":"Hello"' in text
    assert "data: [DONE]" in text
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "success" and rows[0].is_streaming is True
    assert rows[0].total_tokens == 15 and rows[0].cost is not None


def test_responses_nonstream_compat(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p, raw, kid, _ = _compat_key(client, provider_factory, model_factory, monkeypatch, "CompatResp")
    r = client.post("/v1/responses",
                    json={"model": _ref(p), "input": "hello",
                          "instructions": "be terse", "max_output_tokens": 64,
                          "temperature": 0.2},
                    headers=_auth(raw))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["object"] == "response" and body["status"] == "completed"
    assert body["model"] == _ref(p)
    assert body["output_text"] == "Hello world"
    assert body["output"][0]["content"] == [{"type": "output_text", "text": "Hello world",
                                             "annotations": []}]
    assert body["usage"] == {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "success"


def test_responses_stream_compat(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p, raw, kid, _ = _compat_key(client, provider_factory, model_factory, monkeypatch, "CompatRespS")
    with client.stream("POST", "/v1/responses",
                       json={"model": _ref(p), "input": "hello", "stream": True},
                       headers=_auth(raw)) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    assert "response.created" in text
    assert "response.output_text.delta" in text
    assert "response.completed" in text
    assert '"status": "completed"' in text or '"status":"completed"' in text
    assert "data: [DONE]" not in text  # only the OpenAI shape sends [DONE]
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "success" and rows[0].is_streaming is True


def test_anthropic_nonstream_compat(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p, raw, kid, _ = _compat_key(client, provider_factory, model_factory, monkeypatch, "CompatAnth")
    r = client.post("/v1/messages",
                    json={"model": _ref(p), "max_tokens": 64,
                          "system": "be terse",
                          "messages": [{"role": "user", "content": "hi"}],
                          "temperature": 0.2, "stop_sequences": ["STOP"]},
                    headers={**_auth(raw), "anthropic-version": "2023-06-01"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "message" and body["role"] == "assistant"
    assert body["model"] == _ref(p)
    assert body["content"] == [{"type": "text", "text": "Hello world"}]
    assert body["stop_reason"] == "end_turn"
    assert body["usage"] == {"input_tokens": 10, "output_tokens": 5}
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "success"


def test_anthropic_stream_compat(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p, raw, kid, _ = _compat_key(client, provider_factory, model_factory, monkeypatch, "CompatAnthS")
    with client.stream("POST", "/v1/messages",
                       json={"model": _ref(p), "max_tokens": 64,
                             "messages": [{"role": "user", "content": "hi"}],
                             "stream": True},
                       headers={**_auth(raw), "anthropic-version": "2023-06-01"}) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    for event in ("message_start", "content_block_start", "content_block_delta",
                  "content_block_stop", "message_delta", "message_stop"):
        assert event in text, event
    assert '"text": "Hello"' in text or '"text":"Hello"' in text
    assert '"text": " world"' in text or '"text":" world"' in text
    assert "data: [DONE]" not in text  # only the OpenAI shape sends [DONE]
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "success" and rows[0].is_streaming is True


def test_public_stream_cancel_releases_and_logs_cancelled(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Abandoned SSE stream: exactly one cancelled row, reservation released.

    Unit-level (generator aclose, as in production disconnects): deterministic,
    no 30s sleeps, no live I/O. Mocks the upstream adapter only.
    """
    import time as _time

    from tollms.services.gateway import translators
    from tollms.services.gateway.adapters.base import ChatMessage

    _require_valkey()
    user_factory()
    p = provider_factory("CompatCancel")
    model_factory(p["id"])
    raw, kid = _make_key(client)
    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None
    provider = db.get(__import__("tollms.models.provider", fromlist=["Provider"]).Provider,
                      uuid.UUID(p["id"]))
    from tollms.models.registered_model import AIModel

    from sqlalchemy import select as _select

    model = db.scalar(_select(AIModel).where(AIModel.provider_id == uuid.UUID(p["id"])))
    assert provider is not None and model is not None

    class _Slow:
        async def chat_stream(self, messages):
            import asyncio as _aio

            yield StreamChunk(delta="partial")
            await _aio.sleep(30)

    unified = translators.from_openai_chat(
        {"model": _ref(p), "messages": [{"role": "user", "content": "hi"}], "stream": True})
    meta = pg_service.ClientMeta(request_id=f"cancel-{uuid.uuid4().hex[:8]}")
    prepared = pg_service._Prepared(  # noqa: SLF001
        ctx=ctx, meta=meta, unified=unified, provider=provider, model=model,
        adapter=_Slow(), messages=[ChatMessage(role="user", content="hi")],
        history_text="hi", started=_time.monotonic(),
    )

    async def _abandon():
        gen = pg_service._stream_chat(prepared, db)  # noqa: SLF001
        first = await gen.__anext__()
        assert "partial" in first
        await gen.aclose()

    _run(_abandon())
    db.expire_all()
    cancelled = [r for r in _pg_rows(db, kid) if r.status == "cancelled"]
    assert len(cancelled) == 1  # exactly one terminal row, no double count
    assert cancelled[0].is_streaming is True
    assert cancelled[0].cost is None  # no billable output on cancel
    assert limits.current_spend(ctx) == Decimal(0)  # reservation released


def test_upstream_errors_mapped_and_reservation_released(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    import httpx as _httpx

    user_factory()
    p = provider_factory("CompatErr")
    model_factory(p["id"])

    # Non-streaming provider boom -> 502 PROVIDER_ERROR, one failed row.
    monkeypatch.setattr(
        pg_service, "build_adapter",
        lambda *a, **k: _FakePublicAdapter([], error=RuntimeError("provider blew up")))
    raw, kid = _make_key(client)
    boom = client.post("/v1/chat/completions",
                       json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                       headers=_auth(raw))
    assert boom.status_code == 502, boom.text
    assert boom.json()["error"]["code"] == "PROVIDER_ERROR"
    rows = _pg_rows(db, kid)
    assert len(rows) == 1 and rows[0].status == "failed"
    assert rows[0].error_code == "PROVIDER_ERROR"
    assert rows[0].cost is None and rows[0].total_tokens is None
    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None and limits.current_spend(ctx) == Decimal(0)

    # Streaming timeout mid-stream -> TIMEOUT frame + one failed row.
    monkeypatch.setattr(
        pg_service, "build_adapter",
        lambda *a, **k: _FakePublicAdapter(
            [], error=_httpx.TimeoutException("timed out", request=None)))
    with client.stream("POST", "/v1/chat/completions",
                       json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}],
                             "stream": True},
                       headers=_auth(raw)) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    assert "TIMEOUT" in text and "data: [DONE]" in text
    db.expire_all()
    failed = [r for r in _pg_rows(db, kid) if r.status == "failed"]
    assert len(failed) == 2  # one per failed request, never doubled
    assert failed[-1].error_code == "TIMEOUT"


# --- regression: personal/org keys, cross-owner oracle, isolation ------------

def _org_setup(client: TestClient, db: Session, tag: str):
    from tollms.models.registered_model import AIModel

    root_id = client.get("/auth/me").json()["id"]
    oid = client.post("/api/v1/orgs", json={"name": f"Policy Org {tag}"}).json()["id"]
    r = client.post(f"/api/v1/orgs/{oid}/providers/register", json={
        "name": f"OrgProv{tag}", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [{"model_id": f"org-model-{tag}", "name": "Org Model",
                    "endpoint_type": "chat_completions",
                    "input_price": "1", "output_price": "2"}]})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    mid = str(db.scalar(select(AIModel.id).where(
        AIModel.provider_id == uuid.UUID(pid), AIModel.model_id == f"org-model-{tag}")))
    issued = client.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": root_id, "name": "org-key"})
    assert issued.status_code == 201, issued.text
    return oid, pid, mid, issued.json()["raw_key"], issued.json()["key"]["id"]


def test_personal_and_org_keys_serve_both_planes(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("BothP")
    m = model_factory(p["id"])
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    raw, kid = _make_key(client)

    ok = _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    assert ok.content == "Hello world"
    pub = client.post("/v1/chat/completions",
                      json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                      headers=_auth(raw))
    assert pub.status_code == 200, pub.text

    oid, opid, omid, oraw, okid = _org_setup(client, db, "both")
    org_pub = client.post(
        "/v1/chat/completions",
        json={"model": f"OrgProvboth/org-model-both",
              "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(oraw))
    assert org_pub.status_code == 200, org_pub.text
    org_chat = _run(chat_service.run_chat(
        db, ChatRequest(provider_id=uuid.UUID(opid), model_id=uuid.UUID(omid),
                        message="hi", key_id=uuid.UUID(okid)), user_id=uid))
    assert org_chat.content == "Hello world"


def test_cross_owner_key_is_404(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
) -> None:
    owner = user_factory("crossowner@tollma.ai")
    p = provider_factory("CrossP")
    m = model_factory(p["id"])
    owner_keys = client.get("/api/v1/chat/keys").json()
    assert owner_keys
    owner_kid = owner_keys[0]["id"]

    user_factory("crossintruder@tollma.ai")
    assert client.get(f"/api/v1/keys/{owner_kid}").status_code == 404
    assert client.get(f"/api/v1/chat/models?key_id={owner_kid}").status_code == 404
    r = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": owner_kid})
    assert r.status_code == 404, r.text
    # Stranger's own list never contains the owner's key.
    assert owner_kid not in [k["id"] for k in client.get("/api/v1/chat/keys").json()]


def test_org_isolation_personal_vs_org_scope(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    p = provider_factory("IsoP")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    personal_raw, _ = _make_key(client)
    oid, _, _, org_raw, _ = _org_setup(client, db, "iso")

    # Org key cannot reach personal providers; personal key cannot reach org rows.
    org_on_personal = client.post(
        "/v1/chat/completions",
        json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(org_raw))
    assert org_on_personal.status_code == 404, org_on_personal.text
    personal_on_org = client.post(
        "/v1/chat/completions",
        json={"model": "OrgProviso/org-model-iso",
              "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(personal_raw))
    assert personal_on_org.status_code == 404, personal_on_org.text
    # Model listings are scoped the same way: each key sees only its own rows.
    org_models = client.get("/v1/models", headers=_auth(org_raw)).json()["data"]
    assert [m["id"] for m in org_models] == ["OrgProviso/org-model-iso"]
    personal_models = client.get("/v1/models", headers=_auth(personal_raw)).json()["data"]
    assert all(m["id"] != "OrgProviso/org-model-iso" for m in personal_models)


def test_history_survives_key_provider_delete(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("HistP")
    m = model_factory(p["id"])
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    raw, kid = _make_key(client)

    from tollms.models.message import Message

    result = _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    # Soft deletes hide rows but keep every history + cost row.
    assert client.delete(f"/api/v1/models/{m['id']}").status_code == 204
    assert client.delete(f"/api/v1/providers/{p['id']}").status_code == 204
    assert client.delete(f"/api/v1/keys/{kid}").status_code == 204
    db.expire_all()
    assert db.scalar(select(RequestLog).where(
        RequestLog.message_id == result.message_id)) is not None
    assert db.scalars(select(Message).where(
        Message.conversation_id == result.conversation_id)).all() != []
    # Hard removal nulls the key ref (SET NULL) and keeps the billed row.
    db.delete(db.get(ApiKey, uuid.UUID(kid)))
    db.commit()
    db.expire_all()
    req = db.scalar(select(RequestLog).where(RequestLog.message_id == result.message_id))
    assert req is not None and req.api_key_id is None
    assert req.total_cost is not None


def test_adapter_factory_intact() -> None:
    from tollms.core.exceptions import ProviderError
    from tollms.models.provider import ProviderType
    from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
    from tollms.services.gateway.adapters.openai import (
        OpenAIChatAdapter,
        OpenAIResponsesAdapter,
    )
    from tollms.services.gateway.factory import (
        adapter_class,
        provider_supported_endpoints,
    )

    custom = SimpleNamespace(provider_type=ProviderType.CUSTOM)
    assert adapter_class(custom, "chat_completions") is OpenAIChatAdapter
    assert adapter_class(custom, "responses") is OpenAIResponsesAdapter
    anthropic = SimpleNamespace(provider_type=ProviderType.ANTHROPIC_MESSAGES)
    assert adapter_class(anthropic, "messages") is AnthropicAdapter
    with pytest.raises(ProviderError):
        adapter_class(custom, "nope-endpoint")
    assert "chat_completions" in provider_supported_endpoints(custom)
    assert "responses" in provider_supported_endpoints(custom)


# --- ledger agreement: listing/detail, last_used, analytics, denied audit ----

def test_listing_detail_status_agreement_and_deny_leaves_state(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("AgreeP")
    m = model_factory(p["id"])
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    raw, kid = _make_key(client)
    _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), user_id=uid))
    db.expire_all()

    listed = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    detail = client.get(f"/api/v1/keys/{kid}").json()
    for field in ("enabled", "expires_at", "last_used_at"):
        assert listed[kid][field] == detail[field], field
    assert detail["last_used_at"] is not None

    # Block-all policy: denied with 429, representation untouched.
    _set_policy(client, kid, {"rpm": 0})
    denied = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": kid})
    assert denied.status_code == 429, denied.text
    listed2 = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    detail2 = client.get(f"/api/v1/keys/{kid}").json()
    assert listed2[kid]["enabled"] is True and detail2["enabled"] is True
    assert listed2[kid]["last_used_at"] == detail2["last_used_at"] == detail["last_used_at"]


def test_last_used_set_on_success_both_planes(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("StampBoth")
    m = model_factory(p["id"])
    chat_calls = _bind_chat(monkeypatch, _FakeChatAdapter([]))
    _bind_public(monkeypatch, _FakePublicAdapter([]))
    chat_raw, chat_kid = _make_key(client, name="Chat stamp")
    pub_raw, pub_kid = _make_key(client, name="Pub stamp")
    assert db.get(ApiKey, uuid.UUID(chat_kid)).last_used_at is None

    _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], chat_kid), user_id=uid))
    assert len(chat_calls) == 1
    r = client.post("/v1/chat/completions",
                    json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                    headers=_auth(pub_raw))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(ApiKey, uuid.UUID(chat_kid)).last_used_at is not None
    assert db.get(ApiKey, uuid.UUID(pub_kid)).last_used_at is not None
    listed = {k["id"]: k for k in client.get("/api/v1/keys").json()}
    assert listed[chat_kid]["last_used_at"] is not None
    assert listed[pub_kid]["last_used_at"] is not None


def test_per_key_analytics_reconciles_both_ledgers(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
) -> None:
    from tollms.models.registered_model import AIModel

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("ReconP")
    m = model_factory(p["id"])
    raw, kid = _make_key(client, name="Recon")
    model_row = db.scalar(select(AIModel).where(AIModel.id == uuid.UUID(m["id"])))
    now = datetime.now(timezone.utc)
    db.add(ApiRequestLog(
        request_id=f"rc-{uuid.uuid4().hex[:8]}", api_key_id=uuid.UUID(kid), user_id=uid,
        provider="custom", model="mock-model", endpoint="/v1/chat/completions",
        status="success", latency_ms=100.0, cost=Decimal("0.02"),
        input_tokens=50, output_tokens=50, total_tokens=100,
        created_at=now - timedelta(hours=1)))
    db.add(RequestLog(
        user_id=uid, api_key_id=uuid.UUID(kid), provider_id=uuid.UUID(p["id"]),
        model_id=model_row.id, total_tokens=300, total_cost=Decimal("0.05"),
        latency_ms=200.0, status=RequestStatus.SUCCESS.value, is_streaming=True,
        created_at=now - timedelta(hours=2)))
    db.commit()

    body = client.get(f"/api/v1/keys/{kid}/analytics", params={"preset": "last_7d"}).json()
    assert body["requests"] == 2
    assert body["tokens"] == 400
    assert Decimal(str(body["cost"])) == Decimal("0.07")
    assert body["error_rate"] == 0.0
    endpoints = {row["endpoint"]: row for row in body["top_endpoints"]}
    assert endpoints["chat"]["requests"] == 1
    assert endpoints["/v1/chat/completions"]["requests"] == 1


def test_denied_request_bills_nothing_and_audits_once(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _require_valkey()
    user_factory()
    p = provider_factory("AuditOnce")
    model_factory(p["id"])
    adapter = _FakePublicAdapter([])
    _bind_public(monkeypatch, adapter)
    raw, kid = _make_key(client)
    before = len(_pg_rows(db, kid))

    _set_policy(client, kid, {"rpm": 1})
    assert client.post("/v1/chat/completions",
                       json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                       headers=_auth(raw)).status_code == 200
    denied = client.post("/v1/chat/completions",
                         json={"model": _ref(p), "messages": [{"role": "user", "content": "hi"}]},
                         headers=_auth(raw))
    assert denied.status_code == 429, denied.text

    db.expire_all()
    rows = _pg_rows(db, kid)
    assert len(rows) == before + 2  # one success + exactly one failed row
    failed = [r for r in rows if r.status == "failed"]
    assert len(failed) == 1
    assert failed[0].cost is None and failed[0].total_tokens is None
    assert failed[0].input_tokens is None and failed[0].output_tokens is None
    assert len(adapter._calls) == 1  # noqa: SLF001 denied before dispatch

    analytics = client.get(f"/api/v1/keys/{kid}/analytics",
                           params={"preset": "last_7d"}).json()
    assert analytics["requests"] == before + 2  # failed traffic audited, not hidden
    assert analytics["error_rate"] > 0


def test_request_logs_key_created_index_declared() -> None:
    names = {ix.name for ix in RequestLog.__table__.indexes}
    assert "ix_request_logs_key_created" in names
    (ix,) = [ix for ix in RequestLog.__table__.indexes
             if ix.name == "ix_request_logs_key_created"]
    assert [c.name for c in ix.columns] == ["api_key_id", "created_at"]


def test_regeneration_enforces_policy_before_new_rows(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tollms.services import generation as generation_engine

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("RegenPol")
    m = model_factory(p["id"])
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    raw, kid = _make_key(client)

    async def _seed():
        started = await chat_service.start_generation(
            db, _chat_req(p["id"], m["id"], kid), user_id=uid)
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = _run(_seed())
    db.expire_all()
    from sqlalchemy import func as _func

    runs_before = db.scalar(select(_func.count()).select_from(RequestLog))

    # Exhaust the key after the seed: regeneration must deny, not append.
    _set_policy(client, kid, {"rpd": 0})
    regen = client.post(f"/api/v1/messages/{started.message_id}/regenerate",
                        json={"key_id": kid})
    assert regen.status_code == 429, regen.text
    db.expire_all()
    assert db.scalar(select(_func.count()).select_from(RequestLog)) == runs_before
