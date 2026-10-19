"""Edge cases around in-app chat keys + keyed external requests.

Companion to test_chat_keys.py (which owns the core cases: primary
lifecycle, key-gated gateway, picker endpoints, cross-org service oracles,
attribution). Nothing here duplicates those; each test below covers a seam
they leave open.

Plane notes (read before "fixing" these tests):
- Budget (max_budget_usd) is enforced on the EXTERNAL gateway only
  (public_gateway._prepare -> limits.check_request). The in-app UI gateway
  (gateway/service.run_chat) gates key validity (404 oracle) + model
  allow-list (403) but does not meter budgets. So the budget test lives on /v1.
- Streaming failure on the EXTERNAL gateway logs one failed ApiRequestLog
  row with NULL tokens/cost (no fabricated usage). The UI streaming engine
  instead deliberately estimates partial usage (see test_generations.py).
- GET /api/v1/chat/keys never 404s for an authenticated caller: it lists
  the caller's own keys (empty when none). Stranger isolation = the other's
  key is absent (200); /chat/models?key_id=<other> is the 404 oracle.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.public_gateway import service as pg_service
from tollms.core.exceptions import NotFoundError
from tollms.main import app
from tollms.models.api_key import ApiKey, ApiKeyModelPermission, ApiRequestLog

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


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": f"edgekeys-{tag}@tollma.ai", "password": "Password123"})
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


def _bind_success(monkeypatch: pytest.MonkeyPatch) -> None:
    from tollms.services.gateway.factory import build_adapter as real_build

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)

    def fake_build(provider, model, credentials):
        return real_build(provider, model, credentials, transport)

    monkeypatch.setattr(pg_service, "build_adapter", fake_build)


class _BoomAdapter:
    """Provider adapter that explodes mid-stream (no usage ever reported)."""

    async def chat_stream(self, messages):
        raise RuntimeError("provider blew up")
        yield  # noqa: unreachable — makes this an async generator

    async def chat(self, messages):
        raise RuntimeError("provider blew up")


# --- 1. org picker isolation between two members -------------------------------


def test_org_members_see_only_own_assigned_keys(client: TestClient, db: Session, user_factory) -> None:
    user_factory("edge1owner@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "Edge Iso Org"}).json()["id"]
    ma, mb = _mkuser("isoA"), _mkuser("isoB")
    a_id = _invite_and_accept(client, ma, db, oid)
    b_id = _invite_and_accept(client, mb, db, oid)

    ka = client.post(f"/api/v1/orgs/{oid}/keys",
                     json={"assignee_user_id": a_id, "name": "key-a"}).json()
    kb = client.post(f"/api/v1/orgs/{oid}/keys",
                     json={"assignee_user_id": b_id, "name": "key-b"}).json()
    assert ka["key"]["id"] != kb["key"]["id"]

    got_a = ma.get("/api/v1/chat/keys")
    got_b = mb.get("/api/v1/chat/keys")
    assert got_a.status_code == 200 and got_b.status_code == 200
    ids_a = [k["id"] for k in got_a.json()]
    ids_b = [k["id"] for k in got_b.json()]
    assert ka["key"]["id"] in ids_a and kb["key"]["id"] not in ids_a
    assert kb["key"]["id"] in ids_b and ka["key"]["id"] not in ids_b
    assert len(ids_a) == 2 and len(ids_b) == 2  # own org key + signup primary
    assert {k["scope"] for k in got_a.json()} == {"organization", "personal"}
    assert all(k["scope"] == "organization" and k["org_id"] == oid
               for k in got_a.json() + got_b.json() if k["scope"] == "organization")


# --- 2. revoked / disabled / expired keys denied on chat send ------------------


def test_revoked_disabled_expired_keys_denied_on_chat_send(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory("edge2@tollma.ai")
    p = provider_factory("EdgeSend")
    m = model_factory(p["id"])
    key_id = _primary_rows(db, uuid.UUID(client.get("/auth/me").json()["id"]))[0].id
    body = {"provider_id": p["id"], "model_id": m["id"], "message": "hi", "key_id": str(key_id)}

    assert client.patch(f"/api/v1/keys/{key_id}", json={"enabled": False}).status_code == 200
    assert client.post("/api/v1/gateway/chat", json=body).status_code == 404

    assert client.patch(f"/api/v1/keys/{key_id}", json={"enabled": True}).status_code == 200
    assert client.delete(f"/api/v1/keys/{key_id}").status_code == 204
    assert client.post("/api/v1/gateway/chat", json=body).status_code == 404

    created = client.post("/api/v1/keys", json={"name": "expiring"})
    assert created.status_code == 201, created.text
    row = db.get(ApiKey, uuid.UUID(created.json()["key"]["id"]))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    expired = client.post("/api/v1/gateway/chat",
                          json={**body, "key_id": created.json()["key"]["id"]})
    assert expired.status_code == 404, expired.text


# --- 3. membership lapse: org key dead, personal key lives --------------------


def test_removed_member_org_key_dead_personal_key_lives(
    client: TestClient, db: Session, user_factory
) -> None:
    user_factory("edge3owner@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "Edge Lapse Org"}).json()["id"]
    mcli = _mkuser("lapse")
    mid = _invite_and_accept(client, mcli, db, oid)
    muid = uuid.UUID(mid)

    mp = mcli.post("/api/v1/providers", json={
        "name": "MPriv", "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}})
    assert mp.status_code == 201, mp.text
    mm = mcli.post("/api/v1/models", json={
        "provider_id": mp.json()["id"], "model_id": "m-model", "name": "M",
        "endpoint_type": "chat_completions", "input_price": "2.5", "output_price": "10"})
    assert mm.status_code == 201, mm.text
    personal = _primary_rows(db, muid)[0]

    orgkey = client.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": mid, "name": "mem-key"}).json()
    okid = uuid.UUID(orgkey["key"]["id"])

    members = client.get(f"/api/v1/orgs/{oid}/members").json()
    target = next(x["user_id"] for x in members if x["user_id"] == mid)
    assert client.delete(f"/api/v1/orgs/{oid}/members/{target}").status_code == 204
    db.expire_all()

    # Lapsed org key is a 404 oracle on send (not a 403 allow-list deny).
    with pytest.raises(NotFoundError):
        asyncio.run(gateway_service.run_chat(
            db, _req(mp.json()["id"], mm.json()["id"], okid), _transport(), user_id=muid))
    # ...while the member's own personal key still serves.
    good = asyncio.run(gateway_service.run_chat(
        db, _req(mp.json()["id"], mm.json()["id"], personal.id), _transport(), user_id=muid))
    assert good.message_id is not None
    assert db.get(ApiKey, personal.id).is_deleted is False


# --- 4. budget enforcement on keyed external send ------------------------------


def test_budget_enforced_on_keyed_external_send(
    client: TestClient, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory("edge4budget@tollma.ai")
    p = provider_factory("EdgeBudget")
    model_factory(p["id"])
    _bind_success(monkeypatch)
    body = {"model": f"{p['name']}/mock-model",
            "messages": [{"role": "user", "content": "hello world, billable prompt"}]}

    capped = client.post("/api/v1/keys", json={"name": "capped", "policy": {"max_budget_usd": "0"}})
    assert capped.status_code == 201, capped.text
    denied = client.post("/v1/chat/completions", json=body,
                         headers={"Authorization": f"Bearer {capped.json()['raw_key']}"})
    assert denied.status_code == 403, denied.text

    # Control: the same payload with an uncapped key succeeds.
    open_key = client.post("/api/v1/keys", json={"name": "open"})
    assert open_key.status_code == 201, open_key.text
    ok = client.post("/v1/chat/completions", json=body,
                     headers={"Authorization": f"Bearer {open_key.json()['raw_key']}"})
    assert ok.status_code == 200, ok.text


# --- 5. streaming failure logs no fabricated usage ----------------------------


def test_streaming_failure_logs_null_usage(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory("edge5boom@tollma.ai")
    p = provider_factory("EdgeBoom")
    model_factory(p["id"])
    created = client.post("/api/v1/keys", json={"name": "boom"})
    assert created.status_code == 201, created.text
    raw, kid = created.json()["raw_key"], created.json()["key"]["id"]
    monkeypatch.setattr(pg_service, "build_adapter",
                        lambda provider, model, credentials: _BoomAdapter())

    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": f"{p['name']}/mock-model",
              "messages": [{"role": "user", "content": "hi"}], "stream": True},
        headers={"Authorization": f"Bearer {raw}"},
    ) as resp:
        assert resp.status_code == 200, resp.text
        text = resp.read().decode()
    assert "error" in text.lower()

    rows = db.scalars(
        select(ApiRequestLog).where(ApiRequestLog.api_key_id == uuid.UUID(kid))).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "failed"
    assert row.input_tokens is None and row.output_tokens is None and row.total_tokens is None
    assert row.cost is None
    assert row.is_streaming is True


# --- 6. external keyed requests: attribution, allow-list, revocation ----------


def test_external_keyed_attribution_and_denies(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory("edge6ext@tollma.ai")
    root_id = client.get("/auth/me").json()["id"]
    oid = client.post("/api/v1/orgs", json={"name": "Edge Ext Org"}).json()["id"]
    # Org model via the org flow (personal /api/v1/models 404s org providers).
    oprov = client.post(f"/api/v1/orgs/{oid}/providers/register", json={
        "name": "EdgeOrgGW", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [{"model_id": "org-model", "name": "Org Model",
                    "endpoint_type": "chat_completions",
                    "input_price": "1", "output_price": "2"}]}).json()
    orgkey = client.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": root_id, "name": "edge-org-key"}).json()
    _bind_success(monkeypatch)

    ok = client.post("/v1/chat/completions",
                     json={"model": f"{oprov['name']}/org-model",
                           "messages": [{"role": "user", "content": "hi"}]},
                     headers={"Authorization": f"Bearer {orgkey['raw_key']}"})
    assert ok.status_code == 200, ok.text
    row = db.scalar(select(ApiRequestLog).where(
        ApiRequestLog.api_key_id == uuid.UUID(orgkey["key"]["id"])))
    assert row is not None
    assert row.user_id == uuid.UUID(root_id) and row.org_id == uuid.UUID(oid)
    assert row.model == "org-model" and row.provider == "custom"
    assert row.endpoint == "chat_completions" and row.status == "success"

    p = provider_factory("EdgeExt")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="other-model", name="Other")
    scoped = client.post("/api/v1/keys", json={
        "name": "scoped",
        "model_permissions": [{"provider_id": p["id"], "model_id": m1["id"]}]})
    assert scoped.status_code == 201, scoped.text
    denied = client.post("/v1/chat/completions",
                         json={"model": f"{p['name']}/other-model",
                               "messages": [{"role": "user", "content": "hi"}]},
                         headers={"Authorization": f"Bearer {scoped.json()['raw_key']}"})
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.text
    allowed = client.post("/v1/chat/completions",
                          json={"model": f"{p['name']}/mock-model",
                                "messages": [{"role": "user", "content": "hi"}]},
                          headers={"Authorization": f"Bearer {scoped.json()['raw_key']}"})
    assert allowed.status_code == 200, allowed.text
    assert m2["id"]  # both models exist; the deny above is purely allow-list scope

    doomed = client.post("/api/v1/keys", json={"name": "doomed"})
    assert doomed.status_code == 201, doomed.text
    assert client.delete(f"/api/v1/keys/{doomed.json()['key']['id']}").status_code == 204
    gone = client.post("/v1/chat/completions",
                       json={"model": f"{p['name']}/mock-model",
                             "messages": [{"role": "user", "content": "hi"}]},
                       headers={"Authorization": f"Bearer {doomed.json()['raw_key']}"})
    assert gone.status_code == 401, gone.text


# --- 7. stranger vs another user's org key ------------------------------------


def test_stranger_excluded_from_others_org_key(client: TestClient, db: Session, user_factory) -> None:
    """Stranger isolation: /chat/keys is 200-by-design (own list only, so the
    other's key must be ABSENT); /chat/models?key_id=<other> is the 404 oracle."""
    user_factory("edge7owner@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "Edge Stranger Org"}).json()["id"]
    mem = _mkuser("stranger-member")
    mid = _invite_and_accept(client, mem, db, oid)
    issued = client.post(f"/api/v1/orgs/{oid}/keys",
                         json={"assignee_user_id": mid, "name": "mem-key"}).json()
    okid = issued["key"]["id"]

    user_factory("edge7stranger@tollma.ai")  # client session is now the stranger
    keys = client.get("/api/v1/chat/keys")
    assert keys.status_code == 200, keys.text
    assert okid not in [k["id"] for k in keys.json()]
    assert client.get(f"/api/v1/chat/models?key_id={okid}").status_code == 404


# --- 8. double registration idempotency ---------------------------------------


def test_double_registration_keeps_single_primary(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    user_factory("edge8@tollma.ai")
    uid = uuid.UUID(client.get("/auth/me").json()["id"])
    payload = {
        "name": "EdgeReg", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [
            {"model_id": "r-1", "name": "R1"},
            {"model_id": "r-2", "name": "R2"},
        ],
    }
    assert client.post("/api/v1/providers/register", json=payload).status_code == 201
    dup = client.post("/api/v1/providers/register", json=payload)
    assert dup.status_code == 422, dup.text

    keys = _primary_rows(db, uid)
    assert len(keys) == 1
    perms = db.scalars(select(ApiKeyModelPermission).where(
        ApiKeyModelPermission.api_key_id == keys[0].id)).all()
    assert len(perms) == 2
    prov = db.scalar(select(Provider).where(
        Provider.name == "EdgeReg", Provider.is_deleted.is_(False)))
    assert prov is not None
    assert db.scalar(select(func.count()).select_from(Provider).where(
        Provider.name == "EdgeReg", Provider.is_deleted.is_(False))) == 1
    assert db.scalar(select(func.count()).select_from(AIModel).where(
        AIModel.provider_id == prov.id, AIModel.is_deleted.is_(False))) == 2
