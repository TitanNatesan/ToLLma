"""Acceptance gaps for workspace prompt logging (no overlap with existing suites).

Covers: personal/org enabled+disabled end-to-end, team-targeting matrix,
multi-org key provenance, unauthorized-member gates, forged filter/workspace
oracles, cross-workspace detail oracles, purge-before cutoff, pagination walk
+ filter composition, Anthropic non-stream/stream shape + request-ID
correlation, OpenAI request-ID correlation, internal cancel -> partial.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.public_gateway import service as pg_service
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.message import MessageStatus
from tollms.models.organization import (
    Invitation,
    Membership,
    MembershipState,
    Team,
    TeamMembership,
)
from tollms.models.prompt_logging import PromptLog, PromptLoggingSetting
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk
from tollms.services.prompt_logging import capture as capture_engine

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"


def _other(email: str) -> TestClient:
    from tollms.main import app as _app

    c = TestClient(_app)
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        c.get("/auth/verify", params={"token": token})
    return c


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _invite(root: TestClient, member: TestClient, db: Session, oid: str) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _me(member)["email"], "set_ids": []})
    assert inv.status_code == 201, inv.text
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(row)
    acc = member.post(f"{ORG}/invitations/by-token/{row.token}/accept")
    assert acc.status_code == 200, acc.text


def _mk_org_rows(db: Session, owner_id: uuid.UUID, name: str = "R"):
    from tollms.models.organization import Organization

    org = Organization(name=name, slug=f"{name}-{uuid.uuid4().hex[:8]}".lower(),
                       root_user_id=owner_id)
    db.add(org)
    db.flush()
    mem = Membership(org_id=org.id, user_id=owner_id, is_root=True,
                     state=MembershipState.ACTIVE.value)
    db.add(mem)
    db.flush()
    return org, mem


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"k-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _mk_team(db: Session, org_id, name: str = "T") -> Team:
    team = Team(org_id=org_id, name=f"{name}-{uuid.uuid4().hex[:6]}")
    db.add(team)
    db.flush()
    return team


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


def _latest_api_log(db: Session, key_id: str) -> ApiRequestLog | None:
    db.expire_all()
    return db.scalar(select(ApiRequestLog).where(
        ApiRequestLog.api_key_id == uuid.UUID(key_id)).order_by(
        ApiRequestLog.created_at.desc()))


# --- personal / org-global enabled + disabled --------------------------------

def test_accept_personal_disabled_writes_no_row(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    client.put(f"{PL}/settings", json={"enabled": False, "capture_input": True,
                                       "capture_output": True})
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="acc-pd", status="completed")
    assert row is None
    assert db.scalars(select(PromptLog)).all() == []

    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="acc-pe", status="completed")
    assert row is not None and row.workspace_type == "personal"


def test_accept_org_global_disabled_writes_no_row(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org, _ = _mk_org_rows(db, uid, "GD")
    db.commit()
    setting = PromptLoggingSetting(org_id=org.id, user_id=None, enabled=False,
                                   mode="global", capture_input=True,
                                   capture_output=True)
    db.add(setting)
    db.commit()
    key = _mk_key(db, uid, org.id)
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid, org_id=org.id,
        api_key_id=key.id, key_provenance="organization",
        endpoint="chat", source="external", request_id="acc-gd", status="completed")
    assert row is None
    assert db.scalars(select(PromptLog)).all() == []

    setting.enabled = True
    db.commit()
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid, org_id=org.id,
        api_key_id=key.id, key_provenance="organization",
        endpoint="chat", source="external", request_id="acc-ge", status="completed")
    assert row is not None and row.workspace_type == "organization"
    assert row.org_id == org.id and row.key_provenance == "organization"


# --- team-targeting matrix -----------------------------------------------------

def test_accept_team_targeting_matrix(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org, owner_mem = _mk_org_rows(db, uid, "TM")
    team = _mk_team(db, org.id)
    mate = user_factory("pl-mate@tollma.ai")
    mate_uid = uuid.UUID(mate["id"])
    mate_mem = Membership(org_id=org.id, user_id=mate_uid, is_root=False,
                          state=MembershipState.ACTIVE.value)
    db.add(mate_mem)
    db.flush()
    setting = PromptLoggingSetting(org_id=org.id, user_id=None, enabled=True,
                                   mode="teams", capture_input=True,
                                   capture_output=True)
    db.add(setting)
    db.flush()
    from tollms.models.prompt_logging import PromptLoggingTeamTarget
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id))
    db.commit()
    owner_key = _mk_key(db, uid, org.id)
    mate_key = _mk_key(db, mate_uid, org.id)

    # Non-selected-team member (owner not in team): NOT logged.
    assert capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid, org_id=org.id,
        api_key_id=owner_key.id, key_provenance="organization",
        endpoint="chat", source="external", request_id="acc-t0",
        status="completed") is None

    # Selected-team member with ORG key: logged with team tag.
    db.add(TeamMembership(team_id=team.id, membership_id=mate_mem.id))
    db.commit()
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=mate_uid, org_id=org.id,
        api_key_id=mate_key.id, key_provenance="organization",
        endpoint="chat", source="external", request_id="acc-t1", status="completed")
    assert row is not None and row.org_id == org.id
    assert str(team.id) in (row.team_ids or [])

    # Same member with PERSONAL key, personal logging off: NOT org-logged, no row.
    personal_key = _mk_key(db, mate_uid)
    assert capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=mate_uid,
        api_key_id=personal_key.id, key_provenance="personal",
        endpoint="chat", source="internal", request_id="acc-t2",
        status="completed") is None
    assert db.scalars(select(PromptLog)).all() != []  # only the org row exists
    assert db.scalar(select(PromptLog).where(
        PromptLog.request_id == "acc-t2")) is None

    # Personal logging on: same personal key lands in the personal workspace only.
    db.add(PromptLoggingSetting(user_id=mate_uid, org_id=None, enabled=True,
                               capture_input=True, capture_output=True))
    db.commit()
    prow = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=mate_uid,
        api_key_id=personal_key.id, key_provenance="personal",
        endpoint="chat", source="internal", request_id="acc-t3", status="completed")
    assert prow is not None and prow.org_id is None
    assert prow.workspace_type == "personal"


# --- multi-org provenance -------------------------------------------------------

def test_accept_multi_org_key_never_lands_in_other_org(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid_a = client.post(ORG, json={"name": "Acc A"}).json()["id"]
    oid_b = client.post(ORG, json={"name": "Acc B"}).json()["id"]
    for oid in (oid_a, oid_b):
        r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                               "mode": "global", "capture_input": True,
                                               "capture_output": True})
        assert r.status_code == 200, r.text
    # Key row lives in org B; the org_id hint says A — the key row wins.
    key_b = _mk_key(db, uid, uuid.UUID(oid_b))
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        org_id=uuid.UUID(oid_a), api_key_id=key_b.id,
        key_provenance="organization", endpoint="chat", source="external",
        request_id="acc-mo", status="completed")
    assert row is not None and row.org_id == uuid.UUID(oid_b)

    body_a = client.get(f"{PL}/logs", params={"org_id": oid_a}).json()["items"]
    assert all(r["id"] != str(row.id) for r in body_a)
    body_b = client.get(f"{PL}/logs", params={"org_id": oid_b}).json()["items"]
    assert str(row.id) in [r["id"] for r in body_b]


# --- unauthorized member --------------------------------------------------------

def test_accept_member_without_perms_cannot_view_or_update(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    oid = client.post(ORG, json={"name": "Acc Gates"}).json()["id"]
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global",
                                       "capture_input": True, "capture_output": True})
    member = _other("pl-noperm@tollma.ai")
    _invite(client, member, db, oid)

    assert member.get(f"{PL}/logs", params={"org_id": oid}).status_code == 404
    assert member.put(f"{PL}/settings",
                      json={"org_id": oid, "enabled": False}).status_code == 404
    assert member.post(f"{PL}/logs/purge", json={},
                       params={"org_id": oid}).status_code == 404
    assert member.get(f"{PL}/retention", params={"org_id": oid}).status_code == 404


# --- forged workspace / filter IDs ----------------------------------------------

def test_accept_forged_workspace_and_filter_ids(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = client.post(ORG, json={"name": "Acc Forge"}).json()["id"]
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global",
                                       "capture_input": True, "capture_output": True})
    key = _mk_key(db, uid, uuid.UUID(oid))
    log_row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        org_id=uuid.UUID(oid), api_key_id=key.id, key_provenance="organization",
        endpoint="chat", source="external", request_id="acc-f0", status="completed")
    assert log_row is not None

    # Forged workspace: random org the caller never joined.
    assert client.get(f"{PL}/logs",
                      params={"org_id": str(uuid.uuid4())}).status_code == 404
    # Personal scope has no teams: any team_id is a 404 oracle.
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    assert client.get(f"{PL}/logs",
                      params={"team_id": str(uuid.uuid4())}).status_code == 404
    # Org scope, forged non-member user and foreign (personal) key.
    assert client.get(f"{PL}/logs", params={"org_id": oid,
                                             "user_id": str(uuid.uuid4())}).status_code == 404
    personal_key = _mk_key(db, uid)
    assert client.get(f"{PL}/logs", params={"org_id": oid,
                                             "key_id": str(personal_key.id)}).status_code == 404
    # And none of the forgeries leak the real row.
    assert client.get(f"{PL}/logs/{log_row.id}",
                      params={"org_id": str(uuid.uuid4())}).status_code == 404


# --- cross-workspace detail -------------------------------------------------------

def test_accept_cross_workspace_detail_oracles(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid_a = client.post(ORG, json={"name": "Acc XA"}).json()["id"]
    oid_b = client.post(ORG, json={"name": "Acc XB"}).json()["id"]
    for oid in (oid_a, oid_b):
        client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "global", "capture_input": True,
                                           "capture_output": True})
    key_a = _mk_key(db, uid, uuid.UUID(oid_a))
    row = capture_engine.capture_post(
        db, input_text="org-in", output_text="org-out", user_id=uid,
        org_id=uuid.UUID(oid_a), api_key_id=key_a.id,
        key_provenance="organization", endpoint="chat", source="external",
        request_id="acc-x0", status="completed")
    assert row is not None

    # Org row viewed from the personal scope: 404.
    assert client.get(f"{PL}/logs/{row.id}").status_code == 404
    # Org A row viewed under org B: 404.
    assert client.get(f"{PL}/logs/{row.id}",
                      params={"org_id": oid_b}).status_code == 404
    # Sanity: visible under its own org for root.
    assert client.get(f"{PL}/logs/{row.id}",
                      params={"org_id": oid_a}).status_code == 200


# --- purge before cutoff + retention metadata --------------------------------------

def test_accept_purge_before_cutoff_only_expires_old_rows(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    old = capture_engine.capture_post(
        db, input_text="old-in", output_text="old-out", user_id=uid,
        endpoint="chat", source="internal", request_id="acc-u0", status="completed")
    new = capture_engine.capture_post(
        db, input_text="new-in", output_text="new-out", user_id=uid,
        endpoint="chat", source="internal", request_id="acc-u1", status="completed")
    db.execute(PromptLog.__table__.update().where(PromptLog.id == old.id).values(
        created_at=datetime.now(timezone.utc) - timedelta(days=3)))
    db.commit()

    before = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = client.post(f"{PL}/logs/purge", json={"before": before})
    assert r.status_code == 200, r.text
    assert r.json()["expired_count"] == 1
    db.refresh(old)
    db.refresh(new)
    assert old.content_expired is True and old.input_cipher is None
    assert old.request_id == "acc-u0"  # metadata kept
    assert new.content_expired is False and new.input_cipher is not None


# --- pagination walk + filter composition -------------------------------------------

def test_accept_pagination_walk_stable_and_composed(client: TestClient, db: Session, user_factory,
                                                    provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})
    p = provider_factory("AccPag")
    m = model_factory(p["id"])
    for i in range(7):
        capture_engine.capture_post(
            db, input_text=f"in-{i}", output_text=f"out-{i}", user_id=uid,
            provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
            endpoint="chat", source="internal", request_id=f"acc-p{i:03d}",
            status="completed" if i % 2 == 0 else "failed")

    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        r = client.get(f"{PL}/logs", params=params)
        assert r.status_code == 200, r.text
        seen.extend(row["id"] for row in r.json()["items"])
        cursor = r.headers.get("X-Next-Cursor")
        if not cursor:
            break
    assert len(seen) == 7 and len(set(seen)) == 7  # stable, no dup/miss

    r = client.get(f"{PL}/logs", params={"provider_id": p["id"],
                                         "model_id": m["id"],
                                         "status": "failed",
                                         "q": "acc-p001"})
    assert r.status_code == 200, r.text
    assert [row["request_id"] for row in r.json()["items"]] == ["acc-p001"]


# --- external planes: Anthropic + OpenAI correlation ----------------------------------

def test_accept_anthropic_nonstream_shape_usage_and_request_correlation(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    user_factory()
    p = provider_factory("AccAnth")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, kid = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    r = client.post("/v1/messages",
                    json={"model": "AccAnth/mock-model", "max_tokens": 64,
                          "messages": [{"role": "user", "content": "hello anthropic"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "message" and body["stop_reason"] == "end_turn"
    assert body["content"][0]["text"] == "Hello world"
    assert body["usage"] == {"input_tokens": 10, "output_tokens": 5}

    rows = _rows(db)
    assert len(rows) == 1 and rows[0].source == "external"
    assert rows[0].status == "completed" and rows[0].endpoint == "messages"
    api_row = _latest_api_log(db, kid)
    assert api_row is not None and rows[0].request_id == api_row.request_id


def test_accept_anthropic_streaming_terminal_captures(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    user_factory()
    p = provider_factory("AccAnthS")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, _ = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    with client.stream("POST", "/v1/messages",
                       json={"model": "AccAnthS/mock-model", "max_tokens": 64,
                             "messages": [{"role": "user", "content": "stream me"}],
                             "stream": True},
                       headers={"Authorization": f"Bearer {raw}"}) as r:
        assert r.status_code == 200, r.text
        text = r.read().decode()
    assert "content_block_delta" in text and "message_stop" in text
    assert "Hello" in text  # Anthropic SSE shape preserved

    rows = _rows(db)
    assert len(rows) == 1 and rows[0].status == "completed"
    from tollms.api.prompt_logging.settings import decrypt_body
    assert decrypt_body(rows[0].output_cipher) == "Hello world"


def test_accept_openai_request_id_correlation(
        client: TestClient, db: Session, user_factory, provider_factory,
        model_factory, monkeypatch) -> None:
    user_factory()
    p = provider_factory("AccCorr")
    model_factory(p["id"])
    _bind_public(monkeypatch, _FakeChatAdapter([]))
    raw, kid = _make_key(client)
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    r = client.post("/v1/chat/completions",
                    json={"model": "AccCorr/mock-model",
                          "messages": [{"role": "user", "content": "correlate me"}]},
                    headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"] == "Hello world"

    rows = _rows(db)
    assert len(rows) == 1
    api_row = _latest_api_log(db, kid)
    assert api_row is not None
    assert rows[0].request_id == api_row.request_id
    assert rows[0].request_id  # non-empty correlation id


# --- internal streaming cancel -> partial ----------------------------------------------

def test_accept_internal_cancel_maps_to_partial_row(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": True,
                                       "capture_output": True})

    assert generation_engine._promptlog_status(
        MessageStatus.CANCELLED, "half-done") == "partial"
    assert generation_engine._promptlog_status(
        MessageStatus.CANCELLED, "   ") == "cancelled"

    partial = capture_engine.capture_post(
        db, input_text="in", output_text="half-done", user_id=uid,
        endpoint="chat", source="internal", request_id="acc-c0", status="partial")
    cancelled = capture_engine.capture_post(
        db, input_text="in", output_text="", user_id=uid,
        endpoint="chat", source="internal", request_id="acc-c1", status="cancelled")
    assert partial is not None and partial.status == "partial"
    from tollms.api.prompt_logging.settings import decrypt_body
    assert decrypt_body(partial.output_cipher) == "half-done"
    assert cancelled is not None and cancelled.status == "cancelled"
