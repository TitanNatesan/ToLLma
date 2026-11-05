"""Guardrails global + key scope: global wins, key independent, mandatory lock."""

import inspect
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.main import app
from tollms.services.guardrails import resolution as resolution_engine

G = "/api/v1/guardrails"


def _only_uid(db: Session) -> uuid.UUID:
    from tollms.models.user import User

    users = db.query(User).all()
    assert len(users) == 1, [u.email for u in users]
    return users[0].id


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None):
    from tollms.models.api_key import ApiKey

    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"k-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _mk_policy(db: Session, name: str, *, user_id=None, org_id=None,
               is_enabled: bool = True, is_mandatory: bool = False):
    from tollms.models.guardrail import GuardrailPolicy

    policy = GuardrailPolicy(name=name, user_id=user_id, org_id=org_id,
                             is_enabled=is_enabled, is_mandatory=is_mandatory)
    db.add(policy)
    db.flush()
    return policy


def _mk_assignment(db: Session, policy_id: uuid.UUID, scope: str,
                   api_key_id: uuid.UUID | None = None):
    from tollms.models.guardrail import GuardrailAssignment

    row = GuardrailAssignment(policy_id=policy_id, scope_type=scope,
                              api_key_id=api_key_id)
    db.add(row)
    db.flush()
    return row


def _verified_client(email: str) -> TestClient:
    other = TestClient(app)
    r = other.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        other.get("/auth/verify", params={"token": token})
    return other


def test_global_enabled_wins_over_key_detached(client: TestClient, db: Session,
                                               user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    key = _mk_key(db, uid)
    stranger = _mk_key(db, uid)
    db.commit()
    _mk_policy(db, "GlobalOn", user_id=uid, is_enabled=True)
    db.commit()
    for kid in (None, key.id, stranger.id):
        applied = resolution_engine.resolve_applicable(
            db, user_id=uid, api_key_id=kid).applied
        assert {p.name for p in applied} == {"GlobalOn"}


def test_global_disabled_allows_key_independent(client: TestClient, db: Session,
                                                user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    key_a = _mk_key(db, uid)
    key_b = _mk_key(db, uid)
    db.commit()
    _mk_policy(db, "GlobalOff", user_id=uid, is_enabled=False)
    scoped = _mk_policy(db, "KeyOnly", user_id=uid, is_enabled=True)
    _mk_assignment(db, scoped.id, "key", api_key_id=key_a.id)
    db.commit()
    got_a = resolution_engine.resolve_applicable(
        db, user_id=uid, api_key_id=key_a.id).applied
    assert {p.name for p in got_a} == {"KeyOnly"}
    got_b = resolution_engine.resolve_applicable(
        db, user_id=uid, api_key_id=key_b.id).applied
    assert got_b == []


@pytest.mark.parametrize(
    "global_enabled,key_assigned,expected",
    [(True, False, (True, True)), (True, True, (True, True)),
     (False, True, (True, False)), (False, False, (False, False))],
)
def test_resolve_key_guardrail_state(global_enabled, key_assigned, expected) -> None:
    assert resolution_engine.resolve_key_guardrail_state(
        global_enabled=global_enabled, key_assigned=key_assigned) == expected


def test_workspace_global_enforced(client: TestClient, db: Session,
                                   user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    assert resolution_engine.workspace_global_enforced(db, user_id=uid) is False
    _mk_policy(db, "Off", user_id=uid, is_enabled=False)
    db.commit()
    assert resolution_engine.workspace_global_enforced(db, user_id=uid) is False
    scoped = _mk_policy(db, "KeyOnly", user_id=uid, is_enabled=True)
    key = _mk_key(db, uid)
    db.commit()
    _mk_assignment(db, scoped.id, "key", api_key_id=key.id)
    db.commit()
    assert resolution_engine.workspace_global_enforced(db, user_id=uid) is False
    _mk_policy(db, "On", user_id=uid, is_enabled=True)
    db.commit()
    assert resolution_engine.workspace_global_enforced(db, user_id=uid) is True
    oid = uuid.UUID(client.post("/api/v1/orgs", json={"name": "WGE Org"}).json()["id"])
    assert resolution_engine.workspace_global_enforced(
        db, user_id=uid, org_id=oid) is False
    _mk_policy(db, "OrgOn", org_id=oid, is_enabled=True)
    db.commit()
    assert resolution_engine.workspace_global_enforced(
        db, user_id=uid, org_id=oid) is True
    assert resolution_engine.workspace_global_enforced(
        db, user_id=uid, org_id=uuid.uuid4()) is False


def test_mandatory_cannot_lose_global_coverage(client: TestClient, db: Session,
                                               user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    oid = client.post("/api/v1/orgs", json={"name": "Mand Org"}).json()["id"]
    r = client.post(G, json={"name": "Mand", "org_id": oid,
                             "is_mandatory": True, "is_enabled": True})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    q = {"org_id": oid}
    assert client.post(f"{G}/{pid}/disable", params=q).status_code == 422
    assert client.patch(f"{G}/{pid}", params=q,
                        json={"is_enabled": False}).status_code == 422
    assert client.delete(f"{G}/{pid}", params=q).status_code == 422
    key = _mk_key(db, uid, org_id=uuid.UUID(oid))
    db.commit()
    r = client.patch(f"{G}/{pid}", params=q, json={"assignments": [
        {"scope_type": "key", "api_key_id": str(key.id)}]})
    assert r.status_code == 422, r.text
    r = client.patch(f"{G}/{pid}", params=q, json={"assignments": []})
    assert r.status_code == 200, r.text


def test_key_detach_from_non_mandatory_global_allowed(client: TestClient,
                                                      db: Session,
                                                      user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    pid = client.post(G, json={"name": "Loose", "is_enabled": True}).json()["id"]
    key = _mk_key(db, uid)
    db.commit()
    r = client.patch(f"{G}/{pid}", json={"assignments": [
        {"scope_type": "key", "api_key_id": str(key.id)}]})
    assert r.status_code == 200, r.text
    rows = r.json()["assignments"]
    assert len(rows) == 1 and rows[0]["scope_type"] == "key"


def test_no_team_leakage_and_cross_org_isolation(client: TestClient, db: Session,
                                                 user_factory) -> None:
    from tollms.models.guardrail import GuardrailAssignment, GuardrailPolicy
    from tollms.models.user import User

    for model in (GuardrailPolicy, GuardrailAssignment):
        assert not hasattr(model, "team_id")
    for fn in (resolution_engine.resolve_applicable,
               resolution_engine.workspace_global_enforced,
               resolution_engine.resolve_key_guardrail_state):
        params = inspect.signature(fn).parameters
        assert "team_id" not in params and "team" not in params
    user_factory(email="owner-a@tollma.ai")
    uid_a = db.query(User).filter(User.email == "owner-a@tollma.ai").one().id
    org_a = client.post("/api/v1/orgs", json={"name": "Org A"}).json()
    r = client.post(G, json={"name": "AGlobal", "org_id": org_a["id"],
                             "is_enabled": True})
    assert r.status_code == 201, r.text
    got = resolution_engine.resolve_applicable(
        db, user_id=uid_a, org_id=uuid.UUID(org_a["id"])).applied
    assert {p.name for p in got} == {"AGlobal"}
    _verified_client("b@tollma.ai")
    uid_b = db.query(User).filter(User.email == "b@tollma.ai").one().id
    assert resolution_engine.resolve_applicable(
        db, user_id=uid_b, org_id=uuid.UUID(org_a["id"])).applied == []
    assert resolution_engine.resolve_applicable(db, user_id=uid_b).applied == []
    assert resolution_engine.workspace_global_enforced(
        db, user_id=uid_b, org_id=uuid.UUID(org_a["id"])) is False


def _mand_org(client: TestClient, name: str = "MandScope Org") -> str:
    return client.post("/api/v1/orgs", json={"name": name}).json()["id"]


def _key_assignment_payload(key_id: uuid.UUID) -> list[dict]:
    return [{"scope_type": "key", "api_key_id": str(key_id)}]


def test_create_mandatory_key_only_422(client: TestClient, db: Session,
                                       user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    oid = _mand_org(client)
    key = _mk_key(db, uid, org_id=uuid.UUID(oid))
    db.commit()
    r = client.post(G, json={"name": "MandKeyOnly", "org_id": oid,
                             "is_mandatory": True, "is_enabled": True,
                             "assignments": _key_assignment_payload(key.id)})
    assert r.status_code == 422, r.text


def test_enable_mandatory_key_only_422(client: TestClient, db: Session,
                                       user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    oid = _mand_org(client)
    key = _mk_key(db, uid, org_id=uuid.UUID(oid))
    db.commit()
    r = client.post(G, json={"name": "MandOff", "org_id": oid,
                             "is_mandatory": True, "is_enabled": False,
                             "assignments": _key_assignment_payload(key.id)})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert client.post(f"{G}/{pid}/enable", params={"org_id": oid}).status_code == 422


def test_update_enable_without_assignments_on_key_only_mandatory_422(
        client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    uid = _only_uid(db)
    oid = _mand_org(client)
    key = _mk_key(db, uid, org_id=uuid.UUID(oid))
    db.commit()
    r = client.post(G, json={"name": "MandPatch", "org_id": oid,
                             "is_mandatory": True, "is_enabled": False,
                             "assignments": _key_assignment_payload(key.id)})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = client.patch(f"{G}/{pid}", params={"org_id": oid},
                     json={"is_enabled": True})
    assert r.status_code == 422, r.text
