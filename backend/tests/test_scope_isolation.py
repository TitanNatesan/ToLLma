"""Personal/org provider scope isolation.

Canonical rule: ownership is decided SOLELY by `providers.org_id` —
NULL = personal (owned by `user_id`), NOT NULL = org-owned (`user_id` is
creator audit). Same for keys. Covers:

- personal registry boundary (personal router 404s org rows)
- org UI reuse kept (validate/discover stay org-aware, perm-gated)
- public gateway scope pin (personal key <-> personal rows, org key <->
  exactly its own org rows)
"""

import asyncio
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.providers import service as providers_service
from tollms.api.public_gateway import service as gateway_service
from tollms.main import app
from tollms.models.provider import Provider

ORG = "/api/v1/orgs"
SSE_BODY = (
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,'
    '"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
    "data: [DONE]\n\n"
)


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"scope-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "Scope Org") -> dict:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _make_set(c: TestClient, oid: str, name: str, codes: list[str]) -> str:
    r = c.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": codes})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _invite_and_accept(root: TestClient, member: TestClient, db: Session,
                       oid: str, set_ids: list[str]) -> None:
    from tollms.models.organization import Invitation

    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _me(member)["email"], "set_ids": set_ids})
    assert inv.status_code == 201, inv.text
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(row)
    acc = member.post(f"{ORG}/invitations/by-token/{row.token}/accept")
    assert acc.status_code == 200, acc.text


def _issue(c: TestClient, oid: str, assignee: str, **kw) -> dict:
    payload = {"assignee_user_id": assignee, "name": f"k-{uuid.uuid4().hex[:6]}", **kw}
    r = c.post(f"{ORG}/{oid}/keys", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _personal_key(c: TestClient, name: str = "pk") -> dict:
    r = c.post("/api/v1/keys", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _personal_provider_with_model(c: TestClient, name: str) -> tuple[str, str]:
    p = c.post("/api/v1/providers", json={
        "name": name, "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert p.status_code == 201, p.text
    m = c.post("/api/v1/models", json={
        "provider_id": p.json()["id"], "model_id": f"{name}-model",
        "name": f"{name} Model", "endpoint_type": "chat_completions",
        "input_price": "1", "output_price": "2"})
    assert m.status_code == 201, m.text
    return p.json()["id"], m.json()["id"]


def _org_provider_with_model(c: TestClient, oid: str, name: str) -> tuple[str, str]:
    """Org provider + one model via the org flow (register wizard)."""
    r = c.post(f"{ORG}/{oid}/providers/register", json={
        "name": name, "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [{"model_id": f"{name}-model", "name": f"{name} Model",
                    "endpoint_type": "chat_completions",
                    "input_price": "1", "output_price": "2"}]})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    mid = c.get(f"{ORG}/{oid}/providers").json()  # sanity: visible in org scope
    assert any(p["id"] == pid for p in mid)
    model = None
    # Model id is deterministic from the register payload; fetch via org member
    # visibility through the gateway listing instead of guessing UUIDs.
    return pid, f"{name}-model"


def _org_model_id(db: Session, provider_id: str, model_id: str) -> str:
    from tollms.models.registered_model import AIModel

    row = db.scalar(select(AIModel).where(
        AIModel.provider_id == uuid.UUID(provider_id),
        AIModel.model_id == model_id))
    assert row is not None
    return str(row.id)


def _bind_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    from tollms.services.gateway.factory import build_adapter as real_build

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(200, content=SSE_BODY.encode(),
                                  headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "unexpected path"})

    transport = httpx.MockTransport(handler)

    def fake_build_adapter(provider, model, credentials):
        return real_build(provider, model, credentials, transport)

    monkeypatch.setattr(gateway_service, "build_adapter", fake_build_adapter)


def _mock() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "m1"}]})
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler)


# --- ownership constraint --------------------------------------------------------

def test_owner_scope_check_constraint_declared() -> None:
    names = {getattr(c, "name", "") for c in Provider.__table__.constraints}
    assert "ck_providers_owner_scope" in names


def test_both_null_row_rejected(db: Session) -> None:
    """Ownerless rows are impossible: user_id is NOT NULL for personal rows."""
    import json

    from sqlalchemy.exc import IntegrityError

    from tollms.core.crypto import encrypt
    from tollms.models.provider import ProviderType

    db.add(Provider(
        user_id=None, org_id=None, name="Ownerless",
        provider_type=ProviderType.CUSTOM,
        credentials_encrypted=encrypt(json.dumps({"base_url": "http://mock"})),
    ))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_both_set_row_is_valid_org_row(client: TestClient, db: Session, user_factory) -> None:
    """Both user_id + org_id set stays a legal org row (creator audit)."""
    user_factory()
    oid = _mkorg(client)["id"]
    r = client.post(f"{ORG}/{oid}/providers", json={
        "name": "BothSet", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert r.status_code == 201, r.text
    row = db.get(Provider, uuid.UUID(r.json()["id"]))
    assert row is not None and row.org_id == uuid.UUID(oid) and row.user_id is not None


# --- personal registry boundary --------------------------------------------------

def test_personal_router_hides_org_rows(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    org_pid, org_model = _org_provider_with_model(client, oid, "OrgHidden")
    org_mid = _org_model_id(db, org_pid, org_model)
    per_pid, per_mid = _personal_provider_with_model(client, "Mine")

    listed = {p["id"] for p in client.get("/api/v1/providers").json()}
    assert per_pid in listed and org_pid not in listed

    assert client.get(f"/api/v1/providers/{org_pid}").status_code == 404
    assert client.patch(f"/api/v1/providers/{org_pid}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/v1/providers/{org_pid}").status_code == 404

    models = {m["id"] for m in client.get("/api/v1/models").json()}
    assert per_mid in models and org_mid not in models
    assert client.get(f"/api/v1/models/{org_mid}").status_code == 404
    assert client.patch(f"/api/v1/models/{org_mid}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/v1/models/{org_mid}").status_code == 404

    # Creation on an org provider only via the org flow.
    r = client.post("/api/v1/models", json={
        "provider_id": org_pid, "model_id": "sneak", "name": "Sneak",
        "endpoint_type": "chat_completions"})
    assert r.status_code == 404, r.text


def test_personal_schemas_carry_no_scope_fields() -> None:
    """user_id/org_id can never change scope via personal endpoints: the
    fields do not exist on personal schemas and the service reads only
    name/credentials/metadata/is_active."""
    from tollms.api.providers.schemas import ProviderCreate, ProviderUpdate

    assert "org_id" not in ProviderCreate.model_fields
    assert "user_id" not in ProviderCreate.model_fields
    assert "org_id" not in ProviderUpdate.model_fields
    assert "user_id" not in ProviderUpdate.model_fields


def test_validate_discover_stay_org_aware(db: Session, client: TestClient, user_factory) -> None:
    """Load-bearing reuse: org UI validates/discovers org rows through the
    personal endpoints, perm-gated — the boundary must not break it."""
    user_factory()
    oid = _mkorg(client)["id"]
    sid = _make_set(client, oid, "Ops", ["Providers.Read", "Providers.Validate",
                                         "Providers.RefreshModels"])
    member = _mkuser("validate")
    _invite_and_accept(client, member, db, oid, [sid])
    member_id = uuid.UUID(_me(member)["id"])

    org_pid, _ = _org_provider_with_model(client, oid, "OrgProbe")
    t = _mock()
    valid, _, _ = asyncio.run(
        providers_service.validate_provider(db, uuid.UUID(org_pid), t, user_id=member_id))
    assert valid is True
    discovered = asyncio.run(
        providers_service.discover_provider_models(db, uuid.UUID(org_pid), t, user_id=member_id))
    assert discovered.total == 1


# --- public gateway scope pin ----------------------------------------------------

def _setup_two_orgs(client: TestClient) -> tuple[dict, dict]:
    org_a = _mkorg(client, "ScopeA")
    org_b = _mkorg(client, "ScopeB")
    return org_a, org_b


def test_personal_key_cannot_use_org_model(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    _org_provider_with_model(client, oid, "OrgOnly")
    pk = _personal_key(client)
    r = client.post("/v1/chat/completions",
                    json={"model": "OrgOnly/OrgOnly-model",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {pk['raw_key']}"})
    assert r.status_code == 404, r.text


def test_org_key_cannot_use_personal_model(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    me_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    _personal_provider_with_model(client, "Personal")
    key = _issue(client, oid, me_id)
    r = client.post("/v1/chat/completions",
                    json={"model": "Personal/Personal-model",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {key['raw_key']}"})
    assert r.status_code == 404, r.text


def test_org_key_cannot_use_other_org_model(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    me_id = _me(client)["id"]
    org_a, org_b = _setup_two_orgs(client)
    _org_provider_with_model(client, org_a["id"], "ProvA")
    _org_provider_with_model(client, org_b["id"], "ProvB")
    key_a = _issue(client, org_a["id"], me_id)
    r = client.post("/v1/chat/completions",
                    json={"model": "ProvB/ProvB-model",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {key_a['raw_key']}"})
    assert r.status_code == 404, r.text


def test_unknown_catalog_model_rejected(client: TestClient, db: Session, user_factory) -> None:
    """A global-catalog-only id (never registered) resolves to nothing."""
    user_factory()
    pk = _personal_key(client)
    r = client.post("/v1/chat/completions",
                    json={"model": "definitely-not-registered-zzz",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {pk['raw_key']}"})
    assert r.status_code == 404, r.text


def test_disabled_provider_rejected(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    pid, _ = _personal_provider_with_model(client, "Doomed")
    assert client.patch(f"/api/v1/providers/{pid}", json={"is_active": False}).status_code == 200
    pk = _personal_key(client)
    r = client.post("/v1/chat/completions",
                    json={"model": "Doomed/Doomed-model",
                          "messages": [{"role": "user", "content": "hi"}]},
                    headers={"Authorization": f"Bearer {pk['raw_key']}"})
    assert r.status_code == 404, r.text


def test_member_removed_loses_org_but_keeps_personal(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    sid = _make_set(client, oid, "Crew", ["Providers.Read"])
    member = _mkuser("departing")
    _invite_and_accept(client, member, db, oid, [sid])
    member_id = _me(member)["id"]

    _org_provider_with_model(client, oid, "OrgGone")
    org_key = _issue(client, oid, member_id)
    _, _ = _personal_provider_with_model(member, "Keeps")

    # Baseline: org key reaches the org model (mocked provider I/O).
    _bind_mock(monkeypatch)
    ok = member.post("/v1/chat/completions",
                     json={"model": "OrgGone/OrgGone-model",
                           "messages": [{"role": "user", "content": "hi"}]},
                     headers={"Authorization": f"Bearer {org_key['raw_key']}"})
    assert ok.status_code == 200, ok.text

    # Root removes the member: the org key dies with membership (401 oracle).
    members = client.get(f"{ORG}/{oid}/members").json()
    target = next(m["user_id"] for m in members if m["user_id"] == member_id)
    assert client.delete(f"{ORG}/{oid}/members/{target}").status_code == 204
    gone = member.post("/v1/chat/completions",
                       json={"model": "OrgGone/OrgGone-model",
                             "messages": [{"role": "user", "content": "hi"}]},
                       headers={"Authorization": f"Bearer {org_key['raw_key']}"})
    assert gone.status_code == 401, gone.text

    # Personal access survives: member key + personal model still routes.
    mpk = _personal_key(member, name="keeps-key")
    kept = member.post("/v1/chat/completions",
                       json={"model": "Keeps/Keeps-model",
                             "messages": [{"role": "user", "content": "hi"}]},
                       headers={"Authorization": f"Bearer {mpk['raw_key']}"})
    assert kept.status_code == 200, kept.text


def test_list_public_models_pins_to_key_scope(
    client: TestClient, db: Session, user_factory,
) -> None:
    user_factory()
    me_id = _me(client)["id"]
    org_a, org_b = _setup_two_orgs(client)
    _org_provider_with_model(client, org_a["id"], "PinA")
    _org_provider_with_model(client, org_b["id"], "PinB")
    _personal_provider_with_model(client, "PinMine")

    key_a = _issue(client, org_a["id"], me_id)
    got = client.get("/v1/models", headers={"Authorization": f"Bearer {key_a['raw_key']}"})
    assert got.status_code == 200, got.text
    ids = {m["id"] for m in got.json()["data"]}
    assert ids == {"PinA/PinA-model"}, ids

    pk = _personal_key(client)
    mine = client.get("/v1/models", headers={"Authorization": f"Bearer {pk['raw_key']}"})
    assert mine.status_code == 200, mine.text
    assert {m["id"] for m in mine.json()["data"]} == {"PinMine/PinMine-model"}
