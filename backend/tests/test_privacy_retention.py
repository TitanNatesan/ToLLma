"""Retention CRUD + F9 precedence: TTL min, zero-retention, org gating."""

import uuid
from datetime import datetime, timezone

import tollms.models.privacy  # noqa: F401 — register tables before create_all
from tollms.api.privacy import service as privacy_service
from tests.test_privacy_helpers import privacy_client


def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["id"])


def test_set_and_list_personal(client, db, user_factory):
    user = user_factory("r-personal@tollma.ai")
    pc = privacy_client(db, _uid(user))
    r = pc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "prompt_logs", "retention_days": 90},
    )
    assert r.status_code == 200, r.text
    assert r.json()["retention_days"] == 90
    rows = pc.get("/api/v1/privacy/retention").json()
    assert len(rows) == 1 and rows[0]["data_category"] == "prompt_logs"


def test_null_days_means_forever(client, db, user_factory):
    user = user_factory("r-forever@tollma.ai")
    pc = privacy_client(db, _uid(user))
    r = pc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "messages", "retention_days": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["retention_days"] is None


def test_invalid_category_and_days_422(client, db, user_factory):
    user = user_factory("r-bad@tollma.ai")
    pc = privacy_client(db, _uid(user))
    assert pc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "keystrokes", "retention_days": 30},
    ).status_code == 422
    assert pc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "messages", "retention_days": 0},
    ).status_code == 422


def test_zero_retention_helper(client, db, user_factory):
    user = user_factory("r-zero@tollma.ai")
    uid = _uid(user)
    pc = privacy_client(db, uid)
    assert privacy_service.is_zero_retention(db, uid) is False
    pc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "prompt_logs", "zero_retention": True},
    )
    assert privacy_service.is_zero_retention(db, uid) is True
    # Other categories unaffected.
    assert privacy_service.is_zero_retention(db, uid, data_category="messages") is False


def test_resolve_most_restrictive_and_forever(client, db, user_factory):
    user = user_factory("r-resolve@tollma.ai")
    uid = _uid(user)
    pc = privacy_client(db, uid)
    assert privacy_service.resolve_retention(db, uid, "prompt_logs") == (None, False)
    pc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "prompt_logs", "retention_days": 90},
    )
    assert privacy_service.resolve_retention(db, uid, "prompt_logs") == (90, False)


def test_org_scope_member_write_and_stranger_404(client, db, user_factory):
    owner = user_factory("r-org-owner@tollma.ai")
    # client is authed as owner here: create the org before minting the stranger.
    oid = client.post("/api/v1/orgs", json={"name": "Ret Org"}).json()["id"]
    stranger = user_factory("r-org-stranger@tollma.ai")
    opc = privacy_client(db, _uid(owner))
    r = opc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "request_logs", "retention_days": 30, "org_id": oid},
    )
    assert r.status_code == 200, r.text
    assert r.json()["org_id"] == oid
    # Stranger (no membership): 404 oracle, never 403.
    spc = privacy_client(db, _uid(stranger))
    denied = spc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "request_logs", "retention_days": 30, "org_id": oid},
    )
    assert denied.status_code == 404, denied.text
    assert spc.get("/api/v1/privacy/retention", params={"org_id": oid}).status_code == 404
    # Stranger resolving with the org falls back to personal scope only.
    assert privacy_service.resolve_retention(
        db, _uid(stranger), "request_logs", uuid.UUID(oid)
    ) == (None, False)


def test_org_zero_retention_short_circuits(client, db, user_factory):
    owner = user_factory("r-org-zero@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "Zero Org"}).json()["id"]
    opc = privacy_client(db, _uid(owner))
    opc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "prompt_logs", "retention_days": 365, "org_id": oid},
    )
    assert privacy_service.is_zero_retention(db, _uid(owner), uuid.UUID(oid)) is False
    opc.put(
        "/api/v1/privacy/retention",
        json={"data_category": "prompt_logs", "zero_retention": True, "org_id": oid},
    )
    assert privacy_service.is_zero_retention(db, _uid(owner), uuid.UUID(oid)) is True
