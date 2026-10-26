"""Prompt-logging acceptance gaps, round 2.

Covers items the earlier suites (test_prompt_logging*.py, ~53 tests) leave
open: cross-org team filter oracle, non-member user filter oracle, org purge
before-cutoff + audit, OpenAI Responses shape preservation (non-stream +
stream) with logging on, external-plane fail-open on persistence failure,
input-only/output-only via live requests, and internal streaming cancel ->
partial row through the real generation driver (not capture_post directly).
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as chat_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.prompt_logging.settings import decrypt_body
from tollms.api.public_gateway import service as pg_service
from tollms.models.api_key import ApiKey
from tollms.models.organization import (
    AuditLog,
    Invitation,
    Membership,
    MembershipState,
    Team,
    TeamMembership,
)
from tollms.models.prompt_logging import PromptLog, PromptLoggingSetting
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatResult, StreamChunk

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _other(email: str) -> TestClient:
    from tollms.main import app as _app

    c = TestClient(_app)
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        c.get("/auth/verify", params={"token": token})
    return c


def _invite(root: TestClient, member: TestClient, db: Session, oid: str) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _me(member)["email"], "set_ids": []})
    assert inv.status_code == 201, inv.text
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(row)
    acc = member.post(f"{ORG}/invitations/by-token/{row.token}/accept")
    assert acc.status_code == 200, acc.text


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"k-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _rows(db: Session) -> list:
    db.expire_all()
    return list(db.scalars(select(PromptLog).order_by(PromptLog.created_at)))


class _FakeChatAdapter:
    def __init__(self, calls: list, error=None) -> None:
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


def _bind_public(monkeypatch, adapter) -> list:
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: adapter)
    return adapter._calls


def _make_key(client: TestClient) -> tuple[str, str]:
    r = client.post("/api/v1/keys", json={"name": f"PL key {uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    return r.json()["raw_key"], r.json()["key"]["id"]


# --- forged filter oracles: cross-org team, non-member user --------------------


def test_gap_cross_org_team_filter_404(client: TestClient, db: Session, user_factory) -> None:
    """A team_id from org B filtered under org A is a 404 oracle (never leaks)."""
    user = user_factory()
    oid_a = client.post(ORG, json={"name": "Gap Forge A"}).json()["id"]
    oid_b = client.post(ORG, json={"name": "Gap Forge B"}).json()["id"]
    for oid in (oid_a, oid_b):
        r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                               "mode": "global", "capture_input": True,
                                               "capture_output": True})
        assert r.status_code == 200, r.text
    team_b = client.post(f"{ORG}/{oid_b}/teams", json={"name": "Bee"}).json()
    # Valid team under its own org: 200 (empty list, no leak either way).
    assert client.get(f"{PL}/logs", params={"org_id": oid_b,
                                            "team_id": team_b["id"]}).status_code == 200
    # Same team id under org A: 404.
    assert client.get(f"{PL}/logs", params={"org_id": oid_a,
                                            "team_id": team_b["id"]}).status_code == 404


def test_gap_nonmember_user_filter_404(client: TestClient, db: Session, user_factory) -> None:
    """A real user's id who never joined the org is a 404 oracle as user_id."""
    user_factory()
    oid = client.post(ORG, json={"name": "Gap Forge U"}).json()["id"]
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global",
                                       "capture_input": True, "capture_output": True})
    outsider = _other("pl-outsider@tollma.ai")
    outsider_id = _me(outsider)["id"]
    assert client.get(f"{PL}/logs", params={"org_id": oid,
                                            "user_id": outsider_id}).status_code == 404


# --- org purge: before-cutoff + audit -------------------------------------------


def test_gap_org_purge_before_cutoff_and_audit(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = client.post(ORG, json={"name": "Gap Purge"}).json()["id"]
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global",
                                       "capture_input": True, "capture_output": True})
    from tollms.services.prompt_logging import capture as capture_engine

    old = capture_engine.capture_post(
        db, input_text="old-in", output_text="old-out", user_id=uid,
        org_id=uuid.UUID(oid), key_provenance="organization",
        endpoint="chat", source="external", request_id="gap-u0", status="completed")
    new = capture_engine.capture_post(
        db, input_text="new-in", output_text="new-out", user_id=uid,
        org_id=uuid.UUID(oid), key_provenance="organization",
        endpoint="chat", source="external", request_id="gap-u1", status="completed")
    assert old is not None and new is not None
    db.execute(PromptLog.__table__.update().where(PromptLog.id == old.id).values(
        created_at=datetime.now(timezone.utc) - timedelta(days=3)))
    db.commit()

    before = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = client.post(f"{PL}/logs/purge", json={"before": before}, params={"org_id": oid})
    assert r.status_code == 200, r.text
    assert r.json()["expired_count"] == 1
    db.refresh(old)
    db.refresh(new)
    assert old.content_expired is True and old.input_cipher is None
    assert old.request_id == "gap-u0"  # metadata kept
    assert new.content_expired is False and new.input_cipher is not None
    assert db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.purge")) is not None


# --- external plane: OpenAI Responses shape preservation with logging ----------


def test_gap_responses_nonstream_shape_and_row(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    user_factory()
    p = provider_factory("GapResp")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    r = client.post("/v1/responses",
                    json={"model": "GapResp/mock-model", "input": "hello responses"},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["object"] == "response" and body["status"] == "completed"
    assert body["output_text"] == "Hello world"
    assert body["output"][0]["content"] == [{"type": "output_text",
                                             "text": "Hello world", "annotations": []}]
    assert body["usage"] == {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}

    rows = _rows(db)
    assert len(rows) == 1 and rows[0].source == "external"
    assert rows[0].endpoint == "responses" and rows[0].status == "completed"
    assert decrypt_body(rows[0].input_cipher) == "hello responses"
    assert decrypt_body(rows[0].output_cipher) == "Hello world"


def test_gap_responses_streaming_shape_and_row(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    user_factory()
    p = provider_factory("GapRespS")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    with client.stream("POST", "/v1/responses",
                       json={"model": "GapRespS/mock-model", "input": "hello",
                             "stream": True},
                       headers={"Authorization": f"Bearer {raw}"}) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    assert "response.created" in text
    assert "response.output_text.delta" in text
    assert "response.completed" in text
    assert "data: [DONE]" not in text  # only the OpenAI chat shape sends [DONE]

    rows = _rows(db)
    assert len(rows) == 1 and rows[0].status == "completed"
    assert rows[0].endpoint == "responses"
    assert decrypt_body(rows[0].output_cipher) == "Hello world"


# --- external plane fail-open ---------------------------------------------------


def test_gap_external_fail_open_on_persistence_failure(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """Storage outage in capture never breaks the public response (still 200)."""
    user_factory()
    p = provider_factory("GapOpen")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    from tollms.services.prompt_logging import capture as capture_engine

    async def _boom(*a, **k):
        raise RuntimeError("storage down")

    monkeypatch.setattr(capture_engine, "capture_post_async", _boom)
    r = client.post("/v1/chat/completions",
                    json={"model": "GapOpen/mock-model",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"] == "Hello world"


# --- input-only / output-only via live requests ----------------------------------


def test_gap_live_input_only_and_output_only(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    user_factory()
    p = provider_factory("GapFlags")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)

    def _live(content: str) -> object:
        r = client.post("/v1/chat/completions",
                        json={"model": "GapFlags/mock-model",
                              "messages": [{"role": "user", "content": content}]},
                        headers={"Authorization": f"Bearer {raw}"})
        assert r.status_code == 200, r.text
        return _rows(db)[-1]

    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": False})
    row_in = _live("flag-in")
    assert decrypt_body(row_in.input_cipher) == "flag-in"
    assert row_in.output_cipher is None

    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": False,
                                       "capture_output": True})
    row_out = _live("flag-out")
    assert row_out.input_cipher is None
    assert decrypt_body(row_out.output_cipher) == "Hello world"

    listed = client.get(f"{PL}/logs").json()["items"]
    by_req = {row["id"]: row for row in listed}
    assert by_req[str(row_in.id)]["fields"] == ["input"]
    assert by_req[str(row_out.id)]["fields"] == ["output"]


# --- internal streaming cancel -> partial via the real driver ---------------------


class _SlowAdapter(BaseProviderAdapter):
    def __init__(self, chunks: list[str], delay: float = 0.0) -> None:
        super().__init__(credentials={}, model_id="slow-mock")
        self._chunks = chunks
        self._delay = delay

    async def chat_stream(self, messages):
        for text in self._chunks:
            if self._delay:
                await asyncio.sleep(self._delay)
            yield StreamChunk(delta=text)


def test_gap_internal_cancel_partial_via_real_driver(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    """Cancel mid-stream through start/cancel_generation: ledger row is partial
    with the actually-delivered prefix (real driver, nothing mocked)."""
    from sqlalchemy.orm import sessionmaker

    from tollms.api.conversations.service import get_message

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("GapCancel")
    m = model_factory(p["id"])
    _, kid = _make_key(client)
    full = "".join(f"chunk{i} " for i in range(30))
    monkeypatch.setattr(chat_service, "build_adapter",
                        lambda *a, **k: _SlowAdapter([f"chunk{i} " for i in range(30)],
                                                     delay=0.02))
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    maker = sessionmaker(bind=db.get_bind())

    async def _main():
        started = await chat_service.start_generation(
            db, ChatRequest(provider_id=uuid.UUID(p["id"]),
                            model_id=uuid.UUID(m["id"]), message="go",
                            key_id=uuid.UUID(kid)),
            None, uid)
        for _ in range(200):
            session = maker()
            try:
                if get_message(session, started.message_id).content:
                    break
            finally:
                session.close()
            await asyncio.sleep(0.01)
        cancelled = await chat_service.cancel_generation(db, started.generation_id)
        assert cancelled.status == "cancelled"
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_main())
    db.expire_all()
    row = db.scalar(select(PromptLog).where(
        PromptLog.generation_id == started.generation_id))
    assert row is not None
    assert row.status == "partial" and row.source == "internal"
    delivered = decrypt_body(row.output_cipher)
    assert delivered and 0 < len(delivered) < len(full)
    session = maker()
    try:
        assert get_message(session, started.message_id).content == delivered
    finally:
        session.close()
