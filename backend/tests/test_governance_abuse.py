"""Governance: abuse-report intake, scan flags, transitions, appeal, isolation."""

import uuid

import tollms.models.governance  # noqa: F401  (register tables; Wave 3 wires models/__init__)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.main import app
from tollms.api.governance.router import router as _gov_router

if not any(
    getattr(r, "path", None) == "/api/v1/governance/abuse-reports"
    for r in app.routes
):
    # Wave 3 (orchestrator) wires main.py; tests register the router directly.
    app.include_router(_gov_router)

G = "/api/v1/governance/abuse-reports"


def _promote(db: Session, user_id: str) -> None:
    from tollms.models.user import PlatformRole, User

    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _other_client(email: str) -> TestClient:
    other = TestClient(app)
    r = other.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = other.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return other


def _report(**kw) -> dict:
    body = {"reason_code": "harmful_content", "details": "offensive output", **kw}
    return body


def test_submit_scans_details(client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post(G, json=_report(
        details="leaked my email a@tollma.ai and key sk-abcdefgh12345678"))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "submitted"
    assert "pii" in body["scan_flags"] and "secret_leakage" in body["scan_flags"]
    assert body["details"].startswith("leaked my email")
    assert client.get(f"{G}/{body['id']}").status_code == 200


def test_submit_validation(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.post(G, json=_report(reason_code="nope")).status_code == 422
    assert client.post(G, json=_report(subject_type="nope")).status_code == 422
    assert client.post(G, json=_report(details="x" * 4001)).status_code == 422


def test_cross_user_isolation(client: TestClient, user_factory) -> None:
    user_factory(email="a@tollma.ai")
    rid = client.post(G, json=_report()).json()["id"]
    other = _other_client("b@tollma.ai")
    assert other.get(G).json() == []
    assert other.get(f"{G}/{rid}").status_code == 404
    assert other.post(f"{G}/{rid}/appeal",
                      json={"appeal_note": "mine"}).status_code == 404


def test_status_transitions(client: TestClient, db: Session, user_factory) -> None:
    me = user_factory()
    rid = client.post(G, json=_report()).json()["id"]
    _promote(db, me["id"])
    # submitted -> action_taken direct is illegal.
    r = client.patch(f"{G}/{rid}/status", json={"status": "action_taken"})
    assert r.status_code == 422, r.text
    assert client.patch(f"{G}/{rid}/status",
                        json={"status": "under_review"}).status_code == 200
    r = client.patch(f"{G}/{rid}/status",
                     json={"status": "action_taken", "resolution_note": "key revoked"})
    assert r.status_code == 200 and r.json()["resolution_note"] == "key revoked"
    # action_taken is terminal for PATCH (appeal path owns the next step).
    assert client.patch(f"{G}/{rid}/status",
                        json={"status": "dismissed"}).status_code == 422


def test_appeal_once_rule(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    rid = client.post(G, json=_report()).json()["id"]
    # Appeal before action_taken is rejected.
    assert client.post(f"{G}/{rid}/appeal",
                       json={"appeal_note": "too early"}).status_code == 422
    # Status moves need an admin; the reporter stays non-admin throughout.
    admin = _other_client("admin@tollma.ai")
    from tollms.models.user import PlatformRole, User

    admin_user = db.query(User).filter(User.email == "admin@tollma.ai").one()
    admin_user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()
    assert admin.patch(f"{G}/{rid}/status",
                       json={"status": "under_review"}).status_code == 200
    assert admin.patch(f"{G}/{rid}/status",
                       json={"status": "dismissed"}).status_code == 200
    # Appeal from a terminal non-action state is rejected.
    assert client.post(f"{G}/{rid}/appeal",
                       json={"appeal_note": "late"}).status_code == 422

    rid2 = client.post(G, json=_report()).json()["id"]
    assert admin.patch(f"{G}/{rid2}/status",
                       json={"status": "under_review"}).status_code == 200
    assert admin.patch(f"{G}/{rid2}/status",
                       json={"status": "action_taken"}).status_code == 200
    r = client.post(f"{G}/{rid2}/appeal", json={"appeal_note": "please review again"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "appeal_filed"
    # Second appeal is rejected (one appeal per report).
    assert client.post(f"{G}/{rid2}/appeal",
                       json={"appeal_note": "again"}).status_code == 422
    r = admin.patch(f"{G}/{rid2}/status", json={"status": "action_upheld"})
    assert r.status_code == 200, r.text
    assert admin.patch(f"{G}/{rid2}/status",
                       json={"status": "dismissed"}).status_code == 422


def test_org_report_visibility(client: TestClient, db: Session, user_factory) -> None:
    me = user_factory(email="owner@tollma.ai")
    _promote(db, me["id"])
    oid = client.post("/api/v1/orgs", json={"name": "Abuse Org"}).json()["id"]
    rid = client.post(G, json=_report(org_id=oid)).json()["id"]
    assert any(r["id"] == rid for r in client.get(G).json())
    other = _other_client("outsider@tollma.ai")
    assert all(r["id"] != rid for r in other.get(G).json())
    assert other.get(f"{G}/{rid}").status_code == 404
    # Filing into a foreign org is a 404 oracle, never a leak.
    assert other.post(G, json=_report(org_id=oid)).status_code == 404
