"""Consent CRUD: enum validation, idempotency, 404-oracle, 422 rules."""

import uuid

import tollms.models.privacy  # noqa: F401 — register tables before create_all
from tollms.api.privacy import service as privacy_service
from tests.test_privacy_helpers import privacy_client


def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["id"])


def test_grant_and_list(client, db, user_factory):
    user = user_factory("c-grant@tollma.ai")
    pc = privacy_client(db, _uid(user))
    r = pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "granted"
    rows = pc.get("/api/v1/privacy/consents").json()
    assert [x["category"] for x in rows] == ["analytics"]


def test_regrant_idempotent_no_version_bump(client, db, user_factory):
    user = user_factory("c-idem@tollma.ai")
    pc = privacy_client(db, _uid(user))
    first = pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True}).json()
    second = pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True}).json()
    assert first["id"] == second["id"]
    assert first["version"] == second["version"] == 1


def test_withdraw_and_regrant_bumps_version(client, db, user_factory):
    user = user_factory("c-cycle@tollma.ai")
    pc = privacy_client(db, _uid(user))
    pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True})
    w = pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": False}).json()
    assert w["status"] == "withdrawn" and w["withdrawn_at"] is not None and w["version"] == 2
    g = pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True}).json()
    assert g["status"] == "granted" and g["version"] == 3


def test_functional_withdraw_422(client, db, user_factory):
    user = user_factory("c-func@tollma.ai")
    pc = privacy_client(db, _uid(user))
    r = pc.put("/api/v1/privacy/consents", json={"category": "functional", "granted": False})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert pc.put("/api/v1/privacy/consents", json={"category": "functional", "granted": True}).status_code == 200


def test_invalid_category_422(client, db, user_factory):
    user = user_factory("c-bad@tollma.ai")
    pc = privacy_client(db, _uid(user))
    r = pc.put("/api/v1/privacy/consents", json={"category": "tracking", "granted": True})
    assert r.status_code == 422, r.text


def test_cross_user_isolation(client, db, user_factory):
    a = user_factory("c-a@tollma.ai")
    b = user_factory("c-b@tollma.ai")
    privacy_client(db, _uid(a)).put(
        "/api/v1/privacy/consents", json={"category": "analytics", "granted": True}
    )
    assert privacy_client(db, _uid(b)).get("/api/v1/privacy/consents").json() == []


def test_consent_withdrawn_helper(client, db, user_factory):
    user = user_factory("c-help@tollma.ai")
    uid = _uid(user)
    assert privacy_service.consent_withdrawn(db, uid, "analytics") is False
    pc = privacy_client(db, uid)
    pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": True})
    assert privacy_service.consent_withdrawn(db, uid, "analytics") is False
    pc.put("/api/v1/privacy/consents", json={"category": "analytics", "granted": False})
    assert privacy_service.consent_withdrawn(db, uid, "analytics") is True
