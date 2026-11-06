"""Provider-aware auth: local vs Google accounts, and the password reset flow.

Covers: no account enumeration, hashed single-use tokens, expiry, session
invalidation after reset, and 403 password management for OAuth accounts.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

import pytest

from tollms.api.auth import service as auth_service
from tollms.core import security
from tollms.models.password_reset import PasswordResetToken
from tollms.models.user import AuthProvider, User
from tollms.services.cache.manager import call_sync


@pytest.fixture(autouse=True)
def sent_reset_emails(monkeypatch) -> list[dict]:
    """Capture reset emails deterministically (SMTP may be configured in dev)."""
    sent: list[dict] = []

    def _capture(to: str, reset_url: str, expires_in: str = "1 hour") -> bool:
        sent.append({"to": to, "url": reset_url, "expires_in": expires_in})
        return True

    monkeypatch.setattr(auth_service, "send_password_reset_email", _capture)
    return sent


def _token_from(sent: list[dict]) -> str:
    assert sent, "no reset email captured"
    marker = "/auth/reset-password?token="
    url = sent[-1]["url"]
    return url[url.index(marker) + len(marker):]


def _google_user(db: Session) -> tuple[User, str]:
    """A Google-only account + a live session token (no OAuth round trip)."""
    google_id = f"google-{uuid.uuid4().hex[:10]}"
    user = User(
        email=f"g-{uuid.uuid4().hex[:8]}@gmail.com",
        provider="google",
        provider_user_id=google_id,
        auth_provider=AuthProvider.GOOGLE,
        google_id=google_id,
        has_password=False,
        email_verified=True,
        age_confirmed_at=datetime.now(timezone.utc),
        age_confirm_method="self_declaration:test-helper",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    sid = call_sync(
        security.create_session(
            user.id,
            user.email,
            "google",
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            ip="172.19.0.1",
        )
    )
    token = security.create_access_token(user.id, user.email, sid)
    return user, token


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- provider identity -------------------------------------------------------


def test_local_signup_reports_local_provider(client: TestClient) -> None:
    r = client.post("/auth/signup", json={"email": "local@example.com", "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["provider"] == "local"
    assert user["has_password"] is True

    me = client.get("/auth/me").json()
    assert me["provider"] == "local"
    assert me["has_password"] is True


def test_google_account_reports_google_provider(client: TestClient, db: Session) -> None:
    _user, token = _google_user(db)
    me = client.get("/auth/me", headers=_auth(token)).json()
    assert me["provider"] == "google"
    assert me["has_password"] is False
    assert me["auth_provider"] == "GOOGLE"


def test_sessions_expose_provider_and_location(client: TestClient, db: Session) -> None:
    _user, token = _google_user(db)
    body = client.get("/api/v1/settings/sessions", headers=_auth(token)).json()
    assert body["total"] == 1
    session = body["sessions"][0]
    assert session["provider"] == "google"
    assert session["location"] == "Local network"
    assert session["browser"] == "Chrome"
    assert session["os"] == "Linux"


def test_local_session_reports_local_provider(client: TestClient, user_factory) -> None:
    user_factory("sessions-local@example.com")
    body = client.get("/api/v1/settings/sessions").json()
    assert body["sessions"][0]["provider"] == "local"


# --- password management is local-only ---------------------------------------


def test_change_password_forbidden_for_google(client: TestClient, db: Session) -> None:
    _user, token = _google_user(db)
    r = client.post(
        "/api/v1/settings/password",
        headers=_auth(token),
        json={"current_password": "whatever", "new_password": "Password123"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_change_password_requires_policy(client: TestClient, user_factory) -> None:
    user_factory("policy@example.com")
    weak = client.post(
        "/api/v1/settings/password",
        json={"current_password": "Password123", "new_password": "alllowercase1"},
    )
    assert weak.status_code == 422
    assert "uppercase" in weak.json()["error"]["message"]

    ok = client.post(
        "/api/v1/settings/password",
        json={"current_password": "Password123", "new_password": "NewPassword456"},
    )
    assert ok.status_code == 200, ok.text


# --- forgot password ---------------------------------------------------------


def test_forgot_password_sends_link_for_local_user(
    client: TestClient, user_factory, db: Session, sent_reset_emails: list[dict]
) -> None:
    user_factory("forgot@example.com")
    r = client.post("/auth/forgot-password", json={"email": "forgot@example.com"})
    assert r.status_code == 200
    assert r.json() == {"success": True}

    assert len(sent_reset_emails) == 1
    assert sent_reset_emails[0]["to"] == "forgot@example.com"
    assert sent_reset_emails[0]["url"].startswith("http://localhost:3000/auth/reset-password?token=")
    token = _token_from(sent_reset_emails)

    # Only the hash is persisted — the raw token never touches the database.
    rows = db.execute(select(PasswordResetToken)).scalars().all()
    assert len(rows) == 1
    assert rows[0].token_hash == security.hash_reset_token(token)
    assert token not in rows[0].token_hash
    assert rows[0].expires_at > datetime.now(timezone.utc)
    assert rows[0].used_at is None


def test_forgot_password_never_enumerates_accounts(
    client: TestClient, user_factory, db: Session, sent_reset_emails: list[dict]
) -> None:
    user_factory("known@example.com")

    unknown = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    known = client.post("/auth/forgot-password", json={"email": "known@example.com"})
    assert unknown.status_code == known.status_code == 200
    assert unknown.json() == known.json() == {"success": True}

    _google_user(db)
    google_email = db.execute(select(User.email).where(User.provider == "google")).scalar_one()
    google = client.post("/auth/forgot-password", json={"email": google_email})
    assert google.status_code == 200
    assert google.json() == {"success": True}

    # Exactly one email: the local account. Google accounts get nothing.
    assert len(sent_reset_emails) == 1
    assert sent_reset_emails[0]["to"] == "known@example.com"
    google_tokens = db.execute(
        select(PasswordResetToken).where(PasswordResetToken.user_id == db.execute(
            select(User.id).where(User.email == google_email)
        ).scalar_one())
    ).scalars().all()
    assert google_tokens == []


def test_validate_reset_token_masks_email(
    client: TestClient, user_factory, sent_reset_emails: list[dict]
) -> None:
    user_factory("masked@example.com")
    client.post("/auth/forgot-password", json={"email": "masked@example.com"})
    token = _token_from(sent_reset_emails)

    body = client.get("/auth/reset-password/validate", params={"token": token}).json()
    assert body["valid"] is True
    assert body["email"] == "m***d@example.com"
    assert "masked@" not in body["email"]

    invalid = client.get("/auth/reset-password/validate", params={"token": "x" * 40}).json()
    assert invalid == {"valid": False, "email": None}


# --- reset password ----------------------------------------------------------


def test_reset_password_end_to_end(
    client: TestClient, user_factory, db: Session, sent_reset_emails: list[dict]
) -> None:
    user_factory("reset@example.com")
    first_token = client.cookies.get("access_token")
    client.post("/auth/forgot-password", json={"email": "reset@example.com"})
    token = _token_from(sent_reset_emails)

    weak = client.post("/auth/reset-password", json={"token": token, "password": "short"})
    assert weak.status_code == 422

    ok = client.post("/auth/reset-password", json={"token": token, "password": "BrandNew123"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["success"] is True
    assert ok.json()["message"] == "Password updated successfully."

    # Token is single-use.
    replay = client.post("/auth/reset-password", json={"token": token, "password": "Another123"})
    assert replay.status_code == 422
    assert replay.json()["error"]["code"] == "VALIDATION_ERROR"

    # Every existing session was invalidated (force re-login).
    assert client.get("/auth/me", headers=_auth(first_token or "")).status_code == 401

    # New password works, old one does not.
    assert client.post("/auth/login", json={"email": "reset@example.com", "password": "BrandNew123"}).status_code == 200
    assert client.post("/auth/login", json={"email": "reset@example.com", "password": "Password123", "age_confirmed": True}).status_code == 401


def test_expired_reset_token_is_rejected(
    client: TestClient, user_factory, db: Session, sent_reset_emails: list[dict]
) -> None:
    user_factory("expired@example.com")
    client.post("/auth/forgot-password", json={"email": "expired@example.com"})
    token = _token_from(sent_reset_emails)

    row = db.execute(select(PasswordResetToken)).scalars().one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    assert client.get("/auth/reset-password/validate", params={"token": token}).json()["valid"] is False
    r = client.post("/auth/reset-password", json={"token": token, "password": "BrandNew123"})
    assert r.status_code == 422


def test_using_one_token_invalidates_siblings(
    client: TestClient, user_factory, db: Session, sent_reset_emails: list[dict]
) -> None:
    user_factory("siblings@example.com")
    client.post("/auth/forgot-password", json={"email": "siblings@example.com"})
    first = _token_from(sent_reset_emails)
    client.post("/auth/forgot-password", json={"email": "siblings@example.com"})
    second = _token_from(sent_reset_emails)

    assert client.post("/auth/reset-password", json={"token": first, "password": "BrandNew123"}).status_code == 200
    stale = client.post("/auth/reset-password", json={"token": second, "password": "Another123"})
    assert stale.status_code == 422


def test_signup_enforces_password_policy(client: TestClient) -> None:
    weak = client.post("/auth/signup", json={"email": "weak@example.com", "password": "alllowercase1", "age_confirmed": True})
    assert weak.status_code == 422
    assert "uppercase" in weak.json()["error"]["message"]


# --- Google-with-password reset matrix ---------------------------------------


def _google_with_password(db: Session) -> tuple[User, str]:
    """Google account that later set a local password (dual login).

    DB-insert pattern mirrored from `_google_user` + the single write path
    (`auth_service.set_password`) so `has_password` is True.
    """
    user, token = _google_user(db)
    auth_service.set_password(user, "Password123")
    db.commit()
    db.refresh(user)
    assert user.has_password is True
    return user, token


def test_forgot_reset_end_to_end_google_with_password(
    client: TestClient, db: Session, sent_reset_emails: list[dict]
) -> None:
    user, _token = _google_with_password(db)
    email = user.email

    r = client.post("/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    assert r.json() == {"success": True}
    assert len(sent_reset_emails) == 1
    assert sent_reset_emails[0]["to"] == email
    token = _token_from(sent_reset_emails)

    ok = client.post("/auth/reset-password", json={"token": token, "password": "BrandNew123"})
    assert ok.status_code == 200, ok.text

    # Dual login: email+password works after the reset; old password is dead.
    client.cookies.clear()
    assert client.post("/auth/login", json={"email": email, "password": "BrandNew123"}).status_code == 200
    assert client.post("/auth/login", json={"email": email, "password": "Password123", "age_confirmed": True}).status_code == 401


def test_google_only_forgot_silent_reset_rejected(
    client: TestClient, db: Session, sent_reset_emails: list[dict]
) -> None:
    user, _token = _google_user(db)

    r = client.post("/auth/forgot-password", json={"email": user.email})
    assert r.status_code == 200
    assert r.json() == {"success": True}
    assert sent_reset_emails == []

    rows = db.execute(select(PasswordResetToken)).scalars().all()
    assert rows == []

    bad = client.post("/auth/reset-password", json={"token": "x" * 40, "password": "BrandNew123"})
    assert bad.status_code == 422
    assert client.get("/auth/reset-password/validate", params={"token": "x" * 40}).json() == {
        "valid": False,
        "email": None,
    }


# --- set-password endpoint ----------------------------------------------------


def test_set_password_google_verified_end_to_end(client: TestClient, db: Session) -> None:
    user, token = _google_user(db)
    assert user.has_password is False

    r = client.post(
        "/api/v1/settings/password/set",
        headers=_auth(token),
        json={"password": "NewPassword123"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "password set"}

    me = client.get("/auth/me", headers=_auth(token)).json()
    assert me["has_password"] is True

    # Dual login: email+password now works alongside Google.
    client.cookies.clear()
    login = client.post("/auth/login", json={"email": user.email, "password": "NewPassword123"})
    assert login.status_code == 200, login.text

    # Change-password accepts the freshly set password (has_password-keyed).
    changed = client.post(
        "/api/v1/settings/password",
        json={"current_password": "NewPassword123", "new_password": "AnotherPass123"},
    )
    assert changed.status_code == 200, changed.text

    # Second set is a conflict (use change-password instead). Note: the
    # change-password above revoked the original Google session, so the
    # current (password-login) session is used here.
    again = client.post(
        "/api/v1/settings/password/set",
        json={"password": "YetAnother123"},
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "CONFLICT"


def test_set_password_weak_rejected(client: TestClient, db: Session) -> None:
    _user, token = _google_user(db)
    r = client.post(
        "/api/v1/settings/password/set",
        headers=_auth(token),
        json={"password": "alllowercase1"},
    )
    assert r.status_code == 422
    assert "uppercase" in r.json()["error"]["message"]


def test_set_password_unverified_forbidden(client: TestClient, db: Session) -> None:
    """Passwordless + unverified account: the verified gate denies with 403."""
    google_id = f"google-{uuid.uuid4().hex[:10]}"
    user = User(
        email=f"g-{uuid.uuid4().hex[:8]}@gmail.com",
        provider="google",
        provider_user_id=google_id,
        auth_provider=AuthProvider.GOOGLE,
        google_id=google_id,
        has_password=False,
        email_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    sid = call_sync(
        security.create_session(
            user.id,
            user.email,
            "google",
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            ip="172.19.0.1",
        )
    )
    token = security.create_access_token(user.id, user.email, sid)

    r = client.post(
        "/api/v1/settings/password/set",
        headers=_auth(token),
        json={"password": "NewPassword123"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "EMAIL_VERIFICATION_REQUIRED"


def test_set_password_anonymous_unauthorized(client: TestClient) -> None:
    anon = TestClient(client.app)
    r = anon.post("/api/v1/settings/password/set", json={"password": "NewPassword123"})
    assert r.status_code == 401
