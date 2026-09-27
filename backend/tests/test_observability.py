"""Phase 15 observability tests (test-only; src/ untouched).

Covers the landed contract in services/observability/events.py:
emit(event, **fields) on tollms.events (secret blocklist, never raises)
+ incr_counter Valkey best-effort (tollma:metrics:, 90d TTL).

Event sites: auth login/failed/refresh-reuse, public_gateway denies +
request funnel + provider errors, gateway UI funnel, keys/conversation
deletions, admin.read, scheduler purge.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.user import PlatformRole, User
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, get_manager
from tollms.services.observability import events as events_mod

PASSWORD = "Password123"


# --- helpers ---------------------------------------------------------------


def _events(caplog: pytest.LogCaptureFixture, name: str | None = None) -> list[dict]:
    out: list[dict] = []
    for record in caplog.records:
        if record.name != "tollms.events":
            continue
        try:
            payload = json.loads(record.getMessage())
        except Exception:
            continue
        if not isinstance(payload, dict) or "event" not in payload:
            continue
        if name is not None and payload.get("event") != name:
            continue
        out.append(payload)
    return out


def _metric_get(name: str, labels: dict[str, str] | None = None):
    key = cache_keys.metrics_counter(name, labels)
    return cache_get_sync(key), key


def _signup_verify(client: TestClient, email: str) -> dict:
    r = client.post("/auth/signup", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    assert token
    v = client.get("/auth/verify", params={"token": token})
    assert v.status_code == 200, v.text
    return r.json()["user"]


def _promote(db: Session, user_id: str) -> None:
    row = db.get(User, uuid.UUID(user_id))
    assert row is not None
    row.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


# --- auth ------------------------------------------------------------------


def test_login_emits_without_secrets(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    _signup_verify(client, "obs-login@tollma.ai")
    client.cookies.clear()

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.post("/auth/login", json={"email": "obs-login@tollma.ai", "password": PASSWORD})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]
    refresh = client.cookies.get("refresh_token")
    assert access and refresh

    evs = _events(caplog, "auth.login")
    assert len(evs) >= 1, f"expected auth.login, got {[e.get('event') for e in _events(caplog)]}"
    last = evs[-1]
    assert last.get("method") == "password"
    assert "user_id" in last

    blob = "\n".join(rec.getMessage() for rec in caplog.records if rec.name == "tollms.events")
    assert PASSWORD not in blob
    assert access not in blob and refresh not in blob
    # The method label "password" is expected (login method, not the secret
    # value); what must be absent is a secret *field* carrying the value.
    assert '"password"' not in blob.replace('"method": "password"', "").replace('"method":"password"', "")


def test_failed_login_emits(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    _signup_verify(client, "obs-fail@tollma.ai")
    client.cookies.clear()

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.post("/auth/login", json={"email": "obs-fail@tollma.ai", "password": "Wrongpass123"})
    assert r.status_code == 401, r.text

    evs = _events(caplog, "auth.login_failed")
    assert len(evs) >= 1
    assert evs[-1].get("method") == "password"
    blob = "\n".join(rec.getMessage() for rec in caplog.records if rec.name == "tollms.events")
    assert "Wrongpass123" not in blob


def test_refresh_reuse_emits_and_revokes(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    _signup_verify(client, "obs-reuse@tollma.ai")
    client.cookies.clear()

    a = client.post("/auth/login", json={"email": "obs-reuse@tollma.ai", "password": PASSWORD})
    assert a.status_code == 200, a.text
    ra = client.cookies.get("refresh_token")
    access_a = a.json()["access_token"]
    assert ra and access_a

    b = client.post("/auth/login", json={"email": "obs-reuse@tollma.ai", "password": PASSWORD})
    assert b.status_code == 200, b.text
    rb = client.cookies.get("refresh_token")
    access_b = b.json()["access_token"]
    assert rb and access_b and rb != ra

    # Rotate A once so the original RA becomes stale.
    anon = TestClient(client.app)
    rotated = anon.post("/auth/refresh", json={"refresh_token": ra})
    assert rotated.status_code == 200, rotated.text
    ra2 = rotated.json()["refresh_token"]
    assert ra2 and ra2 != ra

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        replay = anon.post("/auth/refresh", json={"refresh_token": ra})
    assert replay.status_code == 401, replay.text

    evs = _events(caplog, "auth.refresh_reuse")
    assert len(evs) >= 1, f"expected auth.refresh_reuse, got {_events(caplog)}"

    # Family revoked: sibling, rotated and both access tokens are dead.
    anon2 = TestClient(client.app)
    assert anon2.post("/auth/refresh", json={"refresh_token": rb}).status_code == 401
    assert anon2.post("/auth/refresh", json={"refresh_token": ra2}).status_code == 401
    assert anon2.get("/auth/me", headers={"Authorization": f"Bearer {access_a}"}).status_code == 401
    assert anon2.get("/auth/me", headers={"Authorization": f"Bearer {access_b}"}).status_code == 401


# --- public gateway denies + funnel ----------------------------------------

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


def _bind_success(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    from tollms.api.public_gateway import service as pg_service
    from tollms.services.gateway.factory import build_adapter as real_build

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)

    def fake_build(provider, model, credentials):
        return real_build(provider, model, credentials, transport)

    monkeypatch.setattr(pg_service, "build_adapter", fake_build)


def _make_key(client: TestClient, **overrides) -> dict:
    payload = {"name": "obs key", **overrides}
    r = client.post("/api/v1/keys", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_rate_limit_deny_emits_and_counts(
    client: TestClient, user_factory, provider_factory, model_factory,
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory("obs-rpm@tollma.ai")
    provider = provider_factory("ObsRpm")
    model_factory(provider["id"])
    _bind_success(monkeypatch)
    created = _make_key(client, policy={"rpm": 1})
    raw = created["raw_key"]
    ref = "ObsRpm/mock-model"
    headers = {"Authorization": f"Bearer {raw}"}
    body = {"model": ref, "messages": [{"role": "user", "content": "hi"}]}

    first = client.post("/v1/chat/completions", json=body, headers=headers)
    assert first.status_code == 200, first.text

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        denied = client.post("/v1/chat/completions", json=body, headers=headers)
    assert denied.status_code == 429, denied.text

    evs = _events(caplog, "gateway.denied")
    assert len(evs) >= 1, f"expected gateway.denied, got {_events(caplog)}"
    reasons = [str(e.get("reason", "")) for e in evs]
    assert any("rpm" in reason for reason in reasons), reasons

    value, key = _metric_get("gateway.denied", {"reason": "rpm"})
    assert value is not None, f"counter missing at {key}"
    assert int(value) >= 1


def test_budget_deny_emits_and_counts(
    client: TestClient, user_factory, provider_factory, model_factory,
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory("obs-budget@tollma.ai")
    provider = provider_factory("ObsBudget")
    model_factory(provider["id"])
    _bind_success(monkeypatch)
    created = _make_key(client, policy={"max_budget_usd": "0"})
    raw = created["raw_key"]
    ref = "ObsBudget/mock-model"
    headers = {"Authorization": f"Bearer {raw}"}
    body = {"model": ref, "messages": [{"role": "user", "content": "hello world, this is a longer prompt to ensure cost"}]}

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        denied = client.post("/v1/chat/completions", json=body, headers=headers)
    assert denied.status_code == 403, denied.text

    evs = _events(caplog, "gateway.denied")
    assert len(evs) >= 1
    reasons = [str(e.get("reason", "")) for e in evs]
    assert any("budget" in reason for reason in reasons), reasons

    value, key = _metric_get("gateway.denied", {"reason": "budget"})
    assert value is not None, f"counter missing at {key}"
    assert int(value) >= 1


def test_public_auth_deny_emits(client: TestClient, user_factory, caplog: pytest.LogCaptureFixture) -> None:
    user_factory("obs-authdeny@tollma.ai")

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        missing = client.get("/v1/models")
    assert missing.status_code == 401, missing.text
    evs = _events(caplog, "gateway.denied")
    assert len(evs) >= 1
    assert evs[-1].get("reason") == "auth"

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        bad = client.get("/v1/models", headers={"Authorization": "Bearer tma_sk_live_invalid"})
    assert bad.status_code == 401, bad.text
    evs = _events(caplog, "gateway.denied")
    assert len(evs) >= 1
    assert evs[-1].get("reason") == "auth"

    value, key = _metric_get("gateway.denied", {"reason": "auth"})
    assert value is not None, f"counter missing at {key}"
    assert int(value) >= 1


def test_public_capability_deny_emits(
    client: TestClient, user_factory, provider_factory, model_factory,
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory("obs-cap@tollma.ai")
    provider = provider_factory("ObsCap")
    model_factory(provider["id"], model_id="plain-model")
    _bind_success(monkeypatch)
    raw = _make_key(client)["raw_key"]
    headers = {"Authorization": f"Bearer {raw}"}

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        denied = client.post(
            "/v1/chat/completions",
            json={
                "model": "ObsCap/plain-model",
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [{"type": "function", "function": {"name": "f"}}],
            },
            headers=headers,
        )
    assert denied.status_code == 403, denied.text
    assert "supports_tool_calling" in denied.text
    evs = _events(caplog, "gateway.denied")
    assert len(evs) >= 1
    assert evs[-1].get("reason") == "capability"


def test_public_provider_failure_emits_code(
    client: TestClient, user_factory, provider_factory, model_factory,
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tollms.api.public_gateway import service as pg_service

    user_factory("obs-perr@tollma.ai")
    provider = provider_factory("ObsPerr")
    model_factory(provider["id"])
    raw = _make_key(client)["raw_key"]

    class _Boom:
        def __init__(self, *a, **k):
            pass

        async def chat(self, messages):
            raise RuntimeError("boom")

        async def chat_stream(self, messages):
            raise RuntimeError("boom")
            yield  # pragma: no cover

    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: _Boom())

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.post(
            "/v1/chat/completions",
            json={"model": "ObsPerr/mock-model", "messages": [{"role": "user", "content": "hi"}]},
            headers={"Authorization": f"Bearer {raw}"},
        )
    assert r.status_code in (500, 502), r.text
    evs = _events(caplog, "gateway.provider_error")
    assert len(evs) >= 1, f"expected gateway.provider_error, got {_events(caplog)}"
    assert evs[-1].get("code") == "PROVIDER_ERROR"

    # Counter labels are sanitized lowercase by incr_counter.
    value, key = _metric_get("gateway.provider_error", {"code": "provider_error"})
    assert value is not None, f"counter missing at {key}"
    assert int(value) >= 1


def test_ui_provider_failure_emits_code(
    client: TestClient, user_factory, provider_factory, model_factory,
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tollms.api.gateway import service as ui_service
    from tollms.services.gateway.adapters.base import BaseProviderAdapter

    user_factory("obs-uiperr@tollma.ai")
    provider = provider_factory("ObsUiPerr")
    model = model_factory(provider["id"])

    class _Boom(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="boom")

        async def chat_stream(self, messages):
            raise NotImplementedError
            yield  # pragma: no cover

        async def chat(self, messages):
            raise RuntimeError("boom")

    monkeypatch.setattr(ui_service, "build_adapter", lambda *a, **k: _Boom())

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.post(
            "/api/v1/gateway/chat",
            json={"provider_id": provider["id"], "model_id": model["id"], "message": "hi"},
        )
    assert r.status_code in (500, 502), r.text
    evs = _events(caplog, "gateway.provider_error")
    assert len(evs) >= 1
    assert evs[-1].get("code") == "PROVIDER_ERROR"


# --- keys / conversations --------------------------------------------------


def test_key_delete_emits(client: TestClient, user_factory, caplog: pytest.LogCaptureFixture) -> None:
    user_factory("obs-kdel@tollma.ai")
    created = _make_key(client, name="doomed")
    key_id = created["key"]["id"]

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.delete(f"/api/v1/keys/{key_id}")
    assert r.status_code == 204, r.text
    evs = _events(caplog, "key.deleted")
    assert len(evs) >= 1
    assert evs[-1].get("key_id") == key_id
    assert "user_id" in evs[-1]


def test_key_rotate_emits(client: TestClient, user_factory, caplog: pytest.LogCaptureFixture) -> None:
    user_factory("obs-krot@tollma.ai")
    created = _make_key(client, name="rotating")
    key_id = created["key"]["id"]

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.post(f"/api/v1/keys/{key_id}/rotate")
    assert r.status_code == 200, r.text
    evs = _events(caplog, "key.rotated")
    assert len(evs) >= 1
    assert evs[-1].get("key_id") == key_id


def test_conversation_delete_emits(
    client: TestClient, user_factory, provider_factory, model_factory,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user_factory("obs-conv@tollma.ai")
    provider = provider_factory("ObsConv")
    model = model_factory(provider["id"])
    conv = client.post(
        "/api/v1/conversations",
        json={"title": "obs", "provider_id": provider["id"], "model_id": model["id"]},
    )
    assert conv.status_code == 201, conv.text
    conv_id = conv.json()["id"]

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.delete(f"/api/v1/conversations/{conv_id}")
    assert r.status_code == 204, r.text
    evs = _events(caplog, "conversation.deleted")
    assert len(evs) >= 1
    assert evs[-1].get("conversation_id") == conv_id


# --- admin -----------------------------------------------------------------


def test_admin_read_emits_for_admin_and_forbidden(
    client: TestClient, db: Session, user_factory, caplog: pytest.LogCaptureFixture
) -> None:
    admin = user_factory("obs-admin@tollma.ai")
    _promote(db, admin["id"])

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        r = client.get("/api/admin/dashboard", params={"preset": "last_7d", "timezone": "UTC"})
    assert r.status_code == 200, r.text
    evs = _events(caplog, "admin.read")
    assert len(evs) >= 1, f"expected admin.read, got {_events(caplog)}"
    assert evs[-1].get("path") == "/api/admin/dashboard"
    assert evs[-1].get("status") == 200
    assert evs[-1].get("user_id") == admin["id"]

    # Regular user is 403, but the middleware still audits the read
    # (main.py emits for every /api/admin* response, success or deny).
    client.cookies.clear()
    user_factory("obs-regular@tollma.ai")
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        denied = client.get("/api/admin/dashboard", params={"preset": "last_7d", "timezone": "UTC"})
    assert denied.status_code == 403, denied.text
    evs = _events(caplog, "admin.read")
    assert len(evs) >= 1, "implementation emits admin.read even on 403 (middleware audit)"
    assert evs[-1].get("status") == 403


# --- scrub + never-raises --------------------------------------------------


def test_emit_scrubs_secret_fields(caplog: pytest.LogCaptureFixture) -> None:
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        events_mod.emit(
            "test.scrub",
            user_id="user-1",
            conversation_id="conv-1",
            password="hunter2",
            token="tok-abc",
            email="a@b.c",
            ip="1.2.3.4",
            content="hello",
            prompt="secret prompt",
        )
    evs = _events(caplog, "test.scrub")
    assert len(evs) == 1
    payload = evs[0]
    assert payload["user_id"] == "user-1"
    assert payload["conversation_id"] == "conv-1"
    for dropped in ("password", "token", "email", "ip", "content", "prompt"):
        assert dropped not in payload, f"{dropped} leaked: {payload}"
    blob = json.dumps(payload)
    assert "hunter2" not in blob and "tok-abc" not in blob


def test_emit_and_counter_never_raise_on_broken_valkey(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom():
        raise RuntimeError("valkey down")

    monkeypatch.setattr(events_mod, "get_manager", _boom)

    # Must return silently, never raise.
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        assert events_mod.emit("test.broken", user_id="u1") is None
        assert events_mod.incr_counter("gateway.denied", {"reason": "test"}) is None


# --- purge -----------------------------------------------------------------


def _run_deletion_job(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy.orm import sessionmaker

    from tollms.services.jobs import scheduler

    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=db.get_bind()))
    scheduler._deletion_job()
    db.expire_all()


def test_purge_emits(
    client: TestClient, db: Session, user_factory, monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = user_factory("obs-purge@tollma.ai")
    uid = uuid.UUID(user["id"])
    now = datetime.now(timezone.utc)
    row = db.get(User, uid)
    assert row is not None
    row.deletion_requested_at = now - timedelta(days=16)
    row.deletion_scheduled_for = now - timedelta(hours=1)
    row.deletion_notice_stage = 1
    db.commit()

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="tollms.events"):
        _run_deletion_job(db, monkeypatch)

    assert db.get(User, uid) is None
    evs = _events(caplog, "account.purged")
    assert len(evs) >= 1, f"expected account.purged, got {_events(caplog)}"
    assert evs[-1].get("result") == "ok"
    assert evs[-1].get("user_id") == str(uid)

    audits = db.execute(
        select(__import__("tollms.models.purge_audit", fromlist=["PurgeAuditLog"]).PurgeAuditLog)
    ).scalars().all()
    assert any(a.result == "ok" for a in audits)
