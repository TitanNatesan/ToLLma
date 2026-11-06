"""Org model registry: register / toggle / soft-delete on org-owned providers.

Covers POST/PATCH/DELETE /api/v1/orgs/{oid}/.../models: register 201
(+422 on provider mismatch, 404 for non-members), partial update via PATCH
(incl. is_active toggles), soft-delete via DELETE, and the guarantee that
org model ops never touch the personal primary allow-list (sync/prune stay
personal-only).
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.main import app
from tollms.models.api_key import ApiKey, ApiKeyModelPermission

ORG = "/api/v1/orgs"


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"orgmodels-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "OrgModels Org") -> dict:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _org_provider(c: TestClient, oid: str, name: str = "OrgModelProv") -> dict:
    r = c.post(
        f"{ORG}/{oid}/providers",
        json={"name": name, "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _model_body(mid: str = "om-1", name: str = "Org Model 1", **kw) -> dict:
    return {
        "model_id": mid,
        "name": name,
        "endpoint_type": "chat_completions",
        "input_price": "2.5",
        "output_price": "10",
        **kw,
    }


def _primary(c: TestClient, db) -> ApiKey:
    uid = uuid.UUID(_me(c)["id"])
    db.expire_all()
    return db.scalar(
        select(ApiKey).where(
            ApiKey.user_id == uid,
            ApiKey.org_id.is_(None),
            ApiKey.is_primary.is_(True),
            ApiKey.is_deleted.is_(False),
        )
    )


def _primary_pairs(db, key_id: uuid.UUID) -> set[tuple[str, str]]:
    return {
        (str(r.provider_id), str(r.model_id))
        for r in db.scalars(
            select(ApiKeyModelPermission).where(ApiKeyModelPermission.api_key_id == key_id)
        )
    }


def test_org_model_register_201_without_or_matching_provider_id(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    pid = _org_provider(client, oid)["id"]

    # provider_id omitted: the path owns the scope.
    r = client.post(f"{ORG}/{oid}/providers/{pid}/models", json=_model_body())
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["provider_id"] == pid
    assert first["model_id"] == "om-1"
    assert first["is_active"] is True
    assert first["id"]

    # provider_id present and matching the path: also 201.
    r = client.post(
        f"{ORG}/{oid}/providers/{pid}/models",
        json=_model_body("om-2", "Org Model 2", provider_id=pid),
    )
    assert r.status_code == 201, r.text
    assert r.json()["provider_id"] == pid

    listed = client.get(f"{ORG}/{oid}/providers/{pid}/models")
    assert listed.status_code == 200, listed.text
    assert sorted(m["model_id"] for m in listed.json()) == ["om-1", "om-2"]


def test_org_model_register_422_on_provider_mismatch(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    pid = _org_provider(client, oid)["id"]

    r = client.post(
        f"{ORG}/{oid}/providers/{pid}/models",
        json=_model_body(provider_id=str(uuid.uuid4())),
    )
    assert r.status_code == 422, r.text


def test_org_model_register_404_for_non_member_and_wrong_org(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid_a = _mkorg(client, "ScopeA")["id"]
    oid_b = _mkorg(client, "ScopeB")["id"]
    pid_a = _org_provider(client, oid_a, "ProvA")["id"]

    stranger = _mkuser("stranger")
    assert stranger.post(
        f"{ORG}/{oid_a}/providers/{pid_a}/models", json=_model_body()
    ).status_code == 404

    # Same root belongs to both orgs, but the provider lives in A.
    r = client.post(f"{ORG}/{oid_b}/providers/{pid_a}/models", json=_model_body())
    assert r.status_code == 404, r.text

    # Unknown provider id in the right org is also 404.
    r = client.post(f"{ORG}/{oid_a}/providers/{uuid.uuid4()}/models", json=_model_body())
    assert r.status_code == 404, r.text


def test_org_model_toggle_via_patch(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    pid = _org_provider(client, oid)["id"]
    mid = client.post(f"{ORG}/{oid}/providers/{pid}/models", json=_model_body()).json()["id"]

    stranger = _mkuser("stranger")
    assert stranger.patch(f"{ORG}/{oid}/models/{mid}", json={"is_active": False}).status_code == 404

    r = client.patch(f"{ORG}/{oid}/models/{mid}", json={"is_active": False})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False

    # Inactive org models stay listed (the UI shows a Disabled badge).
    listed = client.get(f"{ORG}/{oid}/providers/{pid}/models")
    assert listed.status_code == 200, listed.text
    assert [(m["id"], m["is_active"]) for m in listed.json()] == [(mid, False)]

    r = client.patch(f"{ORG}/{oid}/models/{mid}", json={"is_active": True, "name": "Renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True
    assert r.json()["name"] == "Renamed"


def test_org_model_soft_delete_via_delete(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    pid = _org_provider(client, oid)["id"]
    mid = client.post(f"{ORG}/{oid}/providers/{pid}/models", json=_model_body()).json()["id"]

    stranger = _mkuser("stranger")
    assert stranger.delete(f"{ORG}/{oid}/models/{mid}").status_code == 404

    r = client.delete(f"{ORG}/{oid}/models/{mid}")
    assert r.status_code == 204, r.text

    listed = client.get(f"{ORG}/{oid}/providers/{pid}/models")
    assert listed.status_code == 200, listed.text
    assert [m["id"] for m in listed.json()] == []

    from tollms.models.registered_model import AIModel

    db.expire_all()
    row = db.get(AIModel, uuid.UUID(mid))
    assert row is not None and row.is_deleted is True and row.is_active is False


def test_org_model_ops_leave_personal_primary_untouched(
    client: TestClient, db, user_factory
) -> None:
    user_factory()

    # Personal provider + model: the signup primary gains one allow-list row.
    prov = client.post(
        "/api/v1/providers",
        json={"name": "PersonalProv", "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert prov.status_code == 201, prov.text
    personal_pid = prov.json()["id"]
    mod = client.post(
        "/api/v1/models",
        json={"provider_id": personal_pid, "model_id": "p1", "name": "P1",
              "endpoint_type": "chat_completions"},
    )
    assert mod.status_code == 201, mod.text

    before = _primary(client, db)
    assert before is not None
    before_pairs = _primary_pairs(db, before.id)
    assert before_pairs == {(personal_pid, mod.json()["id"])}

    # Org register + toggle + delete must not move the personal primary.
    oid = _mkorg(client)["id"]
    opid = _org_provider(client, oid)["id"]
    created = client.post(f"{ORG}/{oid}/providers/{opid}/models", json=_model_body())
    assert created.status_code == 201, created.text
    omid = created.json()["id"]
    assert client.patch(f"{ORG}/{oid}/models/{omid}", json={"is_active": False}).status_code == 200
    assert client.delete(f"{ORG}/{oid}/models/{omid}").status_code == 204

    after = _primary(client, db)
    assert after is not None and after.id == before.id
    assert after.is_default is True
    assert _primary_pairs(db, after.id) == before_pairs
    assert omid not in {m for _, m in _primary_pairs(db, after.id)}
    # Org rows never carry the personal user scope.
    assert after.org_id is None
