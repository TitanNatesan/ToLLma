"""Phase 7 account-deletion tests (test files only; src/ is untouched).

Covers the landed contract:
  * POST /api/v1/settings/account/delete-request — validation matrix,
    happy path (15d schedule, stage 1, others-revoked, keys dead, mail),
    idempotent re-request.
  * require_active_user gate — 403 ACCOUNT_PENDING_DELETION on the feature
    set; me / sessions GET / restore / logout stay reachable.
  * POST /auth/restore — 409/401/422/403 matrix, success clears columns,
    keys stay dead, restored mail.
  * Daily _deletion_job invoked directly (SessionLocal rebound to the test
    database; schedulers never started) — full purge, not-due untouched,
    per-user rollback with failed audit, 1->2->3 notice progression.

Email is asserted via the dev outbox (never live email).
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core import security
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.attachment import Attachment
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.models.purge_audit import PurgeAuditLog
from tollms.models.registered_model import AIModel
from tollms.models.usage_aggregate import UsageDailyAggregate
from tollms.models.user import AuthProvider, User
from tollms.services.cache.manager import call_sync
from tollms.services.email import service as email_service

DELETE_REQUEST = "/api/v1/settings/account/delete-request"
PENDING_CODE = "ACCOUNT_PENDING_DELETION"
PENDING_MESSAGE = "Account scheduled for deletion."


@pytest.fixture(autouse=True)
def _clean_outbox():
    email_service.outbox.clear()
    yield
    email_service.outbox.clear()


@pytest.fixture(autouse=True)
def _warm_cache_bridge():
    """First _bridge() creation can lose a startup race in containers (the
    1s poll expires before the daemon loop runs, so call_sync returns its
    default). Kick off creation once and poll the global — test-only."""
    import time

    from tollms.services.cache import manager as cache_manager

    cache_manager._bridge()
    for _ in range(200):
        loop = cache_manager._bridge_loop
        if loop is not None and loop.is_running():
            return
        time.sleep(0.05)
    pytest.fail("cache bridge loop never started")


def _mails_to(email: str) -> list[dict]:
    return [m for m in email_service.outbox if m["to"] == email]


def _row(db: Session, email: str) -> User:
    db.expire_all()
    row = db.scalar(select(User).where(User.email == email))
    assert row is not None
    return row


def _google_passwordless(db: Session) -> tuple[User, str, str]:
    """Passwordless Google user + live google-method session (no OAuth round trip)."""
    google_id = f"google-{uuid.uuid4().hex[:10]}"
    user = User(
        email=f"g-{uuid.uuid4().hex[:8]}@gmail.com",
        provider="google",
        provider_user_id=google_id,
        auth_provider=AuthProvider.GOOGLE,
        google_id=google_id,
        has_password=False,
        password_hash=None,
        email_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    sid = call_sync(security.create_session(user.id, user.email, "google"))
    assert sid
    return user, sid, security.create_access_token(user.id, user.email, sid)


def _backdate_session_created(sid: str, age_seconds: int) -> None:
    """Age a Valkey session's created_at; last_seen stays fresh so only the
    15-minute destructive-action freshness check can fail."""
    from tollms.services.cache import keys as cache_keys
    from tollms.services.cache.manager import get_manager

    record = call_sync(get_manager().get(cache_keys.session(sid)))
    assert isinstance(record, dict), "session missing for backdate"
    record["created_at"] = (datetime.now(timezone.utc) - timedelta(seconds=age_seconds)).isoformat()
    assert call_sync(get_manager().set(cache_keys.session(sid), record)) is True


def _authz(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _run_deletion_job(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Invoke the real daily job against the test database.

    SessionLocal is rebound like the scheduler purge-matrix test; the
    schedulers themselves are never started under pytest.
    """
    from sqlalchemy.orm import sessionmaker

    from tollms.services.jobs import scheduler

    assert scheduler._scheduler is None  # pytest guard: scheduler never started
    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=db.get_bind()))
    scheduler._deletion_job()
    db.expire_all()


# --- delete-request validation matrix -----------------------------------------


def test_delete_request_validation_matrix(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Unauthenticated -> 401 (no token at all).
    anon = TestClient(client.app)
    denied = anon.post(DELETE_REQUEST, json={})
    assert denied.status_code == 401, denied.text
    assert denied.json()["error"]["code"] == "UNAUTHENTICATED"

    # Verified local account: missing password -> 422, wrong password -> 401.
    user_factory("del-matrix@tollma.ai")
    email_service.outbox.clear()  # signup verification mail is pre-request noise
    missing = client.post(DELETE_REQUEST, json={})
    assert missing.status_code == 422, missing.text
    assert missing.json()["error"]["code"] == "VALIDATION_ERROR"
    wrong = client.post(DELETE_REQUEST, json={"current_password": "wrong-password"})
    assert wrong.status_code == 401, wrong.text
    assert email_service.outbox == []  # failed re-auth sends nothing

    # Stale Google-method session (>15min) -> 403, nothing scheduled or sent.
    guser, gsid, gtoken = _google_passwordless(db)
    _backdate_session_created(gsid, age_seconds=3600)
    stale = client.post(DELETE_REQUEST, json={}, headers=_authz(gtoken))
    assert stale.status_code == 403, stale.text
    assert stale.json()["error"]["message"] == "recent Google sign-in required"
    assert _mails_to(guser.email) == []
    db.expire_all()
    assert db.get(User, guser.id) is not None
    assert db.get(User, guser.id).deletion_scheduled_for is None

    # Fresh Google-method session (<=15min) -> 200, no password needed.
    guser2, _, gtoken2 = _google_passwordless(db)
    fresh = client.post(DELETE_REQUEST, json={}, headers=_authz(gtoken2))
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["days_remaining"] == 15
    assert _mails_to(guser2.email) != []

    # Unverified local account -> 403 EMAIL_VERIFICATION_REQUIRED (verified
    # gate fires before the password check).
    r = client.post("/auth/signup", json={"email": "del-unverified@tollma.ai", "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    email_service.outbox.clear()
    gated = client.post(DELETE_REQUEST, json={"current_password": "Password123"})
    assert gated.status_code == 403, gated.text
    assert gated.json()["error"]["code"] == "EMAIL_VERIFICATION_REQUIRED"
    assert email_service.outbox == []


# --- delete-request happy path -------------------------------------------------


def test_delete_request_happy_path(
    client: TestClient, db: Session, user_factory, provider_factory
) -> None:
    user = user_factory("del-happy@tollma.ai")
    uid = uuid.UUID(user["id"])
    email_service.outbox.clear()

    # Second, independent session: the request must revoke others, not self.
    first_token = client.cookies.get("access_token")
    assert first_token
    assert client.post("/auth/login", json={"email": user["email"], "password": "Password123", "age_confirmed": True}).status_code == 200
    assert client.get("/api/v1/settings/sessions").json()["total"] == 2

    # An API key minted before the request must die with it.
    created = client.post("/api/v1/keys", json={"name": "Doomed"})
    assert created.status_code == 201, created.text
    raw_key = created.json()["raw_key"]

    before = datetime.now(timezone.utc)
    r = client.post(DELETE_REQUEST, json={"current_password": "Password123"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days_remaining"] == 15
    scheduled = datetime.fromisoformat(body["scheduled_for"])
    assert timedelta(days=15) - timedelta(minutes=5) <= scheduled - before <= timedelta(days=15) + timedelta(minutes=5)

    # DB columns: requested + scheduled (+15d) with notice stage 1.
    row = _row(db, user["email"])
    assert row.deletion_requested_at is not None
    assert row.deletion_scheduled_for is not None
    assert abs((row.deletion_scheduled_for - row.deletion_requested_at) - timedelta(days=15)) < timedelta(minutes=5)
    assert row.deletion_notice_stage == 1

    # Other sessions revoked; the caller's session stays alive.
    assert client.get("/api/v1/settings/sessions").json()["total"] == 1
    assert client.get("/auth/me").status_code == 200
    anon = TestClient(client.app)
    assert anon.get("/auth/me", headers=_authz(first_token)).status_code == 401

    # Keys are soft-deleted + invalidated: the public gateway rejects the raw
    # value (401 unknown) and no live keys remain for the owner.
    keyed = anon.get("/v1/models", headers=_authz(raw_key))
    assert keyed.status_code in (401, 403), keyed.text
    db.expire_all()
    assert db.scalars(select(ApiKey).where(ApiKey.user_id == uid, ApiKey.is_deleted.is_(False))).all() == []

    # Requested mail captured in the outbox (informational, no links/tokens).
    mails = _mails_to(user["email"])
    assert len(mails) == 1
    assert mails[0]["subject"] == "Your ToLLma account deletion was requested"

    # /auth/me exposes the pending-deletion timestamps.
    me = client.get("/auth/me").json()
    assert me["deletion_requested_at"] is not None
    assert me["deletion_scheduled_for"] is not None


def test_delete_request_idempotent(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("del-idem@tollma.ai")
    email_service.outbox.clear()

    first = client.post(DELETE_REQUEST, json={"current_password": "Password123"})
    assert first.status_code == 200, first.text
    scheduled = first.json()["scheduled_for"]

    # Re-request while pending is an idempotent 200 with NO re-auth and no
    # side effects (same schedule, stage stays 1, no second mail).
    again = client.post(DELETE_REQUEST, json={})
    assert again.status_code == 200, again.text
    assert again.json()["scheduled_for"] == scheduled
    assert again.json()["days_remaining"] == 15
    assert _row(db, user["email"]).deletion_notice_stage == 1
    assert len(_mails_to(user["email"])) == 1


# --- pending-deletion gate ------------------------------------------------------


def _assert_pending(response) -> None:
    assert response.status_code == 403, response.text
    payload = response.json()["error"]
    assert payload["code"] == PENDING_CODE
    assert payload["message"] == PENDING_MESSAGE


def test_pending_deletion_gates_feature_routes(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("del-gate@tollma.ai")
    provider = provider_factory("Gate P")
    model = model_factory(provider["id"])
    assert client.post(DELETE_REQUEST, json={"current_password": "Password123"}).status_code == 200

    # Gated samples from the feature set.
    _assert_pending(
        client.post(
            "/api/v1/providers",
            json={"name": "Gated", "provider_type": "CUSTOM", "credentials": {"base_url": "http://x"}},
        )
    )
    _assert_pending(client.get("/api/v1/keys"))
    _assert_pending(
        client.post(
            "/api/v1/gateway/chat",
            json={"provider_id": provider["id"], "model_id": model["id"], "message": "hi"},
        )
    )

    # Allowed while pending: me (with timestamps), sessions GET, restore, logout.
    me = client.get("/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["deletion_scheduled_for"] is not None
    assert client.get("/api/v1/settings/sessions").status_code == 200

    # Restore lifts the gate: feature routes work again.
    assert client.post("/auth/restore", json={"current_password": "Password123"}).status_code == 200
    reopened = client.post(
        "/api/v1/providers",
        json={"name": "After restore", "provider_type": "CUSTOM", "credentials": {"base_url": "http://x"}},
    )
    assert reopened.status_code == 201, reopened.text


def test_logout_allowed_while_pending(client: TestClient, user_factory) -> None:
    user = user_factory("del-logout@tollma.ai")
    assert client.post(DELETE_REQUEST, json={"current_password": "Password123"}).status_code == 200
    assert client.post("/auth/logout").status_code == 200
    assert client.get("/auth/me").status_code == 401


# --- restore matrix --------------------------------------------------------------


def test_restore_matrix(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("del-restore@tollma.ai")
    email_service.outbox.clear()

    # Active account (nothing pending) -> 409.
    active = client.post("/auth/restore", json={"current_password": "Password123"})
    assert active.status_code == 409, active.text
    assert active.json()["error"]["code"] == "CONFLICT"

    # Mint a key while active (key creation is gated once pending).
    created = client.post("/api/v1/keys", json={"name": "Restore key"})
    assert created.status_code == 201, created.text
    raw_key = created.json()["raw_key"]

    assert client.post(DELETE_REQUEST, json={"current_password": "Password123"}).status_code == 200
    email_service.outbox.clear()

    # Re-auth mirrors delete-request: missing -> 422, wrong -> 401.
    assert client.post("/auth/restore", json={}).status_code == 422
    assert client.post("/auth/restore", json={"current_password": "wrong-password"}).status_code == 401
    assert _row(db, user["email"]).deletion_scheduled_for is not None  # still pending
    assert email_service.outbox == []

    # Success clears all three columns; keys STAY dead; restored mail captured.
    ok = client.post("/auth/restore", json={"current_password": "Password123"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["deletion_requested_at"] is None
    assert ok.json()["deletion_scheduled_for"] is None
    row = _row(db, user["email"])
    assert row.deletion_requested_at is None
    assert row.deletion_scheduled_for is None
    assert row.deletion_notice_stage == 0

    uid = uuid.UUID(user["id"])
    db.expire_all()
    assert db.scalars(select(ApiKey).where(ApiKey.user_id == uid, ApiKey.is_deleted.is_(False))).all() == []
    anon = TestClient(client.app)
    assert anon.get("/v1/models", headers=_authz(raw_key)).status_code in (401, 403)
    mails = _mails_to(user["email"])
    assert len(mails) == 1
    assert mails[0]["subject"] == "Your ToLLma account was restored"

    # Restoring a restored (active) account -> 409 again.
    assert client.post("/auth/restore", json={"current_password": "Password123"}).status_code == 409


def test_restore_stale_google_session_forbidden(
    client: TestClient, db: Session
) -> None:
    user, sid, token = _google_passwordless(db)
    assert client.post(DELETE_REQUEST, json={}, headers=_authz(token)).status_code == 200
    email_service.outbox.clear()

    _backdate_session_created(sid, age_seconds=3600)  # >15min freshness window
    denied = client.post("/auth/restore", json={}, headers=_authz(token))
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"]["message"] == "recent Google sign-in required"
    assert _row(db, user.email).deletion_scheduled_for is not None  # still pending
    assert email_service.outbox == []


# --- purge worker -----------------------------------------------------------------


def _seed_full_resources(
    client: TestClient,
    db: Session,
    user_factory,
    provider_factory,
    model_factory,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
    email: str,
) -> dict:
    """User with providers/models/conversation/messages/key/logs/aggregates/files."""
    from tollms.core.config import get_settings
    from tollms.services.gateway import attachments as attachment_engine

    user = user_factory(email)
    uid = uuid.UUID(user["id"])
    provider = provider_factory(f"Purge {email}")
    model = model_factory(provider["id"])

    conv = client.post(
        "/api/v1/conversations",
        json={"title": "Purge me", "provider_id": provider["id"], "model_id": model["id"]},
    )
    assert conv.status_code == 201, conv.text
    conv_id = uuid.UUID(conv.json()["id"])

    db.add_all(
        [
            Message(
                user_id=uid, conversation_id=conv_id, role=Role.USER,
                content="hi", status=MessageStatus.COMPLETED,
            ),
            Message(
                user_id=uid, conversation_id=conv_id, role=Role.ASSISTANT,
                content="hello", status=MessageStatus.COMPLETED,
            ),
        ]
    )
    db.commit()

    created = client.post("/api/v1/keys", json={"name": "Purge key"})
    assert created.status_code == 201, created.text
    key_id = uuid.UUID(created.json()["key"]["id"])

    now = datetime.now(timezone.utc)
    db.add(
        ApiRequestLog(
            request_id=f"req-purge-{uid.hex[:12]}",
            api_key_id=key_id, user_id=uid,
            provider="openai", model="gpt-4o",
            endpoint="/v1/chat/completions", status="success",
            total_tokens=100, created_at=now,
        )
    )
    db.add(
        UsageDailyAggregate(
            day=date.today(), user_id=uid,
            provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
            requests=5, total_tokens=500,
        )
    )
    db.commit()

    monkeypatch.setattr(get_settings(), "storage_dir", str(tmp_path / "uploads"))
    linked_rel = attachment_engine.save_bytes(uid, "chat", "linked.txt", b"linked-bytes")
    stray_rel = attachment_engine.save_bytes(uid, "chat", "stray.txt", b"stray-bytes")
    db.add_all(
        [
            Attachment(
                user_id=uid, conversation_id=conv_id, filename="linked.txt",
                mime_type="text/plain", kind="document", file_size=12, storage_path=linked_rel,
            ),
            Attachment(
                user_id=uid, conversation_id=None, filename="stray.txt",
                mime_type="text/plain", kind="document", file_size=11, storage_path=stray_rel,
            ),
        ]
    )
    db.commit()
    root = attachment_engine.storage_root()
    return {
        "user": user, "uid": uid,
        "provider_id": uuid.UUID(provider["id"]), "model_id": uuid.UUID(model["id"]),
        "conv_id": conv_id, "key_id": key_id,
        "disk": [root / linked_rel, root / stray_rel],
    }


def _schedule_deletion(db: Session, uid: uuid.UUID, *, due: bool, stage: int = 1) -> None:
    now = datetime.now(timezone.utc)
    row = db.get(User, uid)
    assert row is not None
    row.deletion_requested_at = now - timedelta(days=16)
    row.deletion_scheduled_for = (now - timedelta(hours=1)) if due else (now + timedelta(days=14))
    row.deletion_notice_stage = stage
    db.commit()


def test_purge_full_resource_user(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = _seed_full_resources(
        client, db, user_factory, provider_factory, model_factory, tmp_path, monkeypatch,
        "purge-full@tollma.ai",
    )
    uid, email = seed["uid"], seed["user"]["email"]
    assert all(p.exists() for p in seed["disk"])
    _schedule_deletion(db, uid, due=True)
    email_service.outbox.clear()

    _run_deletion_job(db, monkeypatch)

    # User row gone; providers/models/conversations/messages/keys hard-deleted.
    assert db.get(User, uid) is None
    assert db.scalars(select(Provider).where(Provider.user_id == uid)).all() == []
    assert db.get(AIModel, seed["model_id"]) is None
    assert db.scalars(select(Conversation).where(Conversation.user_id == uid)).all() == []
    assert db.scalars(select(Message).where(Message.user_id == uid)).all() == []
    assert db.scalars(select(ApiKey).where(ApiKey.user_id == uid)).all() == []
    # Attachments (linked + stray) gone at the row level and on disk.
    assert db.scalars(select(Attachment).where(Attachment.user_id == uid)).all() == []
    assert all(not p.exists() for p in seed["disk"])
    # Analytics survive anonymized: aggregates keep rows, lose user.
    # Attributed request logs are hard-deleted (H1 erasure completeness).
    aggregates = db.scalars(select(UsageDailyAggregate)).all()
    assert len(aggregates) == 1 and aggregates[0].user_id is None
    logs = db.scalars(select(ApiRequestLog)).all()
    assert logs == []
    # Audit ok row with per-resource counts.
    audits = db.scalars(select(PurgeAuditLog).where(PurgeAuditLog.deleted_user_id == uid)).all()
    assert len(audits) == 1
    assert audits[0].result == "ok"
    assert audits[0].counts["providers"] == 1
    assert audits[0].counts["models"] == 1
    assert audits[0].counts["conversations"] == 1
    assert audits[0].counts["api_keys"] == 2  # seeded key + auto-created primary
    assert audits[0].counts["usage_aggregates"] == 1
    # Final receipt mailed.
    purged = _mails_to(email)
    assert len(purged) == 1
    assert purged[0]["subject"] == "Your ToLLma account has been deleted"

    # The freed address re-registers cleanly.
    client.cookies.clear()
    assert client.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True}).status_code == 200


def test_purge_not_due_user_untouched(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = _seed_full_resources(
        client, db, user_factory, provider_factory, model_factory, tmp_path, monkeypatch,
        "purge-wait@tollma.ai",
    )
    uid, email = seed["uid"], seed["user"]["email"]
    _schedule_deletion(db, uid, due=False)  # +14d: outside the 7-day notice window
    email_service.outbox.clear()

    _run_deletion_job(db, monkeypatch)

    row = _row(db, email)
    assert row.deletion_scheduled_for is not None and row.deletion_notice_stage == 1
    assert db.scalars(select(Provider).where(Provider.user_id == uid)).all() != []
    assert db.scalars(select(Conversation).where(Conversation.user_id == uid)).all() != []
    assert db.scalars(select(ApiKey).where(ApiKey.user_id == uid)).all() != []
    assert all(p.exists() for p in seed["disk"])
    assert db.scalars(select(PurgeAuditLog)).all() == []
    assert email_service.outbox == []


def test_purge_failure_rolls_back_and_continues(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory,
    tmp_path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tollms.services.jobs import scheduler

    failing = _seed_full_resources(
        client, db, user_factory, provider_factory, model_factory, tmp_path, monkeypatch,
        "purge-fail@tollma.ai",
    )
    healthy = _seed_full_resources(
        client, db, user_factory, provider_factory, model_factory, tmp_path, monkeypatch,
        "purge-healthy@tollma.ai",
    )
    _schedule_deletion(db, failing["uid"], due=True)
    _schedule_deletion(db, healthy["uid"], due=True)

    real_purge = scheduler._purge_user_data

    def _flaky(db_session, user_id):
        if user_id == failing["uid"]:
            raise RuntimeError("simulated purge crash")
        return real_purge(db_session, user_id)

    monkeypatch.setattr(scheduler, "_purge_user_data", _flaky)
    _run_deletion_job(db, monkeypatch)

    # Failing user rolled back: row + resources intact, failed audit row kept.
    assert _row(db, failing["user"]["email"]).deletion_scheduled_for is not None
    assert db.scalars(select(Provider).where(Provider.user_id == failing["uid"])).all() != []
    failed = db.scalars(
        select(PurgeAuditLog).where(PurgeAuditLog.deleted_user_id == failing["uid"])
    ).all()
    assert len(failed) == 1
    assert failed[0].result == "failed" and failed[0].error

    # The healthy due user in the same run still purged normally.
    assert db.get(User, healthy["uid"]) is None
    ok = db.scalars(
        select(PurgeAuditLog).where(PurgeAuditLog.deleted_user_id == healthy["uid"])
    ).all()
    assert len(ok) == 1 and ok[0].result == "ok"


def test_deletion_notices_progress_1_to_2_to_3(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    early = user_factory("notice-7d@tollma.ai")
    late = user_factory("notice-1d@tollma.ai")
    early_uid, late_uid = uuid.UUID(early["id"]), uuid.UUID(late["id"])
    now = datetime.now(timezone.utc)

    db.get(User, early_uid).deletion_requested_at = now - timedelta(days=9)
    db.get(User, early_uid).deletion_scheduled_for = now + timedelta(days=6)  # in 7-day window
    db.get(User, early_uid).deletion_notice_stage = 1
    db.get(User, late_uid).deletion_requested_at = now - timedelta(days=14)
    db.get(User, late_uid).deletion_scheduled_for = now + timedelta(hours=12)  # in 1-day window
    db.get(User, late_uid).deletion_notice_stage = 2
    db.commit()
    email_service.outbox.clear()

    _run_deletion_job(db, monkeypatch)

    # Stage 1 -> 2 with the 7-day reminder; stage 2 -> 3 with the 1-day one.
    assert _row(db, early["email"]).deletion_notice_stage == 2
    assert _row(db, late["email"]).deletion_notice_stage == 3
    # Nobody due: both accounts (and their schedules) survive the run.
    assert _row(db, early["email"]).deletion_scheduled_for is not None
    assert _row(db, late["email"]).deletion_scheduled_for is not None
    assert db.scalars(select(PurgeAuditLog)).all() == []

    seven = _mails_to(early["email"])
    assert len(seven) == 1
    assert seven[0]["subject"] == "Your ToLLma account will be deleted in 7 days"
    one = _mails_to(late["email"])
    assert len(one) == 1
    assert one[0]["subject"] == "Your ToLLma account will be deleted in 1 days"
