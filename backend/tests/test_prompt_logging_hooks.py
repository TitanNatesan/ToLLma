"""Prompt-log capture hooks: internal, generation driver, public planes."""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as chat_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.prompt_logging.settings import decrypt_body
from tollms.api.public_gateway import service as pg_service
from tollms.core.exceptions import ProviderError
from tollms.models.message import MessageStatus
from tollms.models.prompt_logging import PromptLog
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk
from tollms.services.prompt_logging import capture as capture_engine

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"


def _run(coro):
    return asyncio.run(coro)


class _FakeChatAdapter:
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


def _bind_chat(monkeypatch, adapter: _FakeChatAdapter) -> list:
    monkeypatch.setattr(chat_service, "build_adapter", lambda *a, **k: adapter)
    return adapter._calls  # noqa: SLF001


def _bind_public(monkeypatch, adapter: _FakeChatAdapter) -> list:
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: adapter)
    return adapter._calls  # noqa: SLF001


def _make_key(client: TestClient) -> tuple[str, str]:
    r = client.post("/api/v1/keys", json={"name": f"PL key {uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    return r.json()["raw_key"], r.json()["key"]["id"]


def _chat_req(pid: str, mid: str, kid: str) -> ChatRequest:
    return ChatRequest(provider_id=uuid.UUID(pid), model_id=uuid.UUID(mid),
                       message="hook input", key_id=uuid.UUID(kid))


def _rows(db: Session) -> list:
    db.expire_all()
    return list(db.scalars(select(PromptLog).order_by(PromptLog.created_at)))


# --- internal gateway ---------------------------------------------------------


def test_internal_run_chat_captures(client: TestClient, db: Session, user_factory,
                                    provider_factory, model_factory,
                                    monkeypatch: pytest.MonkeyPatch) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p, m = provider_factory("HookP"), None
    m = model_factory(p["id"])
    raw, kid = _make_key(client)
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    result = _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), None,
                                        user_id=uid))
    assert result.content == "Hello world"

    rows = _rows(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.workspace_type == "personal" and row.source == "internal"
    assert row.status == "completed" and row.content_expired is False
    assert decrypt_body(row.input_cipher) == "hook input"
    assert decrypt_body(row.output_cipher) == "Hello world"
    assert row.prompt_tokens == 10 and row.completion_tokens == 5
    assert row.api_key_id == uuid.UUID(kid)


def test_internal_run_chat_failed_records_input(client: TestClient, db: Session,
                                                 user_factory, provider_factory,
                                                 model_factory,
                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("HookFail")
    m = model_factory(p["id"])
    _, kid = _make_key(client)
    _bind_chat(monkeypatch, _FakeChatAdapter([], error=ProviderError("boom")))
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    with pytest.raises(Exception):
        _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), None,
                                    user_id=uid))
    rows = _rows(db)
    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert decrypt_body(rows[0].input_cipher) == "hook input"
    assert rows[0].output_cipher is None and rows[0].error_code


def test_internal_hook_fail_open(client: TestClient, db: Session, user_factory,
                                  provider_factory, model_factory,
                                  monkeypatch: pytest.MonkeyPatch) -> None:
    """Persistence failure in capture never breaks the generation (200)."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("HookOpen")
    m = model_factory(p["id"])
    _, kid = _make_key(client)
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    def _boom(*a, **k):
        raise RuntimeError("storage down")

    monkeypatch.setattr(capture_engine, "capture_post_sync", _boom)
    result = _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), None,
                                        user_id=uid))
    assert result.content == "Hello world"  # generation still 200


def test_capture_sync_bridge_failure_is_skipped(db: Session) -> None:
    from unittest.mock import patch

    with patch.object(capture_engine.resolution_engine, "resolve_setting",
                      side_effect=RuntimeError("db down")):
        assert capture_engine.capture_post_sync(
            db, input_text="x", output_text="y", user_id=uuid.uuid4(),
            endpoint="chat") == "skipped"


# --- generation driver mapping --------------------------------------------------


def test_promptlog_status_mapping() -> None:
    assert generation_engine._promptlog_status(MessageStatus.COMPLETED, "hi") == "completed"
    assert generation_engine._promptlog_status(MessageStatus.FAILED, "hi") == "failed"
    assert generation_engine._promptlog_status(MessageStatus.CANCELLED, "part") == "partial"
    assert generation_engine._promptlog_status(MessageStatus.CANCELLED, "  ") == "cancelled"
    assert generation_engine._promptlog_status(MessageStatus.CANCELLED, "") == "cancelled"


def test_partial_status_row(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    row = capture_engine.capture_post(
        db, input_text="in", output_text="half", user_id=uid,
        endpoint="chat", source="internal", request_id="r-p", status="partial")
    assert row is not None and row.status == "partial"
    assert decrypt_body(row.output_cipher) == "half"


# --- public plane ---------------------------------------------------------------


def test_public_non_streaming_shape_and_usage_intact(client: TestClient, db: Session,
                                                      user_factory, provider_factory,
                                                      model_factory,
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    p = provider_factory("MockPub")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    r = client.post("/v1/chat/completions",
                    json={"model": "MockPub/mock-model",
                          "messages": [{"role": "user", "content": "hello"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["choices"][0]["message"]["content"] == "Hello world"
    assert body["usage"] == {"prompt_tokens": 10, "completion_tokens": 5,
                             "total_tokens": 15}  # usage untouched

    rows = _rows(db)
    assert len(rows) == 1
    assert rows[0].source == "external" and rows[0].status == "completed"
    assert decrypt_body(rows[0].input_cipher) == "hello"
    assert decrypt_body(rows[0].output_cipher) == "Hello world"


def test_public_streaming_terminal_captures(client: TestClient, db: Session,
                                             user_factory, provider_factory,
                                             model_factory,
                                             monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    p = provider_factory("MockPubS")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    with client.stream("POST", "/v1/chat/completions",
                       json={"model": "MockPubS/mock-model",
                             "messages": [{"role": "user", "content": "stream me"}],
                             "stream": True},
                       headers={"Authorization": f"Bearer {raw}"}) as r:
        assert r.status_code == 200, r.text
        text = r.read().decode()
    assert "Hello" in text and "DONE" in text  # OpenAI SSE shape preserved

    rows = _rows(db)
    assert len(rows) == 1 and rows[0].status == "completed"
    assert decrypt_body(rows[0].output_cipher) == "Hello world"


def test_public_failed_records_input(client: TestClient, db: Session, user_factory,
                                      provider_factory, model_factory,
                                      monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    p = provider_factory("MockPubF")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([], error=ProviderError("down")))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    r = client.post("/v1/chat/completions",
                    json={"model": "MockPubF/mock-model",
                          "messages": [{"role": "user", "content": "fail me"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code != 200
    rows = _rows(db)
    assert len(rows) == 1 and rows[0].status == "failed"
    assert decrypt_body(rows[0].input_cipher) == "fail me"


def test_public_personal_key_never_org_logged(client: TestClient, db: Session,
                                               user_factory, provider_factory,
                                               model_factory,
                                               monkeypatch: pytest.MonkeyPatch) -> None:
    """Org policy ON + personal key traffic => no org row, no row at all."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = client.post(ORG, json={"name": "Pub Org"}).json()["id"]
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global",
                                       "capture_input": True, "capture_output": True})
    p = provider_factory("MockPubP")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)  # personal key

    r = client.post("/v1/chat/completions",
                    json={"model": "MockPubP/mock-model",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    assert _rows(db) == []


# --- B7: internal-chat provenance (key row wins, never the provider hint) -----

from types import SimpleNamespace as _NS  # noqa: E402


def _mk_org_with_setting(db: Session, owner_id: uuid.UUID, name: str):
    from tollms.models.organization import Membership, MembershipState, Organization
    from tollms.models.prompt_logging import PromptLoggingSetting

    org = Organization(name=name, slug=f"{name}-{uuid.uuid4().hex[:8]}".lower(),
                       root_user_id=owner_id)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=owner_id, is_root=True,
                      state=MembershipState.ACTIVE.value))
    db.add(PromptLoggingSetting(org_id=org.id, user_id=None, enabled=True,
                               mode="global", capture_input=True,
                               capture_output=True))
    db.flush()
    return org


def _mk_key_row(db: Session, owner_id: uuid.UUID, org_id=None):
    from tollms.models.api_key import ApiKey

    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"hook-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _run_hook(db: Session, **kw) -> None:
    _run(chat_service._promptlog_capture(db, **kw))


def test_internal_hook_personal_provider_org_key_logs_org(
        client: TestClient, db: Session, user_factory) -> None:
    """B7: personal provider + org key must land in the org ledger.

    Pre-fix the provider-derived hint ("personal", no org) missed the org log
    entirely; the key row now governs, so the org setting captures it."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org = _mk_org_with_setting(db, uid, "HookOrg")
    key = _mk_key_row(db, uid, org.id)
    db.commit()

    _run_hook(db, input_text="in", output_text="out", user_id=uid,
              org_id=None,  # personal provider: org_attribution is None
              api_key=key, provider=_NS(id=None), model=_NS(id=None),
              conversation_id=None, request_id="b7-personal", generation_id=None,
              status="completed")

    rows = _rows(db)
    assert len(rows) == 1
    assert rows[0].org_id == org.id
    assert rows[0].key_provenance == "organization"
    assert decrypt_body(rows[0].output_cipher) == "out"


def test_internal_hook_provider_org_mismatch_attributes_key_org(
        client: TestClient, db: Session, user_factory) -> None:
    """B7: provider-org-A + key-org-B must log to B, never A.

    Pre-fix the provider hint won (row landed in A); the key row now wins."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org_a = _mk_org_with_setting(db, uid, "HookOrgA")
    org_b = _mk_org_with_setting(db, uid, "HookOrgB")
    key_b = _mk_key_row(db, uid, org_b.id)
    db.commit()

    _run_hook(db, input_text="in", output_text="out", user_id=uid,
              org_id=org_a.id,  # org-A provider: org_attribution says A
              api_key=key_b, provider=_NS(id=None), model=_NS(id=None),
              conversation_id=None, request_id="b7-mismatch", generation_id=None,
              status="completed")

    rows = _rows(db)
    assert len(rows) == 1
    assert rows[0].org_id == org_b.id
    assert rows[0].key_provenance == "organization"


# --- M2: guardrail-blocked output persistence on non-streaming paths -----------

WITHHELD = "[withheld by guardrail policy]"


def test_internal_run_chat_blocked_guardrail_withholds_ledger(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch: pytest.MonkeyPatch) -> None:
    """M2: non-streaming internal chat stores the withheld marker, not the
    blocked text (verdict threaded from the post hook, never re-evaluated)."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("HookBlock")
    m = model_factory(p["id"])
    _, kid = _make_key(client)
    _bind_chat(monkeypatch, _FakeChatAdapter([]))
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    monkeypatch.setattr(chat_service, "_guardrail_post",
                        lambda *a, **k: "blocked")

    result = _run(chat_service.run_chat(db, _chat_req(p["id"], m["id"], kid), None,
                                        user_id=uid))
    assert result.content == WITHHELD

    rows = _rows(db)
    assert len(rows) == 1
    assert decrypt_body(rows[0].input_cipher) == "hook input"
    assert decrypt_body(rows[0].output_cipher) == WITHHELD


def test_public_nonstreaming_blocked_withholds_ledger(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch: pytest.MonkeyPatch) -> None:
    """M2: non-streaming public chat stores the withheld marker, not the
    blocked text; the delivered body matches the ledger."""
    user_factory()
    p = provider_factory("MockPubBlock")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    monkeypatch.setattr(pg_service, "_guardrail_post",
                        lambda *a, **k: "blocked")

    r = client.post("/v1/chat/completions",
                    json={"model": "MockPubBlock/mock-model",
                          "messages": [{"role": "user", "content": "hello"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"] == WITHHELD

    rows = _rows(db)
    assert len(rows) == 1 and rows[0].status == "completed"
    assert decrypt_body(rows[0].output_cipher) == WITHHELD
