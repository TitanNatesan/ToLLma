"""In-app chat keys: primary lifecycle, key-gated gateway, picker endpoints, attribution."""

import asyncio
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.gateway.schemas import ChatRequest
from tollms.api.gateway import service as gateway_service
from tollms.api.keys.service import ensure_primary_key, sync_primary_model
from tollms.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from tollms.main import app
from tollms.models.api_key import ApiKey, ApiKeyModelPermission
from tollms.models.message import Message, Role
from tollms.models.message_history import GenerationRun
from tollms.models.request_log import RequestLog

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


def _transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chat/completions"
        return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler)


def _req(pid: str, mid: str, kid: uuid.UUID | None, **kw) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(pid), model_id=uuid.UUID(mid), message="hi",
        key_id=kid, **kw,
    )


def _primary_rows(db: Session, uid: uuid.UUID) -> list[ApiKey]:
    return list(
        db.scalars(
            select(ApiKey).where(
                ApiKey.user_id == uid, ApiKey.org_id.is_(None),
                ApiKey.is_primary.is_(True), ApiKey.is_deleted.is_(False),
            )
        )
    )


# --- primary lifecycle -------------------------------------------------------


def test_primary_auto_created_on_first_model(db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    primaries = _primary_rows(db, uid)
    assert len(primaries) == 1  # auto-provisioned on signup
    assert primaries[0].name == "Primary key" and primaries[0].is_primary is True
    assert primaries[0].is_default is True

    p = provider_factory("P1")
    m = model_factory(p["id"])

    keys = _primary_rows(db, uid)
    assert len(keys) == 1
    key = keys[0]
    assert key.name == "Primary key" and key.enabled is True
    assert key.policy is None and key.ip_rules == []
    perms = db.scalars(select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key.id)).all()
    assert len(perms) == 1
    assert perms[0].provider_id == uuid.UUID(p["id"]) and perms[0].model_id == uuid.UUID(m["id"])
    assert perms[0].enabled is True


def test_no_duplicate_primary_on_second_provider(db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p1 = provider_factory("P1")
    model_factory(p1["id"])
    p2 = provider_factory("P2")
    m2 = model_factory(p2["id"])

    assert len(_primary_rows(db, uid)) == 1
    key = _primary_rows(db, uid)[0]
    perms = db.scalars(select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key.id)).all()
    assert len(perms) == 2
    assert {str(r.provider_id) for r in perms} == {p1["id"], p2["id"]}
    assert any(str(r.model_id) == m2["id"] for r in perms)


def test_new_model_auto_added_and_sync_idempotent(db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")

    key = _primary_rows(db, uid)[0]
    assert {str(r.model_id) for r in key.model_permissions} == {m1["id"], m2["id"]}

    # Re-running the sync must not duplicate rows nor create primaries.
    for _ in range(3):
        sync_primary_model(db, user_id=uid, provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m2["id"]))
        ensure_primary_key(db, uid)
    db.expire_all()
    assert len(_primary_rows(db, uid)) == 1
    assert len(db.scalars(select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key.id)).all()) == 2


def test_register_with_models_syncs_primary(db: Session, client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post("/api/v1/providers/register", json={
        "name": "Reg", "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"},
        "models": [
            {"model_id": "r-1", "name": "R1"},
            {"model_id": "r-2", "name": "R2"},
        ],
    })
    assert r.status_code == 201, r.text
    uid = uuid.UUID(client.get("/auth/me").json()["id"])
    key = _primary_rows(db, uid)[0]
    assert len(key.model_permissions) == 2


def test_sync_skips_disabled_primary(db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    model_factory(p["id"])
    key = _primary_rows(db, uid)[0]

    client_key_id = key.id
    db.execute(
        ApiKey.__table__.update().where(ApiKey.id == client_key_id).values(enabled=False)
    )
    db.commit()
    db.expire_all()
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")
    db.expire_all()
    perms = db.scalars(select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key.id)).all()
    assert len(perms) == 1  # new model NOT added; key stays disabled
    assert db.get(ApiKey, key.id).enabled is False


# --- gateway key gate --------------------------------------------------------


def test_missing_key_id_422_for_session_user(client: TestClient, user_factory, provider_factory, model_factory) -> None:
    user_factory()
    p = provider_factory("P1")
    m = model_factory(p["id"])
    r = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi",
    })
    assert r.status_code == 422, r.text
    assert "An API key is required" in r.json()["error"]["message"]


def test_revoked_and_disabled_keys_denied(db: Session, client: TestClient, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]

    bad = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": str(uuid.uuid4()),
    })
    assert bad.status_code == 404

    disabled = client.patch(f"/api/v1/keys/{key.id}", json={"enabled": False})
    assert disabled.status_code == 200
    with pytest.raises(NotFoundError):
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid))
    assert client.get(f"/api/v1/chat/models?key_id={key.id}").status_code == 404

    assert client.delete(f"/api/v1/keys/{key.id}").status_code == 204
    with pytest.raises(NotFoundError):
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid))


def test_wrong_user_key_404(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    owner = user_factory("owner@tollma.ai")
    p = provider_factory("P1")
    model_factory(p["id"])
    key_id = _primary_rows(db, uuid.UUID(owner["id"]))[0].id

    user_factory("intruder@tollma.ai")  # client now authed as intruder
    r = client.get(f"/api/v1/chat/models?key_id={key_id}")
    assert r.status_code == 404, r.text
    intruder_keys = client.get("/api/v1/chat/keys").json()
    assert str(key_id) not in [k["id"] for k in intruder_keys]
    assert len(intruder_keys) == 1  # intruder's own signup primary
    assert intruder_keys[0]["name"] == "Primary key" and intruder_keys[0]["scope"] == "personal"


def test_model_outside_allow_list_403(db: Session, client: TestClient, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")

    scoped = client.post("/api/v1/keys", json={
        "name": "Scoped",
        "model_permissions": [{"provider_id": p["id"], "model_id": m1["id"]}],
    })
    assert scoped.status_code == 201, scoped.text
    scoped_id = uuid.UUID(scoped.json()["key"]["id"])

    with pytest.raises(ForbiddenError):
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m2["id"], scoped_id), _transport(), user_id=uid))
    # Allowed model serves fine.
    ok = asyncio.run(gateway_service.run_chat(db, _req(p["id"], m1["id"], scoped_id), _transport(), user_id=uid))
    assert ok.message_id is not None


def test_disabled_model_out_of_eligibility(db: Session, client: TestClient, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]

    assert [str(x.id) for x in gateway_service.chat_models_for_key(db, key.id, uid)] == [m["id"]]
    assert client.patch(f"/api/v1/models/{m['id']}", json={"is_active": False}).status_code == 200
    # Disabled model drops out of eligibility; the gateway itself 422s (as today).
    assert gateway_service.chat_models_for_key(db, key.id, uid) == []
    with pytest.raises(ValidationError):
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid))


# --- picker endpoints --------------------------------------------------------


def test_chat_keys_and_models_lists(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")

    keys = client.get("/api/v1/chat/keys")
    assert keys.status_code == 200, keys.text
    body = keys.json()
    assert len(body) == 1
    entry = body[0]
    assert entry["name"] == "Primary key" and entry["scope"] == "personal"
    assert entry["org_id"] is None and entry["enabled"] is True
    assert entry["model_count"] == 2
    assert "key_hash" not in keys.text and "raw_key" not in keys.text

    models = client.get(f"/api/v1/chat/models?key_id={entry['id']}")
    assert models.status_code == 200, models.text
    assert {row["model_id"] for row in models.json()} == {"mock-model", "mock-2"}
    assert {row["id"] for row in models.json()} == {m1["id"], m2["id"]}


# --- cross-org ----------------------------------------------------------------


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": f"chatkeys-{tag}@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        assert c.get("/auth/verify", params={"token": token}).status_code == 200
    return c


def _member_set_id(c: TestClient, oid: str) -> str:
    sets = c.get(f"/api/v1/orgs/{oid}/sets").json()
    return next(s["id"] for s in sets if s["name"] == "Member")


def test_cross_org_and_lapsed_membership_404(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.organization import Invitation, Membership, MembershipState

    owner = user_factory("orgowner@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "ChatKeys Org"}).json()["id"]
    member_client = _mkuser("member")
    member_id = member_client.get("/auth/me").json()["id"]

    inv = client.post(f"/api/v1/orgs/{oid}/invitations",
                      json={"email": member_client.get("/auth/me").json()["email"],
                            "set_ids": [_member_set_id(client, oid)]})
    assert inv.status_code == 201, inv.text
    token = db.get(Invitation, uuid.UUID(inv.json()["id"])).token
    assert member_client.post(f"/api/v1/orgs/invitations/by-token/{token}/accept").status_code == 200

    issued = client.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "member-key"})
    assert issued.status_code == 201, issued.text
    key_id = uuid.UUID(issued.json()["key"]["id"])

    # Assignee with ACTIVE membership resolves (no models yet, but no 404).
    assert gateway_service.chat_models_for_key(db, key_id, uuid.UUID(member_id)) == []
    member_keys = gateway_service.chat_keys(db, uuid.UUID(member_id))
    member_ids = [str(k.id) for k in member_keys]
    assert str(key_id) in member_ids  # org key present alongside the signup primary
    assert len(member_ids) == 2
    assert {k.scope for k in member_keys} == {"organization", "personal"}
    assert member_keys[0].scope == "organization" and member_keys[0].org_name == "ChatKeys Org"

    # Outsider (owner of another scope, non-member) gets the oracle.
    with pytest.raises(NotFoundError):
        gateway_service.chat_models_for_key(db, key_id, uuid.UUID(owner["id"]))

    # Membership lapsed but key row still live -> still denied (backstop).
    db.execute(
        Membership.__table__.update()
        .where(Membership.org_id == uuid.UUID(oid), Membership.user_id == uuid.UUID(member_id))
        .values(state=MembershipState.SUSPENDED.value)
    )
    db.commit()
    db.expire_all()
    assert db.get(ApiKey, key_id).is_deleted is False
    with pytest.raises(NotFoundError):
        gateway_service.chat_models_for_key(db, key_id, uuid.UUID(member_id))
    lapsed_keys = gateway_service.chat_keys(db, uuid.UUID(member_id))
    assert all(str(k.id) != str(key_id) for k in lapsed_keys)
    assert len(lapsed_keys) == 1 and lapsed_keys[0].scope == "personal"  # signup primary lives on


# --- attribution --------------------------------------------------------------


def test_attribution_columns_set_nonstreaming(db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]

    result = asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid))
    rows = db.scalars(select(Message).where(Message.conversation_id == result.conversation_id)).all()
    assert len(rows) == 2
    assert all(row.api_key_id == key.id for row in rows)
    log = db.scalar(select(RequestLog).where(RequestLog.message_id == result.message_id))
    assert log is not None and log.api_key_id == key.id and log.org_id is None
    run = db.scalar(select(GenerationRun).where(GenerationRun.message_id == result.message_id))
    assert run is not None and run.api_key_id == key.id


def test_attribution_columns_set_streaming(db: Session, user_factory, provider_factory, model_factory) -> None:
    from tollms.services import generation as generation_engine

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]

    async def _main():
        started = await gateway_service.start_generation(
            db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid)
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_main())
    db.expire_all()
    assistant = db.get(Message, started.message_id)
    assert assistant is not None and assistant.api_key_id == key.id
    user_msg = db.scalar(
        select(Message).where(Message.conversation_id == started.conversation_id, Message.role == "user"))
    assert user_msg is not None and user_msg.api_key_id == key.id
    log = db.scalar(select(RequestLog).where(RequestLog.message_id == started.message_id))
    assert log is not None and log.api_key_id == key.id
    run = db.scalar(select(GenerationRun).where(GenerationRun.message_id == started.message_id))
    assert run is not None and run.api_key_id == key.id


# --- regenerate key gate -------------------------------------------------------

def _seed_assistant(db: Session, uid: uuid.UUID, p: dict, m: dict, key_id: uuid.UUID):
    """Completed assistant message via the keyed non-streaming path."""
    result = asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], key_id), _transport(), user_id=uid))
    return result.message_id


def test_regenerate_requires_key(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]
    aid = _seed_assistant(db, uid, p, m, key.id)

    r = client.post(f"/api/v1/messages/{aid}/regenerate", json={})
    assert r.status_code == 422, r.text
    assert "An API key is required" in r.json()["error"]["message"]


def test_regenerate_revoked_key_denied(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]
    aid = _seed_assistant(db, uid, p, m, key.id)

    assert client.delete(f"/api/v1/keys/{key.id}").status_code == 204
    r = client.post(f"/api/v1/messages/{aid}/regenerate", json={"key_id": str(key.id)})
    assert r.status_code == 404, r.text


def test_regenerate_outside_allow_list_403(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")

    scoped = client.post("/api/v1/keys", json={
        "name": "Scoped",
        "model_permissions": [{"provider_id": p["id"], "model_id": m1["id"]}],
    })
    assert scoped.status_code == 201, scoped.text
    scoped_id = uuid.UUID(scoped.json()["key"]["id"])
    aid = _seed_assistant(db, uid, p, m1, scoped_id)

    r = client.post(f"/api/v1/messages/{aid}/regenerate",
                    json={"key_id": str(scoped_id), "model_id": m2["id"]})
    assert r.status_code == 403, r.text


def test_regenerated_usage_attributed_to_key(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    from tollms.api.messages import service as messages_service
    from tollms.services import generation as generation_engine

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    first_key = _primary_rows(db, uid)[0]
    aid = _seed_assistant(db, uid, p, m, first_key.id)

    second = client.post("/api/v1/keys", json={
        "name": "Second",
        "model_permissions": [{"provider_id": p["id"], "model_id": m["id"]}],
    })
    assert second.status_code == 201, second.text
    second_id = uuid.UUID(second.json()["key"]["id"])

    async def _regen():
        started = await messages_service.regenerate_message(
            db, aid, uid, key_id=second_id, transport=_transport())
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_regen())
    db.expire_all()
    assert started.message_id != aid
    assistant = db.get(Message, started.message_id)
    assert assistant is not None and assistant.api_key_id == second_id
    # The original row keeps its own key and run (Rule A: never reset).
    original = db.get(Message, aid)
    assert original is not None and original.api_key_id == first_key.id
    logs = list(db.scalars(
        select(RequestLog).where(RequestLog.message_id == started.message_id
                                 ).order_by(RequestLog.created_at.desc())))
    assert logs and logs[0].api_key_id == second_id
    runs = list(db.scalars(
        select(GenerationRun).where(GenerationRun.message_id == started.message_id
                                    ).order_by(GenerationRun.generation_number.asc())))
    assert [r.api_key_id for r in runs] == [second_id]
    old_runs = list(db.scalars(
        select(GenerationRun).where(GenerationRun.message_id == aid
                                    ).order_by(GenerationRun.generation_number.asc())))
    assert [r.api_key_id for r in old_runs] == [first_key.id]


# --- picker hides unusable keys -------------------------------------------------

def test_picker_excludes_unusable_keys(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    from datetime import datetime, timedelta, timezone

    from tollms.services.api_keys import keys as key_engine

    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    model_factory(p["id"])
    primary = _primary_rows(db, uid)[0]

    disabled = client.post("/api/v1/keys", json={"name": "Disabled"})
    assert disabled.status_code == 201, disabled.text
    assert client.patch(f"/api/v1/keys/{disabled.json()['key']['id']}",
                        json={"enabled": False}).status_code == 200

    expired = client.post("/api/v1/keys", json={"name": "Expired"})
    assert expired.status_code == 201, expired.text
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(ApiKey.__table__.update().where(
        ApiKey.id == uuid.UUID(expired.json()["key"]["id"])).values(expires_at=past))
    db.commit()

    tombstoned = client.post("/api/v1/keys", json={"name": "Tombstoned"})
    assert tombstoned.status_code == 201, tombstoned.text
    trow = db.get(ApiKey, uuid.UUID(tombstoned.json()["key"]["id"]))
    key_engine.write_tombstone(trow.key_hash)
    db.expire_all()

    body = client.get("/api/v1/chat/keys")
    assert body.status_code == 200, body.text
    assert [row["id"] for row in body.json()] == [str(primary.id)]


# --- security review fixes -----------------------------------------------------

def test_all_disabled_allow_list_denies_all(db: Session, client: TestClient, user_factory, provider_factory, model_factory) -> None:
    """M3: rows exist but ALL disabled = ZERO eligible models (deny-all).

    No permission rows at all keeps the documented unrestricted intent;
    this test locks both sides of that distinction.
    """
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")

    scoped = client.post("/api/v1/keys", json={
        "name": "Scoped",
        "model_permissions": [{"provider_id": p["id"], "model_id": m1["id"]}],
    })
    assert scoped.status_code == 201, scoped.text
    scoped_id = uuid.UUID(scoped.json()["key"]["id"])
    assert [str(x.id) for x in gateway_service.chat_models_for_key(db, scoped_id, uid)] == [m1["id"]]

    # Key with NO rows stays unrestricted (documented intent, unchanged).
    open_key = client.post("/api/v1/keys", json={"name": "Open"})
    assert open_key.status_code == 201, open_key.text
    open_id = uuid.UUID(open_key.json()["key"]["id"])
    assert {str(x.id) for x in gateway_service.chat_models_for_key(db, open_id, uid)} == {m1["id"], m2["id"]}

    # Disable every allow-list row -> deny-all, not unrestricted.
    db.execute(
        ApiKeyModelPermission.__table__.update()
        .where(ApiKeyModelPermission.api_key_id == scoped_id)
        .values(enabled=False)
    )
    db.commit()
    db.expire_all()

    assert gateway_service.chat_models_for_key(db, scoped_id, uid) == []
    models = client.get(f"/api/v1/chat/models?key_id={scoped_id}")
    assert models.status_code == 200, models.text
    assert models.json() == []
    with pytest.raises(ForbiddenError):
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m1["id"], scoped_id), _transport(), user_id=uid))
    denied = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m1["id"], "message": "hi", "key_id": str(scoped_id),
    })
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.json()["error"]["message"]


def test_denied_regen_leaves_content_unedited(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    """L1: the regen-path key gate runs BEFORE the edit commits.

    A denied regen (missing key -> 422, revoked key -> 404) leaves the
    content AND its version history untouched. Edit-without-regen (no
    following assistant) intentionally stays owner-check-only — see
    test_message_history.py::test_edit_message_snapshots_versions.
    """
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]
    aid = _seed_assistant(db, uid, p, m, key.id)
    db.expire_all()
    assistant = db.get(Message, aid)
    user_msg = db.scalar(select(Message).where(
        Message.conversation_id == assistant.conversation_id, Message.role == Role.USER))
    assert user_msg is not None
    original = user_msg.content

    # Missing key on the regen path -> 422, nothing persisted.
    r = client.patch(f"/api/v1/messages/{user_msg.id}", json={"content": "hacked edit"})
    assert r.status_code == 422, r.text
    db.expire_all()
    assert db.get(Message, user_msg.id).content == original
    assert client.get(f"/api/v1/messages/{user_msg.id}/history").json()["versions"] == []

    # Revoked key on the regen path -> 404, still nothing persisted.
    assert client.delete(f"/api/v1/keys/{key.id}").status_code == 204
    r2 = client.patch(f"/api/v1/messages/{user_msg.id}",
                      params={"key_id": str(key.id)}, json={"content": "hacked edit 2"})
    assert r2.status_code == 404, r2.text
    db.expire_all()
    assert db.get(Message, user_msg.id).content == original
    assert client.get(f"/api/v1/messages/{user_msg.id}/history").json()["versions"] == []


def test_key_denial_hides_key_id(db: Session, client: TestClient, user_factory, provider_factory, model_factory) -> None:
    """L2: denial messages never echo the key UUID (static 'api key not found').

    404 code + retryable flag are identical to before; only the message changed.
    """
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("P1")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]
    bogus = uuid.uuid4()

    with pytest.raises(NotFoundError) as exc:
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], bogus), _transport(), user_id=uid))
    assert exc.value.message == "api key not found"
    assert str(bogus) not in exc.value.message

    r = client.post("/api/v1/gateway/chat", json={
        "provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": str(bogus),
    })
    assert r.status_code == 404, r.text
    body = r.json()["error"]
    assert body["message"] == "api key not found"
    assert body["code"] == "NOT_FOUND" and body["retryable"] is False
    assert str(bogus) not in r.text

    # Disabled-key denial carries the same static message.
    assert client.patch(f"/api/v1/keys/{key.id}", json={"enabled": False}).status_code == 200
    with pytest.raises(NotFoundError) as exc2:
        asyncio.run(gateway_service.run_chat(db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid))
    assert exc2.value.message == "api key not found"
    assert str(key.id) not in exc2.value.message
