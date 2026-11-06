"""Phase 2 security regression tests (permanent).

Covers the Security-Critical hardening delivered in Phase 2:
  * auth required on POST /api/v1/providers/draft-validate
  * auth required on GET /api/v1/model-repository/lookup
  * Valkey fixed-window auth rate limiter (429 + Retry-After + RATE_LIMITED)
  * login lockout per email+IP (deny-while-locked, expiry, reset-on-success)
  * logout refresh-fallback (expired access + valid refresh destroys session)
  * verification TTL mirrors `verification_token_hours`
  * scheduler purge of password-reset tokens (used OR expired)

Only low limits monkeypatched inside individual tests — global defaults in
`tollms.core.config.Settings` are never touched, so the rest of the suite
can never trip the limiter.
"""

import asyncio
import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tollms.api.auth import service as auth_service
from tollms.core.config import get_settings
from tollms.core import security
from tollms.models.password_reset import PasswordResetToken
from tollms.models.user import User
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import call_sync, get_manager


def _signup(client: TestClient, email: str, password: str = "Password123") -> dict:
    r = client.post("/auth/signup", json={"email": email, "password": password, "age_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()


# --- auth gates: draft-validate + lookup -------------------------------------


def test_draft_validate_rejects_anonymous(client: TestClient, user_factory) -> None:
    user_factory("gate-a@tollma.ai")  # prove the route exists for authed callers
    anon = TestClient(client.app)
    r = anon.post(
        "/api/v1/providers/draft-validate",
        json={"provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert r.status_code == 401, r.text


def test_lookup_rejects_anonymous(client: TestClient, user_factory) -> None:
    user_factory("gate-b@tollma.ai")
    anon = TestClient(client.app)
    r = anon.get("/api/v1/model-repository/lookup", params={"query": "gpt-4o"})
    assert r.status_code == 401, r.text


def test_draft_validate_and_lookup_authed_not_401(
    client: TestClient, db: Session, user_factory
) -> None:
    from tollms.api.repository import service as repo_service

    user_factory("gate-c@tollma.ai")
    repo_service.run_sync(
        db,
        modelsdev_data={
            "openai": {
                "id": "openai", "name": "OpenAI",
                "models": {
                    "gpt-4o": {
                        "id": "gpt-4o", "name": "GPT-4o",
                        "modalities": {"input": ["text"], "output": ["text"]},
                        "limit": {"context": 128000, "output": 4096},
                        "cost": {"input": 2.5, "output": 10.0},
                    },
                },
            },
        },
    )
    dv = client.post(
        "/api/v1/providers/draft-validate",
        json={"provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert dv.status_code == 200, dv.text  # live call may fail gracefully, never 401
    lk = client.get("/api/v1/model-repository/lookup", params={"query": "gpt-4o"})
    assert lk.status_code == 200, lk.text
    assert lk.json()["entry"]["model_key"] == "openai/gpt-4o"


# --- fixed-window auth rate limiter ------------------------------------------


def test_login_burst_rate_limited_429(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_rate_limit_attempts", 2)
    monkeypatch.setattr(settings, "auth_rate_limit_window_seconds", 60)
    _signup(client, email="burst@tollma.ai")

    first = client.post("/auth/login", json={"email": "burst@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert first.status_code == 200, first.text
    second = client.post("/auth/login", json={"email": "burst@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert second.status_code == 200, second.text

    denied = client.post("/auth/login", json={"email": "burst@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert denied.headers.get("retry-after") is not None
    assert int(denied.headers["retry-after"]) > 0


# --- login lockout per email+IP ----------------------------------------------


def test_login_lockout_denies_correct_password(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "login_max_attempts", 3)
    monkeypatch.setattr(settings, "login_lockout_seconds", 900)
    _signup(client, email="locked@tollma.ai")

    for _ in range(3):
        bad = client.post("/auth/login", json={"email": "locked@tollma.ai", "password": "WrongPass1"})
        assert bad.status_code == 401, bad.text

    # Correct password is denied while the email+IP pair is locked.
    denied = client.post("/auth/login", json={"email": "locked@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert denied.status_code == 429, denied.text
    assert denied.json()["error"]["code"] == "RATE_LIMITED"
    assert denied.headers.get("retry-after") is not None


def test_login_lockout_expiry_allows_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "login_max_attempts", 3)
    # Short window proves the lockout is TTL-sized by config; expiry itself is
    # simulated by dropping the counter (no real sleeping).
    monkeypatch.setattr(settings, "login_lockout_seconds", 45)
    _signup(client, email="expiry@tollma.ai")

    for _ in range(3):
        assert client.post(
            "/auth/login", json={"email": "expiry@tollma.ai", "password": "WrongPass1"}
        ).status_code == 401
    locked = client.post("/auth/login", json={"email": "expiry@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert locked.status_code == 429, locked.text
    assert 0 < int(locked.headers["retry-after"]) <= 45

    # Simulate the TTL window passing (IP-agnostic: drop every login counter).
    assert call_sync(get_manager().invalidate_pattern("tollma:login_attempts:*")) >= 0
    ok = client.post("/auth/login", json={"email": "expiry@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert ok.status_code == 200, ok.text


def test_successful_login_resets_lockout_counter(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "login_max_attempts", 3)
    monkeypatch.setattr(settings, "login_lockout_seconds", 900)
    _signup(client, email="reset-counter@tollma.ai")

    for _ in range(2):  # threshold - 1: not locked yet
        assert client.post(
            "/auth/login", json={"email": "reset-counter@tollma.ai", "password": "WrongPass1"}
        ).status_code == 401
    assert client.post(
        "/auth/login", json={"email": "reset-counter@tollma.ai", "password": "Password123", "age_confirmed": True}
    ).status_code == 200

    # Counter was cleared: two more failures are still 401s, not a lockout
    # (without the reset the 3rd post-reset failure would already be 429).
    for _ in range(2):
        assert client.post(
            "/auth/login", json={"email": "reset-counter@tollma.ai", "password": "WrongPass1"}
        ).status_code == 401
    assert client.post(
        "/auth/login", json={"email": "reset-counter@tollma.ai", "password": "Password123", "age_confirmed": True}
    ).status_code == 200


# --- logout refresh-fallback --------------------------------------------------


def test_logout_with_expired_access_and_valid_refresh_destroys_session(
    client: TestClient,
) -> None:
    body = _signup(client, email="logout-fallback@tollma.ai")
    refresh = client.cookies.get("refresh_token")
    old_access = client.cookies.get("access_token")
    assert refresh and old_access

    payload = security.decode_token(refresh)
    assert payload is not None and payload.get("type") == "refresh"
    past = int((datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp())
    expired_access = pyjwt.encode(
        {
            "sub": payload["sub"],
            "email": body["user"]["email"],
            "sid": payload["sid"],
            "type": "access",
            "iat": past - 60,
            "exp": past,
        },
        get_settings().jwt_signing_key,
        algorithm=get_settings().jwt_algorithm,
    )
    assert security.decode_token(expired_access) is None  # really expired

    client.cookies.clear()  # no usable cookies: only header (expired) + body (live)
    r = client.post(
        "/auth/logout",
        json={"refresh_token": refresh},
        headers={"Authorization": f"Bearer {expired_access}"},
    )
    assert r.status_code == 200, r.text

    # Session destroyed via the refresh fallback: the live refresh is now dead…
    assert client.post("/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    # …and the previously valid access token is dead too.
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {old_access}"}).status_code == 401


# --- verification TTL mirrors config ------------------------------------------


def test_verification_ttl_mirrors_config(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "verification_token_hours", 7)
    assert auth_service._verify_ttl_seconds() == 7 * 3600

    body = _signup(client, email="verify-ttl@tollma.ai")
    token = body["debug_verification_token"]
    assert token
    key = cache_keys.verify_email(hashlib.sha256(token.encode()).hexdigest())
    ttl = asyncio.run(get_manager().ttl(key))
    assert ttl is not None and 7 * 3600 - 120 <= ttl <= 7 * 3600


# --- scheduler purge matrix ----------------------------------------------------
# Spec: expired+unused → purged; expired+used → purged;
#       unexpired+unused → kept. Used rows are single-use dead weight (replay of a
#       used row is rejected; replay of a purged row is invalid — same observable
#       outcome), so per the approved Phase 2 contract ("used OR expired") even
#       unexpired+used rows are purged.
# The real `_cleanup_job` predicate is invoked (SessionLocal rebound to the
# test database); the schedulers themselves are never started under pytest.


def test_scheduler_purge_matrix(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tollms.services.jobs import scheduler

    assert scheduler._scheduler is None  # pytest guard: scheduler never started

    user = user_factory("purge@tollma.ai")
    uid = uuid.UUID(user["id"])
    now = datetime.now(timezone.utc)

    def _row(tag: str, expires_at: datetime, used_at: datetime | None) -> PasswordResetToken:
        return PasswordResetToken(
            user_id=uid,
            token_hash=hashlib.sha256(f"purge-{tag}".encode()).hexdigest(),
            expires_at=expires_at,
            used_at=used_at,
            request_ip="127.0.0.1",
        )

    rows = {
        # tag: (expires_at, used_at, expected_survivor)
        "expired-unused": (now - timedelta(hours=1), None, False),
        "expired-used": (now - timedelta(hours=1), now - timedelta(hours=2), False),
        "unexpired-unused": (now + timedelta(hours=1), None, True),
        "unexpired-used": (now + timedelta(hours=1), now - timedelta(minutes=10), False),
    }
    db.add_all(_row(tag, exp, used) for tag, (exp, used, _) in rows.items())
    db.commit()

    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=db.get_bind()))
    scheduler._cleanup_job()

    db.expire_all()
    survivors = {r.token_hash for r in db.scalars(select(PasswordResetToken)).all()}
    for tag, (_, _, keep) in rows.items():
        digest = hashlib.sha256(f"purge-{tag}".encode()).hexdigest()
        assert (digest in survivors) is keep, f"purge matrix violated for {tag}"

    remaining_user_rows = db.scalars(
        select(PasswordResetToken).where(PasswordResetToken.user_id == uid)
    ).all()
    assert {r.used_at is None for r in remaining_user_rows} == {True} or all(
        r.expires_at > datetime.now(timezone.utc) for r in remaining_user_rows
    )
    assert db.scalar(select(User).where(User.id == uid)) is not None  # owner untouched
