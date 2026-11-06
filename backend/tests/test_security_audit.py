"""Security audit log + self-revoke + KEK status (Agent C, Wave 2)."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import tollms.models.security_audit as _security_audit  # noqa: F401 (register table)
from tollms.api.auth.router import router as auth_router
from tollms.api.security import service
from tollms.api.security.router import router as security_router
from tollms.core.deps import get_db
from tollms.core.exceptions import register_handlers
from tollms.models.security_audit import SecurityAuditEvent, SecurityEventType
from tollms.models.user import PlatformRole, User

assert _security_audit.SecurityAuditEvent is SecurityAuditEvent


@pytest.fixture()
def sclient(db: Session):
    app = FastAPI()
    register_handlers(app)
    app.include_router(auth_router)
    app.include_router(security_router)

    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _signup_verified(sclient: TestClient, email: str) -> dict:
    r = sclient.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    assert token, "verification token expected outside prod"
    v = sclient.get("/auth/verify", params={"token": token})
    assert v.status_code == 200, v.text
    return v.json()["user"]


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _seed(db: Session, n: int, event_type: str = "gateway.denied") -> list:
    rows = []
    for i in range(n):
        row = service.record_event(
            db, event_type=event_type, actor_type="user",
            outcome="denied", reason="budget_exhausted",
            request_id=f"req-{i}", metadata={"attempt": i},
        )
        assert row is not None
        rows.append(row)
    return rows


def test_record_event_writes_row(db: Session) -> None:
    row = service.record_event(
        db, event_type=SecurityEventType.AUTH_LOGIN, actor_type="user",
        actor_user_id=uuid.uuid4(), outcome="allowed", metadata={"provider": "local"},
    )
    assert row is not None
    fetched = db.get(SecurityAuditEvent, row.event_id)
    assert fetched is not None
    assert fetched.event_type == "auth.login"
    assert fetched.metadata_ == {"provider": "local"}


def test_record_event_scrubs_secret_fields(db: Session) -> None:
    row = service.record_event(
        db, event_type="key.created", actor_type="user",
        metadata={
            "api_key": "tma_sk_live_secret", "password": "hunter2",
            "token": "abc", "email": "u@x.ai", "ip": "1.2.3.4",
            "key_id": str(uuid.uuid4()),
        },
    )
    assert row is not None
    meta = dict(row.metadata_)
    for key, value in meta.items():
        assert "secret" not in str(value).lower() or value == "[redacted]", key
    assert meta["api_key"] == "[redacted]"
    assert meta["password"] == "[redacted]"
    assert "key_id" in meta  # ids survive the scrub


def test_audit_read_requires_platform_admin(sclient: TestClient, db: Session) -> None:
    _signup_verified(sclient, "user@tollma.ai")
    r = sclient.get("/api/v1/security/audit")
    assert r.status_code == 403, r.text


def test_audit_read_unauthenticated_denied(sclient: TestClient) -> None:
    r = sclient.get("/api/v1/security/audit")
    assert r.status_code in (401, 403), r.text


def test_admin_list_filter_and_cursor_paging(sclient: TestClient, db: Session) -> None:
    user = _signup_verified(sclient, "admin@tollma.ai")
    _promote(db, user["id"])
    _seed(db, 3, "gateway.denied")
    service.record_event(db, event_type="auth.login", actor_type="user", outcome="allowed")

    r = sclient.get("/api/v1/security/audit", params={"event_type": "gateway.denied"})
    assert r.status_code == 200, r.text
    assert len(r.json()) == 3

    page1 = sclient.get("/api/v1/security/audit", params={"limit": 2})
    assert page1.status_code == 200, page1.text
    assert len(page1.json()) == 2
    anchor = page1.json()[-1]["event_id"]
    page2 = sclient.get("/api/v1/security/audit", params={"limit": 2, "cursor": anchor})
    assert page2.status_code == 200, page2.text
    assert len(page2.json()) == 2  # 4 rows total, anchor-exclusive remainder
    assert {e["event_id"] for e in page1.json()}.isdisjoint({e["event_id"] for e in page2.json()})

    bad = sclient.get("/api/v1/security/audit", params={"cursor": "not-a-cursor"})
    assert bad.status_code == 422, bad.text


def test_revoke_all_kills_own_session(sclient: TestClient, db: Session) -> None:
    _signup_verified(sclient, "gone@tollma.ai")
    r = sclient.post("/api/v1/security/sessions/revoke-all")
    assert r.status_code == 200, r.text
    assert r.json()["revoked"] >= 1
    me = sclient.get("/api/v1/security/kek/status")
    assert me.status_code == 401, me.text  # session dead, re-login required


def test_kek_status_shape_without_secrets(sclient: TestClient) -> None:
    _signup_verified(sclient, "kek@tollma.ai")
    r = sclient.get("/api/v1/security/kek/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"algorithm", "kek_version", "rotation_supported", "previous_version_expires_at"}
    assert body["algorithm"] == "fernet"
    assert body["kek_version"] == 1
    assert body["rotation_supported"] is False
    blob = str(body).lower()
    assert "secret" not in blob and "key_material" not in blob
