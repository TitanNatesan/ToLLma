"""Legal registry + acceptance + 18+ gate (orchestrator-owned, F1/F2/F3)."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def _signup(client: TestClient, email: str, age: bool = True) -> dict:
    r = client.post(
        "/auth/signup",
        json={"email": email, "password": "Password123", "age_confirmed": age},
    )
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_signup_requires_age_confirmation(client: TestClient) -> None:
    r = client.post(
        "/auth/signup",
        json={"email": "kid@tollma.ai", "password": "Password123", "age_confirmed": False},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_signup_stamps_age_and_starts_unverified(client: TestClient, db: Session) -> None:
    user = _signup(client, "aged@tollma.ai")
    assert user["age_confirmed"] is True


def test_legacy_user_gated_until_confirm_age(client: TestClient, db: Session,
                                             user_factory) -> None:
    from tollms.models.user import User

    user = user_factory("legacy@tollma.ai")
    row = db.get(User, uuid.UUID(user["id"]))
    row.age_confirmed_at = None
    db.commit()
    # Feature router denies with age code while session endpoints still work.
    r = client.get("/api/v1/privacy/consents")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "AGE_CONFIRMATION_REQUIRED"
    ok = client.post("/auth/confirm-age")
    assert ok.status_code == 200, ok.text
    assert ok.json()["user"]["age_confirmed"] is True
    r2 = client.get("/api/v1/privacy/consents")
    assert r2.status_code == 200, r2.text


def test_legal_acceptance_flow(client: TestClient, db: Session, user_factory) -> None:
    from tollms.api.legal import service as legal_service

    user_factory("legal@tollma.ai")
    # Register + publish a doc as draft then publish via service (admin path
    # covered by platform gate; service-level test here).
    from tollms.models.user import User

    admin = db.query(User).filter(User.email == "legal@tollma.ai").one()
    doc = legal_service.upsert_document(
        db, slug="test-terms", version="0.1.0", title="Test Terms",
        locale="en-IN", body="# Test\nbody", requires_reaccept=False,
        effective_at=None, publish=True,
    )
    assert doc["status"] == "published"
    assert doc["content_hash"].startswith("sha256:")
    r = client.get("/api/v1/legal/documents")
    assert r.status_code == 200
    assert any(d["slug"] == "test-terms" for d in r.json())
    a = client.post("/api/v1/legal/acceptances", json={"slug": "test-terms"})
    assert a.status_code == 200, a.text
    first = a.json()["id"]
    again = client.post("/api/v1/legal/acceptances", json={"slug": "test-terms"})
    assert again.json()["id"] == first  # idempotent on same hash
    hist = client.get("/api/v1/legal/acceptances/me")
    assert any(h["document_slug"] == "test-terms" for h in hist.json())
    # Published versions are immutable.
    from tollms.core.exceptions import ConflictError

    try:
        legal_service.upsert_document(
            db, slug="test-terms", version="0.1.0", title="X", locale="en-IN",
            body="# Test\nother", requires_reaccept=False, effective_at=None,
            publish=False,
        )
    except ConflictError:
        pass
    else:
        raise AssertionError("published version must be immutable")
