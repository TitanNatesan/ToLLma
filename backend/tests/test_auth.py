"""Authentication tests: signup, verification, login, JWT, OAuth, refresh,
logout, and user isolation of providers/conversations/messages."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.auth import service as auth_service
from tollms.core.config import get_settings


def _signup(client: TestClient, email: str = "a@tollma.ai", password: str = "Password123") -> dict:
    r = client.post("/auth/signup", json={"email": email, "password": password, "age_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()


def _verify(client: TestClient, body: dict) -> dict:
    """Complete email verification for a fresh signup (feature routes are gated)."""
    token = body.get("debug_verification_token")
    assert token
    r = client.get("/auth/verify", params={"token": token})
    assert r.status_code == 200, r.text
    return r.json()


def test_signup_creates_unverified_user(client: TestClient, db: Session) -> None:
    body = _signup(client)
    assert body["user"]["email"] == "a@tollma.ai"
    assert body["user"]["email_verified"] is False
    assert body["user"]["auth_provider"] == "EMAIL"
    assert "password" not in body["user"]
    assert body["debug_verification_token"]
    assert body["verification_sent"] is True

    dup = client.post("/auth/signup", json={"email": "a@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert dup.status_code == 422

    bad = client.post("/auth/signup", json={"email": "not-an-email", "password": "Password123", "age_confirmed": True})
    assert bad.status_code == 422


def test_signup_succeeds_when_verification_email_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SMTP down: signup still 200s (account + session created) with sent=false."""
    monkeypatch.setattr(auth_service, "send_verification_email", lambda to, url: False)
    r = client.post(
        "/auth/signup", json={"email": "smtp-fail@tollma.ai", "password": "Password123", "age_confirmed": True}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verification_sent"] is False
    assert body["user"]["email_verified"] is False
    assert body["debug_verification_token"]
    # Session was still issued: the user is logged in despite the mail failure.
    assert client.get("/auth/me").status_code == 200


def test_email_verification_activates_and_replay_is_idempotent(client: TestClient) -> None:
    body = _signup(client)
    token = body["debug_verification_token"]

    first = client.get("/auth/verify", params={"token": token})
    assert first.status_code == 200, first.text
    assert first.json()["user"]["email_verified"] is True

    me = client.get("/auth/me")
    assert me.json()["email_verified"] is True

    # Replay of a consumed link succeeds for the verified address
    # (email scanners pre-fetch; clients double-fire).
    second = client.get("/auth/verify", params={"token": token})
    assert second.status_code == 200
    assert second.json()["user"]["email_verified"] is True

    bad = client.get("/auth/verify", params={"token": "garbage"})
    assert bad.status_code == 422


def test_verification_expired_link_rejected(client: TestClient, db: Session) -> None:
    import asyncio

    from tollms.api.auth import service as auth_service
    from tollms.models.user import User
    from tollms.services.cache.manager import get_manager

    body = _signup(client, email="exp@tollma.ai")
    uid = body["user"]["id"]
    token = body["debug_verification_token"]
    # Simulate expiry: drop the Valkey entry while the account is unverified.
    user = db.get(User, __import__("uuid").UUID(uid))
    assert user is not None and user.email_verified is False
    asyncio.run(_drop(token))
    r = client.get("/auth/verify", params={"token": token})
    assert r.status_code == 422


async def _drop(token: str) -> None:
    import hashlib

    from tollms.services.cache import keys as cache_keys
    from tollms.services.cache.manager import get_manager

    await get_manager().delete(cache_keys.verify_email(hashlib.sha256(token.encode()).hexdigest()))


def test_login_issues_jwt_and_session(client: TestClient) -> None:
    _signup(client, email="l@tollma.ai")
    client.cookies.clear()  # drop signup session; login must stand alone
    r = client.post("/auth/login", json={"email": "l@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    assert r.cookies.get("access_token") and r.cookies.get("refresh_token")
    assert r.cookies.get("tollma_session") == "1"

    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "l@tollma.ai"

    wrong = client.post("/auth/login", json={"email": "l@tollma.ai", "password": "wrongpass1"})
    assert wrong.status_code == 401
    missing = client.post("/auth/login", json={"email": "nobody@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert missing.status_code == 401


def test_protected_routes_reject_anonymous(client: TestClient, provider_factory) -> None:
    p = provider_factory("Pub")  # authed client creates one
    anon = TestClient(client.app)  # fresh jar, no cookies
    assert anon.get("/api/v1/providers").status_code == 401
    assert anon.get(f"/api/v1/providers/{p['id']}").status_code == 401
    assert anon.get("/api/v1/models").status_code == 401
    assert anon.get("/api/v1/conversations").status_code == 401
    assert anon.post("/api/v1/gateway/chat", json={}).status_code in (401, 422)
    assert anon.get(f"/api/v1/conversations/{uuid.uuid4()}/usage").status_code == 401
    # Bearer tokens work too.
    token = client.cookies.get("access_token")
    assert token
    r = anon.get("/api/v1/providers", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    bad = anon.get("/api/v1/providers", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


def test_user_isolation_providers_models(client: TestClient) -> None:
    a = _signup(client, email="iso-a@tollma.ai")
    _verify(client, a)
    pa = client.post("/api/v1/providers",
                     json={"name": "A-Key", "provider_type": "CUSTOM",
                           "credentials": {"base_url": "http://a"}}).json()
    ma = client.post("/api/v1/models",
                     json={"provider_id": pa["id"], "model_id": "m-a", "name": "MA",
                           "endpoint_type": "chat_completions"}).json()
    assert a["user"]["id"]

    client.cookies.clear()
    _verify(client, _signup(client, email="iso-b@tollma.ai"))
    assert client.get("/api/v1/providers").json() == []
    assert client.get(f"/api/v1/providers/{pa['id']}").status_code == 404
    assert client.get(f"/api/v1/models/{ma['id']}").status_code == 404
    assert client.get("/api/v1/models").json() == []
    # Same provider name is fine for a different owner.
    again = client.post("/api/v1/providers",
                        json={"name": "A-Key", "provider_type": "CUSTOM",
                              "credentials": {"base_url": "http://b"}})
    assert again.status_code == 201
    # ...but not twice for the same owner.
    dup = client.post("/api/v1/providers",
                      json={"name": "A-Key", "provider_type": "CUSTOM",
                            "credentials": {"base_url": "http://b"}})
    assert dup.status_code == 422


def test_user_isolation_conversations_messages(client: TestClient, provider_factory, model_factory) -> None:
    _verify(client, _signup(client, email="conv-a@tollma.ai"))
    p = provider_factory("PA")
    m = model_factory(p["id"])
    conv = client.post("/api/v1/conversations",
                       json={"title": "Secret", "provider_id": p["id"], "model_id": m["id"]}).json()
    assert client.get("/api/v1/conversations").json()[0]["id"] == conv["id"]

    client.cookies.clear()
    _verify(client, _signup(client, email="conv-b@tollma.ai"))
    assert client.get("/api/v1/conversations").json() == []
    assert client.get(f"/api/v1/conversations/{conv['id']}").status_code == 404
    assert client.get(f"/api/v1/conversations/{conv['id']}/messages").status_code == 404
    assert client.get(f"/api/v1/conversations/{conv['id']}/usage").status_code == 404
    assert client.delete(f"/api/v1/conversations/{conv['id']}").status_code == 404


def test_refresh_rotates_access_token(client: TestClient) -> None:
    _signup(client, email="r@tollma.ai")
    client.cookies.clear()
    client.post("/auth/login", json={"email": "r@tollma.ai", "password": "Password123", "age_confirmed": True})
    old_access = client.cookies.get("access_token")
    assert old_access

    # Refresh works without body and returns access_token in json
    r = client.post("/auth/refresh")
    assert r.status_code == 200, r.text
    assert r.cookies.get("access_token")
    assert r.json().get("access_token")
    assert r.json()["user"]["email"] == "r@tollma.ai"

    anon = TestClient(client.app)
    assert anon.post("/auth/refresh", json={}).status_code == 401
    assert anon.post("/auth/refresh", json={"refresh_token": "garbage"}).status_code == 401


def test_logout_kills_session(client: TestClient) -> None:
    _signup(client, email="o@tollma.ai")
    assert client.get("/auth/me").status_code == 200
    access = client.cookies.get("access_token")

    assert client.post("/auth/logout").status_code == 200
    # Session destroyed: both cookie and replayed Bearer go 401.
    assert client.get("/auth/me").status_code == 401
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401
    assert anon.post("/auth/refresh", json={}).status_code == 401


def test_google_oauth_creates_user_and_session(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:8000/auth/google/callback")

    async def _tokens(code: str) -> dict:
        assert code == "auth-code"
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        assert token == "google-at"
        return {"sub": "g123", "email": "G@Example.com", "email_verified": True,
                "name": "G User", "picture": "http://pic"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    login = client.get("/auth/google/login", follow_redirects=False)
    assert login.status_code in (302, 307)
    assert "accounts.google.com" in login.headers["location"]

    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    cb = client.get("/auth/google/callback", params={"code": "auth-code", "state": state},
                    follow_redirects=False)
    assert cb.status_code in (302, 307), cb.text
    assert client.cookies.get("access_token")

    me = client.get("/auth/me").json()
    assert me["email"] == "g@example.com"  # normalized
    assert me["email_verified"] is True
    assert me["auth_provider"] == "GOOGLE"

    # Bad state is rejected.
    bad = client.get("/auth/google/callback", params={"code": "auth-code", "state": "bogus"})
    assert bad.status_code == 401


def test_google_login_unconfigured(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "")
    r = client.get("/auth/google/login", follow_redirects=False)
    assert r.status_code == 422


# --- Google collision matrix --------------------------------------------------


def _google_callback(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, *, sub: str, email: str, verified: bool
) -> object:
    """Drive the google-callback flow with a mocked Google profile."""
    from urllib.parse import parse_qs, urlparse

    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:8000/auth/google/callback")

    async def _tokens(code: str) -> dict:
        assert code == "auth-code"
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        assert token == "google-at"
        return {"sub": sub, "email": email, "email_verified": verified,
                "name": "G User", "picture": "http://pic"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    login = client.get("/auth/google/login", follow_redirects=False)
    assert login.status_code in (302, 307), login.text
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    return client.get(
        "/auth/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )


def test_google_callback_links_verified_email_to_local_account(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy import select

    from tollms.models.user import User

    body = _signup(client, email="collision-link@example.com")
    _verify(client, body)
    local_id = body["user"]["id"]
    client.cookies.clear()

    cb = _google_callback(
        client, monkeypatch,
        sub="g-link-123", email="collision-link@example.com", verified=True,
    )
    assert cb.status_code in (302, 307), cb.text
    assert client.cookies.get("access_token")

    me = client.get("/auth/me").json()
    assert me["id"] == local_id

    db.expire_all()
    rows = db.execute(
        select(User).where(User.email == "collision-link@example.com")
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].google_id == "g-link-123"


def test_google_callback_unverified_collision_rejected(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _verify(client, _signup(client, email="collision@example.com"))
    client.cookies.clear()

    cb = _google_callback(
        client, monkeypatch,
        sub="g-other-456", email="collision@example.com", verified=False,
    )
    assert cb.status_code == 401, cb.text
    assert "already registered" in cb.json()["error"]["message"]


# --- OAuth hardening (Phase 9) -------------------------------------------------


def _hardening_config(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "http://localhost:8000/auth/google/callback")


def _login_state(client: TestClient, headers: dict | None = None) -> str:
    from urllib.parse import parse_qs, urlparse

    login = client.get("/auth/google/login", headers=headers or {}, follow_redirects=False)
    assert login.status_code in (302, 307), login.text
    return parse_qs(urlparse(login.headers["location"]).query)["state"][0]


def test_google_oauth_state_replay_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)

    async def _tokens(code: str) -> dict:
        assert code == "auth-code"
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        assert token == "google-at"
        return {"sub": "g-replay-1", "email": "replay@example.com",
                "email_verified": True, "name": "Replay",
                "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    state = _login_state(client)
    first = client.get("/auth/google/callback",
                       params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert first.status_code in (302, 307), first.text

    second = client.get("/auth/google/callback",
                        params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert second.status_code == 401, second.text


def test_google_oauth_ua_mismatch_forbidden(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)

    async def _tokens(code: str) -> dict:
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        return {"sub": "g-ua-1", "email": "ua@example.com",
                "email_verified": True, "name": "UA",
                "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    login_headers = {"user-agent": "UA-A", "x-forwarded-for": "10.9.9.9"}
    state = _login_state(client, headers=login_headers)
    cb = client.get("/auth/google/callback", params={"code": "auth-code", "state": state},
                    headers={"user-agent": "UA-B", "x-forwarded-for": "10.9.9.9"},
                    follow_redirects=False)
    assert cb.status_code == 403, cb.text


def test_google_oauth_ip_mismatch_forbidden(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)
    # TestClient peer is "testclient" (unparseable -> never a trusted proxy),
    # so gateway_client_ip would ignore XFF without this patch. Simulate a
    # trusted-proxy deployment (production topology) where OAuth IP-mismatch
    # protection operates. monkeypatch restores _peer_trusted after the test.
    monkeypatch.setattr("tollms.core.sessions._peer_trusted", lambda peer: True)

    async def _tokens(code: str) -> dict:
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        return {"sub": "g-ip-1", "email": "ip@example.com",
                "email_verified": True, "name": "IP",
                "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    state = _login_state(client, headers={"user-agent": "Same-Agent",
                                          "x-forwarded-for": "10.0.0.1"})
    cb = client.get("/auth/google/callback", params={"code": "auth-code", "state": state},
                    headers={"user-agent": "Same-Agent", "x-forwarded-for": "10.0.0.2"},
                    follow_redirects=False)
    assert cb.status_code == 403, cb.text


def test_google_login_pkce_challenge_and_verifier_forwarded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import base64
    import hashlib
    from urllib.parse import parse_qs, urlparse

    _hardening_config(monkeypatch)
    captured: dict = {}

    async def _tokens(code: str, verifier: str | None = None) -> dict:
        assert code == "auth-code"
        captured["verifier"] = verifier
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        assert token == "google-at"
        return {"sub": "g-pkce-1", "email": "pkce@example.com",
                "email_verified": True, "name": "PKCE",
                "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    login = client.get("/auth/google/login", follow_redirects=False)
    assert login.status_code in (302, 307), login.text
    query = parse_qs(urlparse(login.headers["location"]).query)
    assert query.get("code_challenge"), login.headers["location"]
    assert query.get("code_challenge_method") == ["S256"]
    challenge = query["code_challenge"][0]
    state = query["state"][0]

    cb = client.get("/auth/google/callback",
                    params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert cb.status_code in (302, 307), cb.text

    verifier = captured.get("verifier")
    assert isinstance(verifier, str) and 43 <= len(verifier) <= 128
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode(
        "ascii").rstrip("=")
    assert challenge == expected


def test_google_callback_denied_redirects_to_login(client: TestClient) -> None:
    denied = client.get("/auth/google/callback", params={"error": "access_denied"},
                        follow_redirects=False)
    assert denied.status_code == 307, denied.text
    assert denied.headers["location"].endswith("/login?oauth_error=cancelled")


def test_google_callback_missing_params_rejected(client: TestClient) -> None:
    r = client.get("/auth/google/callback", follow_redirects=False)
    assert r.status_code == 422, r.text


def test_google_oauth_missing_verified_claim_defaults_false(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)

    async def _tokens(code: str) -> dict:
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        # No email_verified key at all.
        return {"sub": "g-no-vkey-1", "email": "novkey@example.com",
                "name": "No Key", "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    state = _login_state(client)
    cb = client.get("/auth/google/callback",
                    params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert cb.status_code in (302, 307), cb.text
    me = client.get("/auth/me").json()
    assert me["email"] == "novkey@example.com"
    assert me["email_verified"] is False


def test_google_oauth_long_name_truncated(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)

    async def _tokens(code: str) -> dict:
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        return {"sub": "g-longname-1", "email": "longname@example.com",
                "email_verified": True, "name": "N" * 300,
                "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    state = _login_state(client)
    cb = client.get("/auth/google/callback",
                    params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert cb.status_code in (302, 307), cb.text
    me = client.get("/auth/me").json()
    assert me["full_name"] == "N" * 255


def test_google_oauth_http_avatar_omitted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)

    async def _tokens(code: str) -> dict:
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        return {"sub": "g-httpav-1", "email": "httpav@example.com",
                "email_verified": True, "name": "Av",
                "picture": "http://example.com/avatar.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    state = _login_state(client)
    cb = client.get("/auth/google/callback",
                    params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert cb.status_code in (302, 307), cb.text
    me = client.get("/auth/me").json()
    assert me["avatar_url"] is None


def test_google_oauth_empty_sub_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hardening_config(monkeypatch)

    async def _tokens(code: str) -> dict:
        return {"access_token": "google-at"}

    async def _profile(token: str) -> dict:
        return {"sub": "", "email": "emptysub@example.com",
                "email_verified": True, "name": "Empty",
                "picture": "https://example.com/a.png"}

    monkeypatch.setattr(auth_service, "exchange_google_code", _tokens)
    monkeypatch.setattr(auth_service, "fetch_google_userinfo", _profile)

    state = _login_state(client)
    cb = client.get("/auth/google/callback",
                    params={"code": "auth-code", "state": state}, follow_redirects=False)
    assert cb.status_code == 401, cb.text
