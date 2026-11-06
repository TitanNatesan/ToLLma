"""Settings endpoints: preferences, profile, password, sessions.

Sessions live in Valkey (metadata + per-user index); usage aggregates come from
durable assistant rows tagged with messages.session_id.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.core import security
from tollms.core.config import get_settings
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.services.cache.manager import call_sync

PREFS_DEFAULTS = {
    "accent": "green",
    "accent_color": None,
    "enter_behavior": "send",
    "default_thinking_level": None,
    "auto_scroll": True,
    "stream_animations": True,
}


def _sid(client: TestClient) -> str:
    payload = security.decode_token(client.cookies.get("access_token"))
    assert payload is not None
    return str(payload["sid"])


def test_preferences_defaults_patch_clear_and_validation(client: TestClient, user_factory) -> None:
    user_factory("settings-prefs@tollma.ai")
    assert client.get("/api/v1/settings/preferences").json() == PREFS_DEFAULTS

    patched = client.patch(
        "/api/v1/settings/preferences",
        json={
            "accent": "purple",
            "accent_color": "#A1B2C3",
            "enter_behavior": "newline",
            "default_thinking_level": "medium",
            "auto_scroll": False,
            "stream_animations": False,
        },
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["accent"] == "purple" and body["accent_color"] == "#a1b2c3"
    assert body["enter_behavior"] == "newline" and body["default_thinking_level"] == "medium"
    assert body["auto_scroll"] is False and body["stream_animations"] is False

    # Partial updates keep the rest (explicit null clears, absent keys persist).
    partial = client.patch("/api/v1/settings/preferences", json={"accent": "custom"}).json()
    assert partial["accent"] == "custom" and partial["accent_color"] == "#a1b2c3"
    cleared = client.patch("/api/v1/settings/preferences", json={"accent_color": None}).json()
    assert cleared["accent_color"] is None and cleared["accent"] == "custom"

    assert client.patch("/api/v1/settings/preferences", json={"accent": "chartreuse"}).status_code == 422
    assert client.patch("/api/v1/settings/preferences", json={"accent_color": "red"}).status_code == 422
    assert client.patch("/api/v1/settings/preferences", json={"enter_behavior": "both"}).status_code == 422

    # Persisted: preferences survive a fresh read (PostgreSQL, not process state).
    assert client.get("/api/v1/settings/preferences").json() == cleared


def test_profile_update_validation_and_uniqueness(client: TestClient, db: Session, user_factory) -> None:
    user_factory("settings-profile@tollma.ai")
    r = client.patch(
        "/api/v1/settings/profile",
        json={"full_name": "  Ada Lovelace  ", "username": "Ada_1", "avatar_url": "https://example.com/a.png"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["full_name"] == "Ada Lovelace"
    assert body["username"] == "ada_1"
    assert body["avatar_url"] == "https://example.com/a.png"

    assert client.patch("/api/v1/settings/profile", json={"username": "ab"}).status_code == 422
    assert client.patch("/api/v1/settings/profile", json={"username": "Bad Name"}).status_code == 422
    assert client.patch("/api/v1/settings/profile", json={"avatar_url": "ftp://nope"}).status_code == 422

    # Username is globally unique among live users.
    from tollms.models.user import User

    db.add(User(email="taken@tollma.ai", username="taken", password_hash="x"))
    db.commit()
    conflict = client.patch("/api/v1/settings/profile", json={"username": "taken"})
    assert conflict.status_code == 409

    # Email change requires the current password (missing -> 422, wrong -> 401).
    assert client.patch("/api/v1/settings/profile", json={"email": "other@tollma.ai"}).status_code == 422
    wrong_pw = client.patch(
        "/api/v1/settings/profile",
        json={"email": "other@tollma.ai", "current_password": "wrong-password"},
    )
    assert wrong_pw.status_code == 401

    # Another user's email cannot be taken (409 before anything is sent).
    db.add(User(email="other@tollma.ai", password_hash="x"))
    db.commit()
    taken = client.patch(
        "/api/v1/settings/profile",
        json={"email": "other@tollma.ai", "current_password": "Password123"},
    )
    assert taken.status_code == 409

    # Email change stages a pending address: the current email and its
    # verification stay as-is until the new address is verified (link to the
    # new address, notice to the old one).
    changed = client.patch(
        "/api/v1/settings/profile",
        json={"email": "settings-profile-new@tollma.ai", "current_password": "Password123"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["email"] == "settings-profile@tollma.ai"
    assert changed.json()["email_verified"] is True

    # Same-address change is a no-op 200 (no password confirmation needed).
    same = client.patch("/api/v1/settings/profile", json={"email": "settings-profile@tollma.ai"})
    assert same.status_code == 200 and same.json()["email"] == "settings-profile@tollma.ai"


def test_password_change_verifies_and_revokes_other_sessions(client: TestClient, user_factory) -> None:
    user_factory("settings-password@tollma.ai")
    token1 = client.cookies.get("access_token")
    # Log in again: a second, independent session for the same user.
    second = client.post("/auth/login", json={"email": "settings-password@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert second.status_code == 200
    assert client.get("/api/v1/settings/sessions").json()["total"] == 2

    wrong = client.post(
        "/api/v1/settings/password",
        json={"current_password": "wrong-password", "new_password": "Brandnew123"},
    )
    assert wrong.status_code == 401
    same = client.post(
        "/api/v1/settings/password",
        json={"current_password": "Password123", "new_password": "Password123"},
    )
    assert same.status_code == 422
    short = client.post(
        "/api/v1/settings/password",
        json={"current_password": "Password123", "new_password": "short"},
    )
    assert short.status_code == 422

    ok = client.post(
        "/api/v1/settings/password",
        json={"current_password": "Password123", "new_password": "Brandnew123"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["revoked_sessions"] == 1

    assert client.get("/api/v1/settings/sessions").json()["total"] == 1
    # The revoked session's access token is dead (401)...
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token1}"}).status_code == 401
    # ...while the new password works.
    assert client.post("/auth/login", json={"email": "settings-password@tollma.ai", "password": "Brandnew123"}).status_code == 200


def test_sessions_usage_aggregates_and_revocation(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("settings-sessions@tollma.ai")
    uid = uuid.UUID(user["id"])
    sid1 = _sid(client)
    token1 = client.cookies.get("access_token")

    conv = Conversation(user_id=uid, title="Session usage")
    db.add(conv)
    db.commit()
    db.refresh(conv)
    db.add(
        Message(
            user_id=uid,
            conversation_id=conv.id,
            role=Role.ASSISTANT,
            content="x",
            status=MessageStatus.COMPLETED,
            session_id=sid1,
            prompt_tokens=100,
            completion_tokens=23,
            total_tokens=123,
        )
    )
    db.commit()

    client.post("/auth/login", json={"email": user["email"], "password": "Password123", "age_confirmed": True})
    listed = client.get("/api/v1/settings/sessions").json()
    assert listed["total"] == 2
    current = [s for s in listed["sessions"] if s["current"]]
    other = [s for s in listed["sessions"] if not s["current"]]
    assert len(current) == 1 and len(other) == 1
    assert other[0]["requests"] == 1 and other[0]["tokens"] == 123
    assert other[0]["last_seen"] is not None and other[0]["created_at"] is not None
    assert current[0]["login_method"] == "password"

    # The current session cannot revoke itself (use logout), others can.
    assert client.delete(f"/api/v1/settings/sessions/{current[0]['id']}").status_code == 422
    assert client.delete(f"/api/v1/settings/sessions/{other[0]['id']}").status_code == 200
    assert client.get("/api/v1/settings/sessions").json()["total"] == 1
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token1}"}).status_code == 401

    # Unknown session ids 404 (no existence oracle).
    assert client.delete("/api/v1/settings/sessions/deadbeef").status_code == 404


def test_revoke_other_sessions(client: TestClient, user_factory) -> None:
    user = user_factory("settings-revoke@tollma.ai")
    token1 = client.cookies.get("access_token")
    client.post("/auth/login", json={"email": user["email"], "password": "Password123", "age_confirmed": True})
    client.post("/auth/login", json={"email": user["email"], "password": "Password123", "age_confirmed": True})
    assert client.get("/api/v1/settings/sessions").json()["total"] == 3

    revoked = client.post("/api/v1/settings/sessions/revoke-others")
    assert revoked.status_code == 200 and revoked.json()["revoked"] == 2
    assert client.get("/api/v1/settings/sessions").json()["total"] == 1
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token1}"}).status_code == 401


def test_gateway_tags_messages_with_session_id(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory, monkeypatch
) -> None:
    from tollms.api.gateway import service as gateway_service
    from tollms.services.gateway.adapters.base import BaseProviderAdapter, StreamChunk

    user_factory("settings-gateway@tollma.ai")
    p = provider_factory("Session P")
    m = model_factory(p["id"])

    class TinyAdapter(BaseProviderAdapter):
        async def chat_stream(self, messages):
            yield StreamChunk(delta="hi")

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: TinyAdapter(credentials={}, model_id="m"))
    key_id = client.get("/api/v1/chat/keys").json()[0]["id"]
    r = client.post("/api/v1/gateway/chat", json={"provider_id": p["id"], "model_id": m["id"], "message": "hello", "key_id": key_id})
    assert r.status_code == 200, r.text

    sid = _sid(client)
    rows = db.query(Message).filter(Message.session_id == sid).all()
    assert len(rows) == 2
    assert {row.role for row in rows} == {Role.USER, Role.ASSISTANT}
    assistant = next(row for row in rows if row.role == Role.ASSISTANT)
    # TinyAdapter reports no usage -> estimated pricing, flagged durably.
    assert assistant.usage_estimated is True
    assert assistant.session_id == sid

    sessions = client.get("/api/v1/settings/sessions").json()["sessions"]
    assert sessions[0]["requests"] == 1


# --- Phase 6 email-change hardening -------------------------------------------
# Home for the staged email-change contract (PATCH /settings/profile never
# swaps directly). Existing `test_profile_update_validation_and_uniqueness`
# covers the basic 422/401/409/staged/same-address shape; the tests below
# prove the full lifecycle: pending exposure, consume/swap, TTLs, resend
# routing, overwrite, Google-method freshness, and the verified gate.


def _install_change_captures(monkeypatch: pytest.MonkeyPatch) -> tuple[list[dict], list[dict]]:
    """Capture change-verification emails + old-address notices deterministically."""
    verifs: list[dict] = []
    notices: list[dict] = []

    def _cap_verify(to: str, verification_url: str) -> bool:
        verifs.append({"to": to, "url": verification_url})
        return True

    def _cap_notice(to: str, new_email: str, requested_at: str) -> bool:
        notices.append({"to": to, "new_email": new_email, "requested_at": requested_at})
        return True

    monkeypatch.setattr(auth_service, "send_verification_email", _cap_verify)
    monkeypatch.setattr(auth_service, "send_email_change_notice", _cap_notice)
    return verifs, notices


def _change_token(verifs: list[dict]) -> str:
    assert verifs, "no change-verification email captured"
    url = verifs[-1]["url"]
    assert "/verify?token=" in url, url
    return url.split("token=")[-1].split("&")[0]


def _google_passwordless(db: Session) -> tuple[object, str, str]:
    """Passwordless Google user + live google-method session (no OAuth round trip)."""
    import uuid as _uuid

    from tollms.models.user import AuthProvider, User

    google_id = f"google-{_uuid.uuid4().hex[:10]}"
    user = User(
        email=f"g-{_uuid.uuid4().hex[:8]}@gmail.com",
        provider="google",
        provider_user_id=google_id,
        auth_provider=AuthProvider.GOOGLE,
        google_id=google_id,
        has_password=False,
        password_hash=None,
        email_verified=True,
        age_confirmed_at=datetime.now(timezone.utc),
        age_confirm_method="self_declaration:test-helper",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    sid = call_sync(security.create_session(user.id, user.email, "google"))
    assert sid
    token = security.create_access_token(user.id, user.email, sid)
    return user, sid, token


def _backdate_session_created(sid: str, age_seconds: int) -> None:
    """Age a Valkey session's created_at; last_seen stays fresh so only the
    15-minute email-change freshness check can fail (idle 8h / absolute 90d pass)."""
    from tollms.services.cache import keys as cache_keys
    from tollms.services.cache.manager import get_manager

    key = cache_keys.session(sid)
    record = call_sync(get_manager().get(key))
    assert isinstance(record, dict), "session missing for backdate"
    record["created_at"] = (datetime.now(timezone.utc) - timedelta(seconds=age_seconds)).isoformat()
    assert call_sync(get_manager().set(key, record)) is True


def _authz(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_email_change_stage_verify_and_replay(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    verifs, notices = _install_change_captures(monkeypatch)
    old = "change-full@tollma.ai"
    new = "change-full-new@tollma.ai"
    user_factory(old)
    # Signup verification email is pre-change noise; change assertions start clean.
    verifs.clear()
    notices.clear()

    # Missing password -> 422, wrong password -> 401, nothing sent.
    assert client.patch("/api/v1/settings/profile", json={"email": new}).status_code == 422
    wrong = client.patch(
        "/api/v1/settings/profile", json={"email": new, "current_password": "wrong-password"}
    )
    assert wrong.status_code == 401
    assert verifs == [] and notices == []

    # Taken address -> 409 before anything is sent.
    from tollms.models.user import User

    db.add(User(email=new, password_hash="x"))
    db.commit()
    taken = client.patch(
        "/api/v1/settings/profile", json={"email": new, "current_password": "Password123"}
    )
    assert taken.status_code == 409
    assert verifs == [] and notices == []
    # Free the address for the real stage (hard-delete the blocker row).
    db.query(User).filter(User.email == new).delete()
    db.commit()

    # Stage: 200, email unchanged, verified untouched, pending exposed.
    staged = client.patch(
        "/api/v1/settings/profile", json={"email": new, "current_password": "Password123"}
    )
    assert staged.status_code == 200, staged.text
    assert staged.json()["email"] == old
    assert staged.json()["email_verified"] is True
    assert staged.json()["pending_email"] == new

    me = client.get("/auth/me").json()
    assert me["email"] == old and me["pending_email"] == new and me["email_verified"] is True

    # Link goes to the NEW address; fact-only notice goes to the OLD one.
    assert len(verifs) == 1 and verifs[0]["to"] == new
    assert len(notices) == 1 and notices[0]["to"] == old and notices[0]["new_email"] == new
    for value in (notices[0]["to"], notices[0]["new_email"], notices[0]["requested_at"]):
        lowered = value.lower()
        assert "token" not in lowered and "http" not in lowered and "verify" not in lowered
    assert verifs[0]["url"] not in notices[0].values()

    # Consume: swap, verify, clear pending.
    token = _change_token(verifs)
    consumed = client.get("/auth/verify", params={"token": token})
    assert consumed.status_code == 200, consumed.text
    assert consumed.json()["user"]["email"] == new
    assert consumed.json()["user"]["pending_email"] is None
    assert consumed.json()["user"]["email_verified"] is True

    me2 = client.get("/auth/me").json()
    assert me2["email"] == new and me2["pending_email"] is None

    # Replay of the consumed change link is idempotent 200.
    replay = client.get("/auth/verify", params={"token": token})
    assert replay.status_code == 200
    assert replay.json()["user"]["email"] == new

    # Same-address change is a no-op 200 (no password needed).
    same = client.patch("/api/v1/settings/profile", json={"email": new})
    assert same.status_code == 200 and same.json()["email"] == new


def test_email_change_stale_request_rejected(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    verifs, _ = _install_change_captures(monkeypatch)
    old = "change-stale@tollma.ai"
    new = "change-stale-new@tollma.ai"
    user_factory(old)
    verifs.clear()
    assert client.patch(
        "/api/v1/settings/profile", json={"email": new, "current_password": "Password123"}
    ).status_code == 200
    token = _change_token(verifs)

    # Backdate the request beyond the 24h verification TTL (token itself is fresh).
    from tollms.models.user import User

    row = db.query(User).filter(User.email == old).one()
    row.pending_email_requested_at = datetime.now(timezone.utc) - timedelta(hours=25)
    db.commit()

    denied = client.get("/auth/verify", params={"token": token})
    assert denied.status_code == 422, denied.text
    me = client.get("/auth/me").json()
    assert me["email"] == old and me["pending_email"] == new


def test_email_change_resend_targets_pending(
    client: TestClient, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    verifs, _ = _install_change_captures(monkeypatch)
    old = "change-resend@tollma.ai"
    new = "change-resend-new@tollma.ai"
    user_factory(old)
    verifs.clear()
    assert client.patch(
        "/api/v1/settings/profile", json={"email": new, "current_password": "Password123"}
    ).status_code == 200
    assert verifs[-1]["to"] == new
    verifs.clear()

    resent = client.post("/auth/resend-verification")
    assert resent.status_code == 200, resent.text
    assert resent.json()["sent"] is True
    assert len(verifs) == 1
    assert verifs[0]["to"] == new
    assert old not in [v["to"] for v in verifs]


def test_email_change_second_request_overwrites(
    client: TestClient, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    verifs, _ = _install_change_captures(monkeypatch)
    old = "change-overwrite@tollma.ai"
    first = "change-overwrite-1@tollma.ai"
    second = "change-overwrite-2@tollma.ai"
    user_factory(old)
    verifs.clear()

    assert client.patch(
        "/api/v1/settings/profile", json={"email": first, "current_password": "Password123"}
    ).status_code == 200
    token1 = _change_token(verifs)

    assert client.patch(
        "/api/v1/settings/profile", json={"email": second, "current_password": "Password123"}
    ).status_code == 200
    token2 = _change_token(verifs)
    assert token1 != token2
    assert client.get("/auth/me").json()["pending_email"] == second

    # First link no longer matches the pending address -> 422, unchanged.
    assert client.get("/auth/verify", params={"token": token1}).status_code == 422
    assert client.get("/auth/me").json()["email"] == old

    # Second link swaps.
    ok = client.get("/auth/verify", params={"token": token2})
    assert ok.status_code == 200, ok.text
    assert ok.json()["user"]["email"] == second
    assert client.get("/auth/me").json()["pending_email"] is None


def test_email_change_google_fresh_session_allows(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    verifs, notices = _install_change_captures(monkeypatch)
    user, _sid, token = _google_passwordless(db)
    old = user.email
    new = f"changed-{uuid.uuid4().hex[:8]}@gmail.com"

    staged = client.patch(
        "/api/v1/settings/profile", json={"email": new}, headers=_authz(token)
    )
    assert staged.status_code == 200, staged.text
    assert staged.json()["email"] == old
    assert staged.json()["pending_email"] == new
    assert verifs[-1]["to"] == new
    assert notices[-1]["to"] == old

    swapped = client.get("/auth/verify", params={"token": _change_token(verifs)})
    assert swapped.status_code == 200, swapped.text
    assert swapped.json()["user"]["email"] == new


def test_email_change_stale_google_session_forbidden(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    verifs, _ = _install_change_captures(monkeypatch)
    user, sid, token = _google_passwordless(db)
    _backdate_session_created(sid, age_seconds=3600)  # >15min, < idle/absolute

    denied = client.patch(
        "/api/v1/settings/profile",
        json={"email": f"stale-{uuid.uuid4().hex[:8]}@gmail.com"},
        headers=_authz(token),
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"]["message"] == "recent Google sign-in required"
    assert verifs == []


def test_email_change_password_session_on_passwordless_forbidden(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_change_captures(monkeypatch)
    user, _, _ = _google_passwordless(db)
    pw_sid = call_sync(security.create_session(user.id, user.email, "password"))
    pw_token = security.create_access_token(user.id, user.email, pw_sid)

    denied = client.patch(
        "/api/v1/settings/profile",
        json={"email": f"pw-{uuid.uuid4().hex[:8]}@gmail.com"},
        headers=_authz(pw_token),
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"]["message"] == "recent Google sign-in required"


def test_email_change_unverified_local_gate(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_change_captures(monkeypatch)
    r = client.post("/auth/signup", json={"email": "change-gated@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text

    # Verified gate fires before the password check: 403, never 422.
    denied = client.patch(
        "/api/v1/settings/profile",
        json={"email": "change-gated-new@tollma.ai", "current_password": "Password123"},
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"]["code"] == "EMAIL_VERIFICATION_REQUIRED"


def test_email_change_rate_scope_guards_profile(
    client: TestClient, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_rate_limit_attempts", 2)
    monkeypatch.setattr(settings, "auth_rate_limit_window_seconds", 60)
    user_factory("change-ratelimit@tollma.ai")

    assert client.patch("/api/v1/settings/profile", json={"full_name": "A"}).status_code == 200
    assert client.patch("/api/v1/settings/profile", json={"full_name": "B"}).status_code == 200
    denied = client.patch("/api/v1/settings/profile", json={"full_name": "C"})
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert int(denied.headers.get("retry-after", "0")) > 0
