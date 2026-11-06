"""Session hardening (Phase 5): rotation, reuse revocation, absolute/idle
bounds, per-user cap, login audit hygiene, logout-after-rotation.

Test-only file: mutates Valkey session records directly (never sleeps) to
simulate aged sessions. Source bugs go to New Findings — never fix src here.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from tollms.core import security
from tollms.core.config import get_settings
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import get_manager

PASSWORD = "Password123"


def _signup_login(client: TestClient, email: str) -> dict:
    """Fresh verified user + one password login; returns access/refresh/sid."""
    r = client.post("/auth/signup", json={"email": email, "password": PASSWORD, "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    assert token
    v = client.get("/auth/verify", params={"token": token})
    assert v.status_code == 200, v.text
    client.cookies.clear()
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD, "age_confirmed": True})
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    refresh = client.cookies.get("refresh_token")
    assert access and refresh
    payload = security.decode_token(refresh)
    assert payload and payload.get("type") == "refresh"
    return {"access": access, "refresh": refresh, "sid": str(payload["sid"])}


def _login_again(client: TestClient, email: str) -> dict:
    """Extra login for an existing user (multi-session scenarios)."""
    client.cookies.clear()
    r = client.post("/auth/login", json={"email": email, "password": PASSWORD, "age_confirmed": True})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]
    refresh = client.cookies.get("refresh_token")
    assert access and refresh
    payload = security.decode_token(refresh)
    assert payload and payload.get("type") == "refresh"
    return {"access": access, "refresh": refresh, "sid": str(payload["sid"])}


def _refresh_with(app_client_factory, app, refresh_token: str):
    """Refresh with an explicit token (no cookie-jar ambiguity)."""
    anon = TestClient(app)
    return anon.post("/auth/refresh", json={"refresh_token": refresh_token})


def _get_record(sid: str) -> dict:
    async def _go():
        return await get_manager().get(cache_keys.session(sid))

    record = asyncio.run(_go())
    assert isinstance(record, dict), f"session record missing for sid={sid}"
    return record


def _put_record(sid: str, record: dict, ttl: int = 7 * 86400) -> None:
    async def _go():
        ok = await get_manager().set(cache_keys.session(sid), record, ttl=ttl)
        assert ok, "Valkey session write failed"

    asyncio.run(_go())


def _age_record(sid: str, **fields: str) -> None:
    record = _get_record(sid)
    record.update(fields)
    _put_record(sid, record)


def _iso_ago(**kwargs) -> str:
    return (datetime.now(timezone.utc) - timedelta(**kwargs)).isoformat()


# --- rotation ---------------------------------------------------------------


def test_rotation_issues_new_refresh_and_second_hop_works(client: TestClient) -> None:
    _signup_login(client, email="rot@tollma.ai")
    r1 = client.cookies.get("refresh_token")
    assert r1

    first = client.post("/auth/refresh")
    assert first.status_code == 200, first.text
    r2 = first.json().get("refresh_token")
    a2 = first.json().get("access_token")
    assert r2 and a2, "rotated refresh_token must be returned for API clients"
    assert r2 != r1, "rotation must mint a new refresh token"

    # New access token is live.
    assert client.get("/auth/me").status_code == 200

    # Chain second hop with the rotated token (explicit body, no jar state).
    second = _refresh_with(TestClient, client.app, r2)
    assert second.status_code == 200, second.text
    r3 = second.json().get("refresh_token")
    assert r3 and r3 != r2, "second hop must rotate again"

    # Stale first-generation token is now dead.
    replay = _refresh_with(TestClient, client.app, r1)
    assert replay.status_code == 401, replay.text


# --- reuse ------------------------------------------------------------------


def test_reuse_replay_revokes_entire_family(client: TestClient) -> None:
    sess_a = _signup_login(client, email="reuse@tollma.ai")
    sess_b = _login_again(client, email="reuse@tollma.ai")
    assert sess_a["sid"] != sess_b["sid"]

    # Rotate A once: RA2 is current, RA is stale.
    rotated = _refresh_with(TestClient, client.app, sess_a["refresh"])
    assert rotated.status_code == 200, rotated.text
    ra2 = rotated.json()["refresh_token"]

    # Replay the stale token: reuse detected → whole family revoked.
    replay = _refresh_with(TestClient, client.app, sess_a["refresh"])
    assert replay.status_code == 401, replay.text

    # Both sessions are dead: sibling refresh, rotated refresh, both access.
    assert _refresh_with(TestClient, client.app, sess_b["refresh"]).status_code == 401
    assert _refresh_with(TestClient, client.app, ra2).status_code == 401
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {sess_a['access']}"}).status_code == 401
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {sess_b['access']}"}).status_code == 401


# --- absolute lifetime ------------------------------------------------------


def test_absolute_lifetime_denies_refresh_and_me(client: TestClient) -> None:
    sess = _signup_login(client, email="abs@tollma.ai")
    _age_record(sess["sid"], created_at=_iso_ago(days=91))

    assert _refresh_with(TestClient, client.app, sess["refresh"]).status_code == 401
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {sess['access']}"}).status_code == 401


def test_absolute_lifetime_allows_before_boundary(client: TestClient) -> None:
    sess = _signup_login(client, email="abs-ok@tollma.ai")
    _age_record(sess["sid"], created_at=_iso_ago(days=89))

    assert _refresh_with(TestClient, client.app, sess["refresh"]).status_code == 200
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {sess['access']}"}).status_code == 200


# --- idle timeout -----------------------------------------------------------


def test_idle_timeout_denies_me_and_sessions(client: TestClient) -> None:
    email = "idle@tollma.ai"
    sess_me = _signup_login(client, email=email)
    _age_record(sess_me["sid"], last_active=_iso_ago(hours=9), last_seen=_iso_ago(hours=9))
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {sess_me['access']}"}).status_code == 401

    sess_list = _login_again(client, email=email)
    _age_record(sess_list["sid"], last_active=_iso_ago(hours=9), last_seen=_iso_ago(hours=9))
    anon2 = TestClient(client.app)
    assert anon2.get(
        "/api/v1/settings/sessions",
        headers={"Authorization": f"Bearer {sess_list['access']}"},
    ).status_code == 401


def test_idle_timeout_allows_before_boundary(client: TestClient) -> None:
    sess = _signup_login(client, email="idle-ok@tollma.ai")
    _age_record(sess["sid"], last_active=_iso_ago(hours=7), last_seen=_iso_ago(hours=7))
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {sess['access']}"}).status_code == 200
    assert _refresh_with(TestClient, client.app, sess["refresh"]).status_code == 200


# --- per-user cap -----------------------------------------------------------


def test_session_cap_evicts_oldest(client: TestClient) -> None:
    email = "cap@tollma.ai"
    max_sessions = max(1, get_settings().session_max_per_user)
    creds = [_signup_login(client, email=email)]
    for _ in range(max_sessions):
        creds.append(_login_again(client, email=email))
    assert len(creds) == max_sessions + 1

    listed = client.get("/api/v1/settings/sessions")
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == max_sessions

    anon = TestClient(client.app)
    oldest, newest = creds[0], creds[-1]
    # Newest survives (check first: a stale-refresh probe below revokes the
    # whole family by design, so it must come last).
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {newest['access']}"}).status_code == 200
    # Oldest evicted.
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {oldest['access']}"}).status_code == 401
    assert _refresh_with(TestClient, client.app, oldest["refresh"]).status_code == 401


# --- audit hygiene ----------------------------------------------------------


def test_login_audit_has_event_without_token_material(
    client: TestClient, caplog
) -> None:
    email = "audit@tollma.ai"
    r = client.post("/auth/signup", json={"email": email, "password": PASSWORD, "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    assert token
    assert client.get("/auth/verify", params={"token": token}).status_code == 200
    client.cookies.clear()

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.api.auth.service"):
        login = client.post("/auth/login", json={"email": email, "password": PASSWORD, "age_confirmed": True})
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    refresh = client.cookies.get("refresh_token")
    assert access and refresh

    logged = caplog.text
    assert "logged in" in logged, "login audit event missing"
    assert access not in logged and refresh not in logged, "token material in logs"
    # NOTE: the audit lines tag the login method as "(password)" /
    # '"method": "password"'. Those are method labels, not secret material:
    # exclude them, then assert the secret value and any password-bearing
    # field shape are absent.
    assert PASSWORD not in logged, "password value in logs"
    scrubbed = logged.replace("method=password", "").replace('"method": "password"', "")
    assert "password=" not in scrubbed.lower() and '"password"' not in scrubbed.lower()


# --- logout after rotation --------------------------------------------------


def test_logout_after_rotation_kills_family(client: TestClient) -> None:
    _signup_login(client, email="lo-rot@tollma.ai")
    r1 = client.cookies.get("refresh_token")
    a1 = client.cookies.get("access_token")
    assert r1 and a1

    rotated = client.post("/auth/refresh")
    assert rotated.status_code == 200, rotated.text
    r2 = rotated.json()["refresh_token"]
    a2 = rotated.json()["access_token"]
    assert r2 and a2 and r2 != r1

    assert client.post("/auth/logout").status_code == 200
    assert client.get("/auth/me").status_code == 401

    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {a2}"}).status_code == 401
    assert _refresh_with(TestClient, client.app, r2).status_code == 401
    assert _refresh_with(TestClient, client.app, r1).status_code == 401
