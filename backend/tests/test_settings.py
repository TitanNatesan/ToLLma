"""Settings endpoints: preferences, profile, password, sessions.

Sessions live in Valkey (metadata + per-user index); usage aggregates come from
durable assistant rows tagged with messages.session_id.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.core import security
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role

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

    # Email change resets verification (a verification link is re-issued).
    changed = client.patch("/api/v1/settings/profile", json={"email": "settings-profile-new@tollma.ai"})
    assert changed.status_code == 200 and changed.json()["email"] == "settings-profile-new@tollma.ai"
    assert changed.json()["email_verified"] is False

    # Another user's email cannot be taken.
    db.add(User(email="other@tollma.ai", password_hash="x"))
    db.commit()
    assert client.patch("/api/v1/settings/profile", json={"email": "other@tollma.ai"}).status_code == 409


def test_password_change_verifies_and_revokes_other_sessions(client: TestClient, user_factory) -> None:
    user_factory("settings-password@tollma.ai")
    token1 = client.cookies.get("access_token")
    # Log in again: a second, independent session for the same user.
    second = client.post("/auth/login", json={"email": "settings-password@tollma.ai", "password": "Password123"})
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

    client.post("/auth/login", json={"email": user["email"], "password": "Password123"})
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
    client.post("/auth/login", json={"email": user["email"], "password": "Password123"})
    client.post("/auth/login", json={"email": user["email"], "password": "Password123"})
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
    r = client.post("/api/v1/gateway/chat", json={"provider_id": p["id"], "model_id": m["id"], "message": "hello"})
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
