"""Wave-3 observability ledger tests (Agent 7 wave-1 scope A/B/C/D).

Ledger columns on both planes (trace_id, session_key, usage_estimated, full
token breakdown, costs, currency, pricing_version, finish_reason,
model_params, level/status_message), new list filters, precedence (personal
vs org, zero-retention veto incl. fail-closed), lifecycle
(streaming/tool-absent/failure/partial/retry/missing-usage), and NULL
semantics for unpriced rows.
"""

import asyncio
import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as chat_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.prompt_logging.settings import decrypt_body
from tollms.api.public_gateway import service as pg_service
from tollms.core.exceptions import ProviderError
from tollms.models.api_key import ApiKey
from tollms.models.organization import Invitation
from tollms.models.prompt_logging import PromptLog
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import resolution as resolution_engine

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"


def _run(coro):
    return asyncio.run(coro)


class _FakeAdapter:
    def __init__(self, calls: list, error: Exception | None = None) -> None:
        self._calls = calls
        self._error = error

    async def chat_stream(self, messages):
        self._calls.append(("stream", list(messages)))
        if self._error is not None:
            raise self._error
        yield StreamChunk(delta="Hello")
        yield StreamChunk(delta=" world", prompt_tokens=10,
                          completion_tokens=5, total_tokens=15)

    async def chat(self, messages):
        self._calls.append(("chat", list(messages)))
        if self._error is not None:
            raise self._error
        return ChatResult(text="Hello world", prompt_tokens=10,
                          completion_tokens=5, total_tokens=15)


def _other(email: str) -> TestClient:
    from tollms.main import app

    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        c.get("/auth/verify", params={"token": token})
    return c


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _org(c: TestClient, name: str = "Ledger Org") -> str:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _invite(root: TestClient, member: TestClient, db: Session, oid: str) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _me(member)["email"], "set_ids": []})
    assert inv.status_code == 201, inv.text
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(row)
    acc = member.post(f"{ORG}/invitations/by-token/{row.token}/accept")
    assert acc.status_code == 200, acc.text


def _set(root: TestClient, oid: str, name: str, codes: list[str]) -> str:
    r = root.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": codes})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _assign(root: TestClient, oid: str, uid: str, sids: list[str]) -> None:
    r = root.post(f"{ORG}/{oid}/members/{uid}/sets", json={"set_ids": sids})
    assert r.status_code == 200, r.text


def _enable_personal(c: TestClient, **kw) -> None:
    body = {"enabled": True, "mode": "global", "capture_input": True,
            "capture_output": True}
    body.update(kw)
    r = c.put(f"{PL}/settings", json=body)
    assert r.status_code == 200, r.text


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"lg-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _rows(db: Session) -> list:
    db.expire_all()
    return list(db.scalars(select(PromptLog).order_by(PromptLog.created_at)))


def _make_key(c: TestClient) -> tuple[str, str]:
    r = c.post("/api/v1/keys", json={"name": f"LG key {uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    return r.json()["raw_key"], r.json()["key"]["id"]


# --- both planes ------------------------------------------------------------


def test_public_plane_columns_and_session_header(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """Public plane: trace_id=request_id, session_key from header, usage kept."""
    user_factory()
    p = provider_factory("LedPub")
    model_factory(p["id"])
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _FakeAdapter([]))
    raw, _ = _make_key(client)
    _enable_personal(client)

    r = client.post("/v1/chat/completions",
                    json={"model": "LedPub/mock-model",
                          "messages": [{"role": "user", "content": "hello"}],
                          "temperature": 0.2},
                    headers={"Authorization": f"Bearer {raw}",
                             "X-Tollma-Session-Key": "sess-abc-123"})
    assert r.status_code == 200, r.text

    rows = _rows(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.source == "external" and row.status == "completed"
    assert row.session_key == "sess-abc-123"
    assert row.trace_id == row.request_id and row.trace_id
    assert row.generation_id is not None  # deterministic per-request UUID
    assert (row.prompt_tokens, row.completion_tokens) == (10, 5)
    assert row.total_tokens == 15 and row.usage_estimated is False
    assert row.level == "info"
    assert isinstance(row.model_params, dict)  # public plane pins params


def test_unpriced_model_plane_rows_null_costs(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """H1: a model with no prices anywhere persists NULL costs — never $0."""
    user_factory()
    p = provider_factory("LedUnpriced")
    model_factory(p["id"], input_price="0", output_price="0",
                  cache_read_price="0", cache_write_price="0")
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _FakeAdapter([]))
    raw, _ = _make_key(client)
    _enable_personal(client)

    r = client.post("/v1/chat/completions",
                    json={"model": "LedUnpriced/mock-model",
                          "messages": [{"role": "user", "content": "hello"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text

    rows = _rows(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "completed"
    assert row.prompt_tokens == 10 and row.completion_tokens == 5
    assert row.input_cost is None and row.output_cost is None
    assert row.total_cost is None
    assert row.currency is None and row.pricing_version is None


def test_public_streaming_terminal_captures_once_with_session(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """C1: streamed generation leaves exactly one row (terminal usage)."""
    user_factory()
    p = provider_factory("LedPubS")
    model_factory(p["id"])
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _FakeAdapter([]))
    raw, _ = _make_key(client)
    _enable_personal(client)

    with client.stream("POST", "/v1/chat/completions",
                       json={"model": "LedPubS/mock-model",
                             "messages": [{"role": "user", "content": "stream me"}],
                             "stream": True},
                       headers={"Authorization": f"Bearer {raw}",
                                "X-Tollma-Session-Key": "sess-stream-1"}) as r:
        assert r.status_code == 200, r.text
        text = r.read().decode()
    assert "Hello" in text and "DONE" in text

    rows = _rows(db)  # one row per generation, never per chunk
    assert len(rows) == 1 and rows[0].status == "completed"
    assert rows[0].session_key == "sess-stream-1"
    assert rows[0].trace_id == rows[0].request_id


def test_internal_plane_null_session_and_generation_link(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """Internal plane: session_key NULL; generation_id = message id;
    trace_id = conversation id (groups all generations of the turn)."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("LedInt")
    m = model_factory(p["id"])
    _, kid = _make_key(client)
    monkeypatch.setattr(chat_service, "build_adapter", lambda *a, **k: _FakeAdapter([]))
    _enable_personal(client)

    result = _run(chat_service.run_chat(
        db, ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                        message="hook input", key_id=uuid.UUID(kid)),
        None, user_id=uid))
    assert result.content == "Hello world"

    rows = _rows(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.session_key is None  # internal groups by conversation, not header
    assert row.trace_id == str(row.conversation_id)  # conversation-scoped trace
    assert row.generation_id is not None  # links the assistant message
    assert row.conversation_id is not None
    assert decrypt_body(row.input_cipher) == "hook input"


def test_public_failure_records_error_taxonomy(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """C5/D6: failed public row keeps input, drops output, level=error."""
    user_factory()
    p = provider_factory("LedPubF")
    model_factory(p["id"])
    monkeypatch.setattr(pg_service, "build_adapter",
                        lambda *a, **k: _FakeAdapter([], error=ProviderError("down")))
    raw, _ = _make_key(client)
    _enable_personal(client)

    r = client.post("/v1/chat/completions",
                    json={"model": "LedPubF/mock-model",
                          "messages": [{"role": "user", "content": "fail me"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code != 200
    rows = _rows(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "failed" and row.error_code
    assert row.level == "error"
    assert decrypt_body(row.input_cipher) == "fail me"
    assert row.output_cipher is None

    body = client.get(f"{PL}/logs", params={"level": "error"}).json()["items"]
    assert any(it["request_id"] == row.request_id for it in body)


# --- full ledger columns via shared writer ----------------------------------


def test_full_ledger_columns_round_trip(client: TestClient, db: Session, user_factory) -> None:
    """D1/D2/D4: breakdown + costs + correlation columns ride the row."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable_personal(client)
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="full-1",
        generation_id=uuid.uuid4(), status="completed",
        tokens={"prompt": 100, "completion": 50},
        estimated=False,
        full_tokens={"total": 170, "cache_read": 10, "cache_write": 5,
                     "reasoning": 5},
        cost={"input": Decimal("0.000250"), "output": Decimal("0.000500"),
              "total": Decimal("0.000750")},
        currency="USD", pricing_version="repo-2026-11-01",
        trace_id="T-full-1", session_key="sess-full-1",
        finish_reason="stop", model_params={"temperature": 0.2},
        level="info", status_message="ok",
        latency_ms=120.0)
    assert row is not None

    item = client.get(f"{PL}/logs", params={"q": "full-1"}).json()["items"][0]
    assert item["trace_id"] == "T-full-1" and item["session_key"] == "sess-full-1"
    assert item["prompt_tokens"] == 100 and item["completion_tokens"] == 50
    assert item["total_tokens"] == 170
    assert item["cache_read_tokens"] == 10 and item["cache_write_tokens"] == 5
    assert item["reasoning_tokens"] == 5
    assert item["usage_estimated"] is False
    assert float(item["total_cost"]) == 0.00075
    assert item["currency"] == "USD" and item["pricing_version"] == "repo-2026-11-01"
    assert item["finish_reason"] == "stop"
    assert item["model_params"] == {"temperature": 0.2}
    assert item["level"] == "info" and item["status_message"] == "ok"
    assert item["generation_id"] == str(row.generation_id)

    detail = client.get(f"{PL}/logs/{row.id}").json()
    assert detail["input_text"] == "in" and detail["output_text"] == "out"


def test_null_semantics_unpriced(client: TestClient, db: Session, user_factory) -> None:
    """D2/D7: unknown usage/cost stays NULL — never 0, never $0."""
    user = user_factory()
    _enable_personal(client)
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out",
        user_id=uuid.UUID(user["id"]), endpoint="chat", source="internal",
        request_id="null-1", status="completed")
    assert row is not None
    assert row.usage_estimated is None and row.total_tokens is None
    assert row.input_cost is None and row.total_cost is None

    item = client.get(f"{PL}/logs", params={"q": "null-1"}).json()["items"][0]
    assert item["usage_estimated"] is None and item["total_cost"] is None
    assert item["currency"] is None and item["pricing_version"] is None
    assert item["trace_id"] is None and item["session_key"] is None


def test_session_key_truncated_to_128(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable_personal(client)
    long_key = "s" * 200
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out",
        user_id=uuid.UUID(user["id"]), endpoint="chat", source="internal",
        request_id="trunc-1", session_key=long_key, status="completed")
    assert row is not None and row.session_key == "s" * 128


def test_missing_usage_flagged_estimated(client: TestClient, db: Session, user_factory) -> None:
    """C9: silent provider → usage_estimated=True, tokens NULL (no fallback 0)."""
    user = user_factory()
    _enable_personal(client)
    row = capture_engine.capture_post(
        db, input_text="in", output_text="partial-out",
        user_id=uuid.UUID(user["id"]), endpoint="chat", source="internal",
        request_id="est-1", status="partial", estimated=True)
    assert row is not None
    assert row.usage_estimated is True and row.total_tokens is None
    assert row.level == "warning"  # partial maps to warning

    item = client.get(f"{PL}/logs", params={"q": "est-1"}).json()["items"][0]
    assert item["usage_estimated"] is True and item["status"] == "partial"


def test_retry_same_delivery_single_row(client: TestClient, db: Session, user_factory) -> None:
    """C7: same (request_id, generation_id) retry collapses to one row."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable_personal(client)
    gen = uuid.uuid4()
    first = capture_engine.capture_post(
        db, input_text="in", output_text="v1", user_id=uid,
        endpoint="chat", source="internal", request_id="retry-1",
        generation_id=gen, status="failed", error_code="TIMEOUT")
    assert first is not None
    # Redelivery of the same generation: dropped by the idempotency index.
    assert capture_engine.capture_post(
        db, input_text="in", output_text="v2", user_id=uid,
        endpoint="chat", source="internal", request_id="retry-1",
        generation_id=gen, status="completed") is None
    assert db.scalars(select(PromptLog).where(
        PromptLog.request_id == "retry-1")).all().__len__() == 1


def test_status_message_scrubbed_and_bounded(client: TestClient, db: Session, user_factory) -> None:
    """E: status_message never carries raw secrets; bounded at 500 chars."""
    user = user_factory()
    _enable_personal(client)
    secret = "sk-live-abcdef1234567890"
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out",
        user_id=uuid.UUID(user["id"]), endpoint="chat", source="internal",
        request_id="scrub-1", status="failed", error_code="PROVIDER_ERROR",
        status_message=f"provider said no {secret} " + "x" * 600)
    assert row is not None
    assert secret not in (row.status_message or "")
    assert "[redacted-secret]" in (row.status_message or "")
    assert len(row.status_message or "") <= 500


# --- new list filters ---------------------------------------------------------


def _seed_filter_rows(c: TestClient, db: Session, user: dict) -> None:
    _enable_personal(c)
    uid = uuid.UUID(user["id"])
    specs = [
        ("f-1", "T-A", "sess-x", "completed", "info", 100, "0.001"),
        ("f-2", "T-A", "sess-y", "failed", "error", 200, "0.005"),
        ("f-3", "T-B", "sess-x", "partial", "warning", 300, None),
    ]
    for req, trace, sess, status, level, tokens, cost in specs:
        row = capture_engine.capture_post(
            db, input_text="in", output_text="out", user_id=uid,
            endpoint="chat", source="internal", request_id=req,
            trace_id=trace, session_key=sess, status=status, level=level,
            full_tokens={"total": tokens} if tokens else None,
            cost={"total": Decimal(cost)} if cost else None,
            currency="USD" if cost else None)
        assert row is not None


def test_list_new_filters(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_filter_rows(client, db, user)

    assert len(client.get(f"{PL}/logs", params={"trace_id": "T-A"}).json()["items"]) == 2
    assert len(client.get(f"{PL}/logs", params={"session_key": "sess-x"}).json()["items"]) == 2
    assert [i["request_id"] for i in
            client.get(f"{PL}/logs", params={"level": "error"}).json()["items"]] == ["f-2"]
    assert [i["request_id"] for i in
            client.get(f"{PL}/logs", params={"status": "partial"}).json()["items"]] == ["f-3"]
    assert {i["request_id"] for i in
            client.get(f"{PL}/logs", params={"min_tokens": 150}).json()["items"]} == {"f-2", "f-3"}
    assert {i["request_id"] for i in
            client.get(f"{PL}/logs", params={"max_tokens": 150}).json()["items"]} == {"f-1"}
    assert {i["request_id"] for i in
            client.get(f"{PL}/logs", params={"min_cost": 0.002}).json()["items"]} == {"f-2"}
    assert {i["request_id"] for i in
            client.get(f"{PL}/logs", params={"max_cost": 0.002}).json()["items"]} == {"f-1"}
    combined = client.get(f"{PL}/logs",
                          params={"trace_id": "T-A", "session_key": "sess-y"}).json()["items"]
    assert [i["request_id"] for i in combined] == ["f-2"]

    assert client.get(f"{PL}/logs", params={"level": "bogus"}).status_code == 422
    assert client.get(f"{PL}/logs", params={"status": "bogus"}).status_code == 422


def test_colliding_session_key_isolated_per_workspace(
        client: TestClient, db: Session, user_factory) -> None:
    """A4: same session_key string in two orgs never mixes in listing."""
    root = user_factory()
    oid_a = _org(client, "Sess A")
    member = _other("ledger-sess@tollma.ai")
    oid_b = _org(member, "Sess B")
    _invite(client, member, db, oid_a)
    _assign(client, oid_a, _me(member)["id"], [_set(client, oid_a, "Read", ["PromptLogs.Read"])])

    for c, oid in ((client, oid_a), (member, oid_b)):
        r = c.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                          "mode": "global", "capture_input": True,
                                          "capture_output": True})
        assert r.status_code == 200, r.text
    uid = uuid.UUID(root["id"])
    key = _mk_key(db, uid, uuid.UUID(oid_a))
    db.commit()
    assert capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        org_id=uuid.UUID(oid_a), api_key_id=key.id,
        key_provenance="organization", endpoint="chat", source="external",
        request_id="sess-a-1", session_key="sess-shared",
        status="completed") is not None
    muid = uuid.UUID(_me(member)["id"])
    mkey = _mk_key(db, muid, uuid.UUID(oid_b))
    db.commit()
    assert capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=muid,
        org_id=uuid.UUID(oid_b), api_key_id=mkey.id,
        key_provenance="organization", endpoint="chat", source="external",
        request_id="sess-b-1", session_key="sess-shared", status="completed") is not None

    got_a = member.get(f"{PL}/logs", params={"org_id": oid_a,
                                             "session_key": "sess-shared"}).json()["items"]
    assert [i["request_id"] for i in got_a] == ["sess-a-1"]
    got_b = member.get(f"{PL}/logs", params={"org_id": oid_b,
                                             "session_key": "sess-shared"}).json()["items"]
    assert [i["request_id"] for i in got_b] == ["sess-b-1"]


def test_trace_detail_cross_org_404(client: TestClient, db: Session, user_factory) -> None:
    """A1/A2: ledger row id + trace filter scoped per workspace (404 oracle)."""
    root = user_factory()
    oid_a = _org(client, "Trace A")
    r = client.put(f"{PL}/settings", json={"org_id": oid_a, "enabled": True,
                                           "mode": "global", "capture_input": True,
                                           "capture_output": True})
    assert r.status_code == 200, r.text
    uid = uuid.UUID(root["id"])
    key = _mk_key(db, uid, uuid.UUID(oid_a))
    db.commit()
    row = capture_engine.capture_post(
        db, input_text="org-in", output_text="org-out", user_id=uid,
        org_id=uuid.UUID(oid_a), api_key_id=key.id,
        key_provenance="organization", endpoint="chat", source="external",
        request_id="trace-org-1", trace_id="T-org-1", status="completed")
    assert row is not None

    stranger = _other("ledger-trace@tollma.ai")
    assert stranger.get(f"{PL}/logs/{row.id}").status_code == 404  # personal scope
    oid_b = _org(stranger, "Trace B")
    assert stranger.get(f"{PL}/logs/{row.id}",
                        params={"org_id": oid_b}).status_code == 404
    # Trace filter under another workspace: empty, no org_a bytes.
    assert stranger.get(f"{PL}/logs", params={"org_id": oid_b,
                                              "trace_id": "T-org-1"}).json()["items"] == []
    # Owner reads fine.
    assert client.get(f"{PL}/logs/{row.id}",
                      params={"org_id": oid_a}).status_code == 200


# --- precedence ---------------------------------------------------------------


def test_zero_retention_vetoes_enabled_capture(
        client: TestClient, db: Session, user_factory) -> None:
    """B3: zero_retention wins over an enabled workspace policy."""
    user = user_factory()
    _enable_personal(client)
    uid = uuid.UUID(user["id"])
    ok = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="veto-0",
        status="completed")
    assert ok is not None

    r = client.put("/api/v1/privacy/retention",
                   json={"data_category": "prompt_logs", "zero_retention": True})
    assert r.status_code == 200, r.text
    assert capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="veto-1",
        status="completed") is None
    assert resolution_engine.resolve_setting(db, user_id=uid).setting is None


def test_zero_retention_check_fail_closed_on_db_error(db: Session) -> None:
    """Fail-closed: a DB blip suppresses capture (never leaks past a veto)."""
    from unittest.mock import patch

    with patch.object(db, "scalars", side_effect=RuntimeError("db down")):
        assert resolution_engine._zero_retention_applies(
            db, uuid.uuid4(), None) is True


def test_org_zero_retention_vetoes_org_capture(
        client: TestClient, db: Session, user_factory) -> None:
    root = user_factory()
    oid = _org(client, "Veto Org")
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "global", "capture_input": True,
                                           "capture_output": True})
    assert r.status_code == 200, r.text
    uid = uuid.UUID(root["id"])
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    kwargs = dict(input_text="in", output_text="out", user_id=uid,
                  org_id=uuid.UUID(oid), api_key_id=key.id,
                  key_provenance="organization", endpoint="chat",
                  source="external", status="completed")
    assert capture_engine.capture_post(db, request_id="veto-org-0", **kwargs) is not None

    r = client.put("/api/v1/privacy/retention",
                   json={"data_category": "prompt_logs", "zero_retention": True,
                         "org_id": oid})
    assert r.status_code == 200, r.text
    assert capture_engine.capture_post(db, request_id="veto-org-1", **kwargs) is None


def test_retention_days_stamps_expires(client: TestClient, db: Session, user_factory) -> None:
    """B10: expires_at ≈ now + retention_days; later edits don't restamp."""
    from datetime import datetime, timedelta, timezone

    user = user_factory()
    _enable_personal(client, retention_days=30)
    uid = uuid.UUID(user["id"])
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="exp-1",
        status="completed")
    assert row is not None and row.expires_at is not None
    assert timedelta(days=29) < row.expires_at - datetime.now(timezone.utc) < timedelta(days=31)
    first_expiry = row.expires_at

    _enable_personal(client, retention_days=7)  # policy edit: old row untouched
    db.refresh(row)
    assert row.expires_at == first_expiry


def test_prec_org_ignores_personal_setting(client: TestClient, db: Session, user_factory) -> None:
    """B2: org-key traffic never resolves the personal setting and vice versa."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client, "Prec Org")
    _enable_personal(client)  # personal ON, org has no setting (disabled)
    org_key = _mk_key(db, uid, uuid.UUID(oid))
    personal_key = _mk_key(db, uid)
    db.commit()

    assert resolution_engine.resolve_setting(
        db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=org_key.id,
        key_provenance="organization").setting is None
    assert resolution_engine.resolve_setting(
        db, user_id=uid, api_key_id=personal_key.id,
        key_provenance="personal").setting is not None
