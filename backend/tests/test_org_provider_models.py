"""Org provider models: GET /api/v1/orgs/{org_id}/providers/{provider_id}/models.

Covers the unified providers page org scope (live models as ModelRead).
"""

import uuid

from fastapi.testclient import TestClient

from tollms.main import app

ORG = "/api/v1/orgs"


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"provmodels-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "ProvModels Org") -> dict:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _email_of(c: TestClient) -> str:
    return _me(c)["email"]


def _token(db, invitation_id: str) -> str:
    from tollms.models.organization import Invitation

    inv = db.get(Invitation, uuid.UUID(invitation_id))
    db.refresh(inv)
    return inv.token


def _invite_and_accept(root: TestClient, member: TestClient, db, oid: str, set_ids: list[str]) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations", json={"email": _email_of(member), "set_ids": set_ids})
    assert inv.status_code == 201, inv.text
    acc = member.post(f"{ORG}/invitations/by-token/{_token(db, inv.json()['id'])}/accept")
    assert acc.status_code == 200, acc.text


def _member_set_id(c: TestClient, oid: str, name: str = "Member") -> str:
    sets = c.get(f"{ORG}/{oid}/sets").json()
    return next(s["id"] for s in sets if s["name"] == name)


def _make_set(c: TestClient, oid: str, name: str, codes: list[str]) -> str:
    r = c.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": codes})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _register(c: TestClient, oid: str, name: str = "OrgWiz", models: list[dict] | None = None) -> dict:
    payload = {
        "name": name,
        "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": models
        if models is not None
        else [
            {"model_id": "m1", "name": "M1", "endpoint_type": "chat_completions"},
            {"model_id": "m2", "name": "M2", "endpoint_type": "chat_completions",
             "input_price": "2.5", "output_price": "10"},
        ],
    }
    r = c.post(f"{ORG}/{oid}/providers/register", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_list_org_provider_models_returns_live_models_as_model_read(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    prov = _register(client, oid, name="LiveProv")
    pid = prov["id"]

    r = client.get(f"{ORG}/{oid}/providers/{pid}/models")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2
    by_mid = {m["model_id"]: m for m in body}
    assert sorted(by_mid) == ["m1", "m2"]
    for m in body:
        assert m["provider_id"] == pid
        assert m["id"]
        assert m["name"]
        assert m["endpoint_type"] == "chat_completions"
        # ModelRead shape: pricing + registry metadata, no secrets.
        assert "input_price" in m and "output_price" in m
        assert "credentials" not in str(m) and "credentials_encrypted" not in str(m)
    assert by_mid["m2"]["name"] == "M2"


def test_list_org_provider_models_empty_for_provider_without_models(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    created = client.post(
        f"{ORG}/{oid}/providers",
        json={"name": "BareProv", "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert created.status_code == 201, created.text
    pid = created.json()["id"]

    r = client.get(f"{ORG}/{oid}/providers/{pid}/models")
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_list_org_provider_models_404_for_non_member(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    pid = _register(client, oid)["id"]

    stranger = _mkuser("stranger")
    assert stranger.get(f"{ORG}/{oid}/providers/{pid}/models").status_code == 404


def test_list_org_provider_models_404_for_wrong_org_provider(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid_a = _mkorg(client, "ScopeA")["id"]
    oid_b = _mkorg(client, "ScopeB")["id"]
    pid_a = _register(client, oid_a, name="ProvA")["id"]

    # Same root belongs to both orgs, but the provider lives in A.
    r = client.get(f"{ORG}/{oid_b}/providers/{pid_a}/models")
    assert r.status_code == 404, r.text

    # Unknown provider id in the right org is also 404.
    r = client.get(f"{ORG}/{oid_a}/providers/{uuid.uuid4()}/models")
    assert r.status_code == 404, r.text


def test_list_org_provider_models_requires_providers_read(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    pid = _register(client, oid)["id"]

    sub = _mkuser("noread")
    _invite_and_accept(client, sub, db, oid, [_member_set_id(client, oid)])

    # Member without Providers.Read gets the 404 oracle (never 403).
    assert sub.get(f"{ORG}/{oid}/providers/{pid}/models").status_code == 404, sub.get(f"{ORG}/{oid}/providers").text

    # Granting Providers.Read unlocks the listing with identical ModelRead shape.
    reader = _make_set(client, oid, "ModelReader", ["Providers.Read"])
    grant = client.post(f"{ORG}/{oid}/members/{_me(sub)['id']}/sets", json={"set_ids": [reader]})
    assert grant.status_code == 200, grant.text
    r = sub.get(f"{ORG}/{oid}/providers/{pid}/models")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2
    assert all(m["provider_id"] == pid for m in r.json())
