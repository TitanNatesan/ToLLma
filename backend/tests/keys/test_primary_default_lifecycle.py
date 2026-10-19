"""Primary/default lifecycle: provisioning, sync, gating, isolation, history.

The personal primary (`is_primary`) is auto-provisioned at signup and owns
the model allow-list; the default (`is_default`) is the newest personal key.
Org keys never participate in either slot.
"""

import asyncio
import concurrent.futures
import uuid
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.keys import service as key_service
from tollms.core.exceptions import ForbiddenError, NotFoundError
from tollms.main import app
from tollms.models.api_key import ApiKey, ApiKeyModelPermission, ApiRequestLog
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services.api_keys import keys as key_engine

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
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


def _default_row(db: Session, uid: uuid.UUID) -> ApiKey | None:
    return db.scalar(
        select(ApiKey).where(
            ApiKey.user_id == uid, ApiKey.org_id.is_(None),
            ApiKey.is_default.is_(True), ApiKey.is_deleted.is_(False),
        )
    )


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": f"lifecycle-{tag}@tollma.ai", "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        assert c.get("/auth/verify", params={"token": token}).status_code == 200
    return c


def _member_set_id(c: TestClient, oid: str) -> str:
    sets = c.get(f"/api/v1/orgs/{oid}/sets").json()
    return next(s["id"] for s in sets if s["name"] == "Member")


def _invite_and_accept(client: TestClient, member: TestClient, db: Session, oid: str) -> str:
    from tollms.models.organization import Invitation

    email = member.get("/auth/me").json()["email"]
    inv = client.post(f"/api/v1/orgs/{oid}/invitations",
                      json={"email": email, "set_ids": [_member_set_id(client, oid)]})
    assert inv.status_code == 201, inv.text
    token = db.get(Invitation, uuid.UUID(inv.json()["id"])).token
    assert member.post(f"/api/v1/orgs/invitations/by-token/{token}/accept").status_code == 200
    return member.get("/auth/me").json()["id"]


# --- provisioning + idempotency ---------------------------------------------


def test_signup_provisions_one_primary_and_default(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    rows = _primary_rows(db, uid)
    assert len(rows) == 1
    key = rows[0]
    assert key.name == "Primary key"
    assert key.is_primary is True and key.is_default is True
    assert key.enabled is True and key.org_id is None
    assert key.policy is None and key.ip_rules == []
    assert key.model_permissions == []  # unrestricted until models exist
    assert _default_row(db, uid).id == key.id


def test_repeated_ensure_is_idempotent(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    for _ in range(3):
        key_service.ensure_primary_key(db, uid)
    db.expire_all()
    assert len(_primary_rows(db, uid)) == 1


def test_concurrent_ensure_single_primary(db: Session, user_factory) -> None:
    """Two workers racing to recreate a missing primary still leave exactly one."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    db.delete(_primary_rows(db, uid)[0])
    db.commit()
    maker = sessionmaker(bind=db.get_bind())

    def _ensure() -> uuid.UUID:
        s = maker()
        try:
            return key_service.ensure_primary_key(s, uid).id
        finally:
            s.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(lambda _: _ensure(), range(2)))
    assert ids[0] == ids[1]
    db.expire_all()
    assert len(_primary_rows(db, uid)) == 1


# --- register sync / prune --------------------------------------------------


def test_provider_register_syncs_primary_and_resync_idempotent(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    before = _primary_rows(db, uid)[0]
    assert before.model_permissions == []

    r = client.post("/api/v1/providers/register", json={
        "name": "LifeReg", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [{"model_id": "r-1", "name": "R1"}, {"model_id": "r-2", "name": "R2"}],
    })
    assert r.status_code == 201, r.text
    assert r.json()["models_created"] == 2
    db.expire_all()

    key = _primary_rows(db, uid)[0]
    assert key.id == before.id  # no duplicate primary
    assert len(key.model_permissions) == 2

    # Refresh (re-sync) never duplicates rows nor primaries.
    for _ in range(3):
        for perm in list(key.model_permissions):
            key_service.sync_primary_model(
                db, user_id=uid, provider_id=perm.provider_id, model_id=perm.model_id)
        key_service.ensure_primary_key(db, uid)
    db.expire_all()
    assert len(_primary_rows(db, uid)) == 1
    assert len(db.scalars(
        select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key.id)).all()) == 2


def test_delete_provider_prunes_only_its_models(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p1 = provider_factory("LifeP1")
    m1 = model_factory(p1["id"], model_id="shared", name="Shared One")
    p2 = provider_factory("LifeP2")
    m2 = model_factory(p2["id"], model_id="shared", name="Shared Two")

    key = _primary_rows(db, uid)[0]
    assert {(str(r.provider_id), str(r.model_id)) for r in key.model_permissions} == {
        (p1["id"], m1["id"]), (p2["id"], m2["id"])}

    assert client.delete(f"/api/v1/providers/{p1['id']}").status_code == 204
    db.expire_all()
    remaining = db.scalars(
        select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key.id)).all()
    assert [(str(r.provider_id), str(r.model_id)) for r in remaining] == [(p2["id"], m2["id"])]


def test_deleted_model_cannot_be_invoked(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("LifeDel")
    m = model_factory(p["id"])
    key = _primary_rows(db, uid)[0]
    assert [str(x.id) for x in gateway_service.chat_models_for_key(db, key.id, uid)] == [m["id"]]

    assert client.delete(f"/api/v1/models/{m['id']}").status_code == 204
    db.expire_all()
    assert gateway_service.chat_models_for_key(db, key.id, uid) == []
    # Soft-deleted models resolve through the 404 oracle (same as get_model).
    with pytest.raises(NotFoundError):
        asyncio.run(gateway_service.run_chat(
            db, _req(p["id"], m["id"], key.id), _transport(), user_id=uid))


# --- manual default + scoped restriction --------------------------------------


def test_manual_create_becomes_default_primary_intact_and_scoped(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("LifeScope")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-2", name="Mock 2")
    assert _primary_rows(db, uid)[0].is_default is True

    created = client.post("/api/v1/keys", json={
        "name": "Scoped",
        "model_permissions": [{"provider_id": p["id"], "model_id": m1["id"]}],
    })
    assert created.status_code == 201, created.text
    assert created.json()["key"]["is_default"] is True
    assert created.json()["key"]["is_primary"] is False
    scoped_id = uuid.UUID(created.json()["key"]["id"])

    db.expire_all()
    assert _default_row(db, uid).id == scoped_id
    primary = _primary_rows(db, uid)[0]
    assert primary.is_primary is True and primary.is_default is False
    assert {str(r.model_id) for r in primary.model_permissions} == {m1["id"], m2["id"]}

    # The scoped key cannot bypass its allow-list.
    ctx = key_engine.authenticate(db, created.json()["raw_key"])
    assert ctx is not None
    assert ctx.model_allowed(uuid.UUID(p["id"]), uuid.UUID(m1["id"])) is True
    assert ctx.model_allowed(uuid.UUID(p["id"]), uuid.UUID(m2["id"])) is False
    with pytest.raises(ForbiddenError):
        asyncio.run(gateway_service.run_chat(
            db, _req(p["id"], m2["id"], scoped_id), _transport(), user_id=uid))


# --- org keys -----------------------------------------------------------------


def test_org_key_gating_and_isolation(client: TestClient, db: Session, user_factory) -> None:
    user_factory("orglife-owner@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "Life Org"}).json()["id"]
    member = _mkuser("life-m")
    outsider = _mkuser("life-out")
    outsider_id = outsider.get("/auth/me").json()["id"]
    member_id = _invite_and_accept(client, member, db, oid)

    member_default_before = _default_row(db, uuid.UUID(member_id))
    assert member_default_before is not None and member_default_before.org_id is None

    issued = client.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "mem-key"})
    assert issued.status_code == 201, issued.text
    org_kid = issued.json()["key"]["id"]

    # Non-member assignee, cross-org caller, and unprivileged member: all 404.
    assert client.post(f"/api/v1/orgs/{oid}/keys",
                       json={"assignee_user_id": outsider_id, "name": "nope"}).status_code == 404
    assert outsider.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": member_id, "name": "x"}).status_code == 404
    assert member.post(f"/api/v1/orgs/{oid}/keys",
                       json={"assignee_user_id": member_id, "name": "x"}).status_code == 404

    # Org issuance never moves the assignee's personal default.
    db.expire_all()
    member_default_after = key_service.find_default_key(db, uuid.UUID(member_id))
    assert member_default_after is not None
    assert member_default_after.id == member_default_before.id
    assert member_default_after.org_id is None

    # Personal/org isolation holds both directions.
    assert org_kid not in [k["id"] for k in client.get("/api/v1/keys").json()]
    assert org_kid not in [k["id"] for k in member.get("/api/v1/keys").json()]
    org_ids = [k["id"] for k in client.get(f"/api/v1/orgs/{oid}/keys").json()]
    assert org_kid in org_ids
    assert str(member_default_after.id) not in org_ids


# --- usage history ------------------------------------------------------------


def test_usage_history_survives_provider_model_key_deletion(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    p = provider_factory("LifeHist")
    m = model_factory(p["id"])
    scoped = client.post("/api/v1/keys", json={"name": "Hist"})
    assert scoped.status_code == 201, scoped.text
    kid = uuid.UUID(scoped.json()["key"]["id"])

    db.add(RequestLog(
        user_id=uid, provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        api_key_id=kid, total_cost=Decimal("0.05"), total_tokens=100, status="success",
    ))
    db.add(ApiRequestLog(
        request_id="life-1", api_key_id=kid, user_id=uid, provider="custom",
        model="mock-model", endpoint="chat_completions", status="success",
        cost=Decimal("0.05"), total_tokens=100,
    ))
    db.commit()

    # Soft-deletes never cascade history.
    assert client.delete(f"/api/v1/models/{m['id']}").status_code == 204
    assert client.delete(f"/api/v1/providers/{p['id']}").status_code == 204
    assert client.delete(f"/api/v1/keys/{kid}").status_code == 204
    db.expire_all()
    req = db.scalar(select(RequestLog).where(RequestLog.total_tokens == 100))
    api = db.scalar(select(ApiRequestLog).where(ApiRequestLog.request_id == "life-1"))
    assert req is not None and api is not None
    assert req.total_cost == Decimal("0.05") and api.cost == Decimal("0.05")

    # Hard removal nulls the refs but keeps the rows (SET NULL, costs unchanged).
    db.delete(db.get(ApiKey, kid))
    db.delete(db.get(AIModel, uuid.UUID(m["id"])))
    db.delete(db.get(Provider, uuid.UUID(p["id"])))
    db.commit()
    db.expire_all()
    req = db.scalar(select(RequestLog).where(RequestLog.total_tokens == 100))
    api = db.scalar(select(ApiRequestLog).where(ApiRequestLog.request_id == "life-1"))
    assert req is not None and api is not None
    assert req.api_key_id is None and req.provider_id is None and req.model_id is None
    assert api.api_key_id is None
    assert api.provider == "custom" and api.model == "mock-model"
    assert req.total_cost == Decimal("0.05") and api.cost == Decimal("0.05")
    assert req.total_tokens == 100 and api.total_tokens == 100


# --- backfill -----------------------------------------------------------------


def test_backfill_missing_primaries(db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    assert key_service.backfill_missing_primaries(db) == 0  # existing primary skipped
    assert len(_primary_rows(db, uid)) == 1

    db.delete(_primary_rows(db, uid)[0])  # simulate a legacy user without one
    db.commit()
    assert _primary_rows(db, uid) == []
    assert key_service.backfill_missing_primaries(db) == 1
    rows = _primary_rows(db, uid)
    assert len(rows) == 1
    assert rows[0].name == "Primary key" and rows[0].is_default is True
    assert key_service.backfill_missing_primaries(db) == 0
