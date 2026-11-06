"""Phase 3 email-verification tests (permanent).

Covers the verification contract:
  * A. Feature gate — unverified users keep the auth/session surface
     (login/logout/me/GET sessions/GET preferences/verify) but every
     feature route answers 403 EMAIL_VERIFICATION_REQUIRED. Verified
     users (email or Google) are unaffected.
  * B. Resend — 200 sent True + email captured; immediate retry 429 with
     Retry-After (per-user cooldown); verified users get sent False with
     no email; per-IP burst limit 429s.
  * C. /auth/me lifecycle — False before verification, True after.
  * D. Auth rate bursts — reset-validate + google-login + google-callback
     429 with Retry-After under low monkeypatched limits.

Only low limits monkeypatched inside individual tests — global defaults
in `tollms.core.config.Settings` are never touched.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.core import security
from tollms.core.config import get_settings
from tollms.models.user import AuthProvider, User
from tollms.services.cache.manager import call_sync

GATE_CODE = "EMAIL_VERIFICATION_REQUIRED"


def _signup(client: TestClient, email: str = "gate@tollma.ai", password: str = "Password123") -> dict:
    r = client.post("/auth/signup", json={"email": email, "password": password, "age_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()


def _verify(client: TestClient, token: str) -> dict:
    r = client.get("/auth/verify", params={"token": token})
    assert r.status_code == 200, r.text
    return r.json()


def _google_user(db: Session) -> tuple[User, str]:
    """A Google-verified account + a live session token (no OAuth round trip)."""
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
    sid = call_sync(security.create_session(user.id, user.email, "google"))
    return user, security.create_access_token(user.id, user.email, sid)


def _assert_gated(response) -> None:
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == GATE_CODE


# --- A. feature gate -----------------------------------------------------------


def test_unverified_allowed_surface_never_403(client: TestClient) -> None:
    body = _signup(client, email="allowed@tollma.ai")
    assert body["user"]["email_verified"] is False

    me = client.get("/auth/me")
    assert me.status_code == 200 and me.json()["email_verified"] is False

    sessions = client.get("/api/v1/settings/sessions")
    assert sessions.status_code == 200, sessions.text

    prefs = client.get("/api/v1/settings/preferences")
    assert prefs.status_code == 200, prefs.text

    # Garbage token is a validation failure (422), never a gate denial.
    bad = client.get("/auth/verify", params={"token": "garbage"})
    assert bad.status_code == 422, bad.text

    client.cookies.clear()  # drop signup session; login must stand alone
    login = client.post("/auth/login", json={"email": "allowed@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert login.status_code == 200, login.text

    logout = client.post("/auth/logout")
    assert logout.status_code == 200, logout.text

    for response in (me, sessions, prefs, bad, login, logout):
        assert response.status_code != 403


def _gated_body(kind: str) -> dict | None:
    if kind == "gateway-chat":
        return {"provider_id": str(uuid.uuid4()), "model_id": str(uuid.uuid4()), "message": "hi"}
    if kind == "provider-create":
        return {"name": "P", "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}}
    if kind == "model-create":
        # Bogus provider: the 403 gate must fire before any 404 existence check.
        return {"provider_id": str(uuid.uuid4()), "model_id": "m", "name": "M",
                "endpoint_type": "chat_completions"}
    if kind == "key-create":
        return {"name": "k1"}
    if kind == "exports":
        return {"all": True, "format": "md"}
    if kind == "prefs":
        return {"accent": "blue"}
    if kind == "profile":
        return {"full_name": "New Name"}
    if kind == "password":
        return {"current_password": "Password123", "new_password": "NewPassword456"}
    if kind == "shares":
        # Random conversation: the 403 gate must fire before any 404 ownership check.
        return {"conversation_id": str(uuid.uuid4())}
    return None


GATED_ROUTES = [
    pytest.param("POST", "/api/v1/gateway/chat", "gateway-chat", id="gateway-chat"),
    pytest.param("POST", "/api/v1/providers", "provider-create", id="provider-create"),
    pytest.param("POST", "/api/v1/models", "model-create", id="model-create"),
    pytest.param("POST", "/api/v1/keys", "key-create", id="key-create"),
    pytest.param("GET", "/api/v1/analytics/summary", "none", id="analytics-summary"),
    pytest.param("GET", "/api/v1/analytics/export", "none", id="analytics-export"),
    pytest.param("POST", "/api/v1/exports/conversations", "exports", id="exports-conversations"),
    pytest.param("PATCH", "/api/v1/settings/preferences", "prefs", id="settings-preferences"),
    pytest.param("PATCH", "/api/v1/settings/profile", "profile", id="settings-profile"),
    pytest.param("POST", "/api/v1/settings/password", "password", id="settings-password"),
    pytest.param("GET", "/api/v1/request-logs", "none", id="request-logs"),
    pytest.param("POST", "/api/v1/shares", "shares", id="shares-create"),
]


@pytest.mark.parametrize("method,path,kind", GATED_ROUTES)
def test_gated_routes_require_verification(client: TestClient, method: str, path: str, kind: str) -> None:
    _signup(client)
    _assert_gated(client.request(method, path, json=_gated_body(kind)))


def test_verified_user_passes_gate(client: TestClient) -> None:
    body = _signup(client, email="verified@tollma.ai")
    _verify(client, body["debug_verification_token"])

    created = client.post(
        "/api/v1/providers",
        json={"name": "P", "provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert created.status_code == 201, created.text

    summary = client.get("/api/v1/analytics/summary")
    assert summary.status_code == 200, summary.text

    logs = client.get("/api/v1/request-logs")
    assert logs.status_code == 200, logs.text

    patched = client.patch("/api/v1/settings/preferences", json={"accent": "blue"})
    assert patched.status_code == 200, patched.text

    key = client.post("/api/v1/keys", json={"name": "k1"})
    assert key.status_code == 201, key.text


def test_google_verified_user_unaffected(client: TestClient, db: Session) -> None:
    _user, token = _google_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    providers = client.get("/api/v1/providers", headers=headers)
    assert providers.status_code == 200, providers.text

    summary = client.get("/api/v1/analytics/summary", headers=headers)
    assert summary.status_code == 200, summary.text


# --- B. resend-verification ----------------------------------------------------


@pytest.fixture()
def sent_verification_emails(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Capture verification emails deterministically."""
    sent: list[dict] = []

    def _capture(to: str, verification_url: str) -> bool:
        sent.append({"to": to, "url": verification_url})
        return True

    monkeypatch.setattr(auth_service, "send_verification_email", _capture)
    return sent


def test_resend_sends_then_cooldown_429(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, sent_verification_emails: list[dict]
) -> None:
    settings = get_settings()
    # High burst budget isolates the per-user cooldown from the per-IP flood guard.
    monkeypatch.setattr(settings, "auth_rate_limit_attempts", 1000)
    body = _signup(client, email="resend@tollma.ai")
    sent_verification_emails.clear()

    first = client.post("/auth/resend-verification")
    assert first.status_code == 200, first.text
    assert first.json() == {"sent": True, "cooldown_seconds": settings.verification_resend_cooldown_seconds}
    assert len(sent_verification_emails) == 1
    assert sent_verification_emails[0]["to"] == body["user"]["email"]

    # Immediate retry is still cooling down: 429 + Retry-After, no new email.
    retry = client.post("/auth/resend-verification")
    assert retry.status_code == 429, retry.text
    assert retry.json()["error"]["code"] == "RATE_LIMITED"
    assert int(retry.headers.get("retry-after", "0")) > 0
    assert len(sent_verification_emails) == 1


def test_resend_verified_is_idempotent_no_email(
    client: TestClient, sent_verification_emails: list[dict]
) -> None:
    body = _signup(client, email="already@tollma.ai")
    _verify(client, body["debug_verification_token"])
    sent_verification_emails.clear()

    r = client.post("/auth/resend-verification")
    assert r.status_code == 200, r.text
    assert r.json() == {"sent": False, "cooldown_seconds": 0}
    assert sent_verification_emails == []


def test_resend_burst_rate_limited_429(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Sign up first: the signup scope has its own budget, the resend scope is
    # what the low monkeypatched limit applies to below.
    tokens = [_signup(client, email=f"burst-{i}@tollma.ai")["access_token"] for i in range(3)]
    assert all(tokens)

    settings = get_settings()
    monkeypatch.setattr(settings, "auth_rate_limit_attempts", 2)
    monkeypatch.setattr(settings, "auth_rate_limit_window_seconds", 60)

    # Fresh user per call: no per-user cooldown entry, so only the per-IP
    # burst guard can deny.
    assert client.post(
        "/auth/resend-verification", headers={"Authorization": f"Bearer {tokens[0]}"}
    ).status_code == 200
    assert client.post(
        "/auth/resend-verification", headers={"Authorization": f"Bearer {tokens[1]}"}
    ).status_code == 200

    denied = client.post(
        "/auth/resend-verification", headers={"Authorization": f"Bearer {tokens[2]}"}
    )
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert int(denied.headers.get("retry-after", "0")) > 0


# --- C. /auth/me lifecycle -----------------------------------------------------


def test_me_reflects_verification_lifecycle(client: TestClient) -> None:
    body = _signup(client, email="lifecycle@tollma.ai")
    assert client.get("/auth/me").json()["email_verified"] is False

    _verify(client, body["debug_verification_token"])
    me = client.get("/auth/me")
    assert me.status_code == 200 and me.json()["email_verified"] is True


# --- D. auth rate bursts -------------------------------------------------------


def _low_limits(monkeypatch: pytest.MonkeyPatch, attempts: int = 2) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_rate_limit_attempts", attempts)
    monkeypatch.setattr(settings, "auth_rate_limit_window_seconds", 60)


def test_reset_validate_burst_429(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _low_limits(monkeypatch)
    params = {"token": "x" * 40}
    assert client.get("/auth/reset-password/validate", params=params).status_code == 200
    assert client.get("/auth/reset-password/validate", params=params).status_code == 200

    denied = client.get("/auth/reset-password/validate", params=params)
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert int(denied.headers.get("retry-after", "0")) > 0


def test_google_login_burst_429(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:8000/auth/google/callback")
    _low_limits(monkeypatch)

    first = client.get("/auth/google/login", follow_redirects=False)
    assert first.status_code in (302, 307), first.text
    second = client.get("/auth/google/login", follow_redirects=False)
    assert second.status_code in (302, 307), second.text

    denied = client.get("/auth/google/login", follow_redirects=False)
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert int(denied.headers.get("retry-after", "0")) > 0


def test_google_callback_burst_429(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:8000/auth/google/callback")
    _low_limits(monkeypatch)
    params = {"code": "auth-code", "state": "bogus"}

    # Bogus state is rejected, but each attempt still consumes burst budget.
    assert client.get("/auth/google/callback", params=params, follow_redirects=False).status_code == 401
    assert client.get("/auth/google/callback", params=params, follow_redirects=False).status_code == 401

    denied = client.get("/auth/google/callback", params=params, follow_redirects=False)
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert int(denied.headers.get("retry-after", "0")) > 0
