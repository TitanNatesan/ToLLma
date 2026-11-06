"""Independent security audit (Agent H): credentials, SSRF, authZ, limits, headers,
logging, zero-retention, sessions, erasure/purge, JWT, intake. Read-only probes."""

import inspect
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.main import app

import tollms.models.api_key  # noqa: F401
import tollms.models.attachment  # noqa: F401
import tollms.models.conversation  # noqa: F401
import tollms.models.guardrail  # noqa: F401
import tollms.models.incidents  # noqa: F401
import tollms.models.legal  # noqa: F401
import tollms.models.message  # noqa: F401
import tollms.models.privacy  # noqa: F401
import tollms.models.prompt_logging  # noqa: F401
import tollms.models.provider  # noqa: F401
import tollms.models.request_log  # noqa: F401
import tollms.models.search_index  # noqa: F401
import tollms.models.security_audit  # noqa: F401


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"audit-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post(
        "/auth/signup",
        json={"email": email, "password": "Password123", "age_confirmed": True},
    )
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _uid(c: TestClient) -> uuid.UUID:
    return uuid.UUID(c.get("/auth/me").json()["id"])


def _promote(db: Session, c: TestClient) -> None:
    from tollms.models.user import PlatformRole, User

    row = db.get(User, _uid(c))
    assert row is not None
    row.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


# --- 6. SSRF ------------------------------------------------------------------


SSRF_URLS = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8000/x",
    "http://127.0.0.1:9000/x",
    "http://[::1]/x",
    "file:///etc/passwd",
    "gopher://evil.example/x",
    "http://user:pass@example.com/",
    "http://printer.local/",
    "ftp://example.com/x",
]


@pytest.mark.parametrize("url", SSRF_URLS)
def test_ssrf_create_rejects_unsafe_base_url(client: TestClient, url: str) -> None:
    u = _mkuser("ssrf")
    r = u.post(
        "/api/v1/providers",
        json={"name": f"p-{uuid.uuid4().hex[:6]}", "provider_type": "CUSTOM",
              "credentials": {"base_url": url}},
    )
    assert r.status_code == 422, (url, r.status_code, r.text)


@pytest.mark.parametrize("url", SSRF_URLS)
def test_ssrf_draft_validate_rejects_unsafe_base_url(client: TestClient, url: str) -> None:
    u = _mkuser("ssrfd")
    r = u.post(
        "/api/v1/providers/draft-validate",
        json={"provider_type": "CUSTOM", "credentials": {"base_url": url}},
    )
    assert r.status_code == 422, (url, r.status_code, r.text)


def test_ssrf_mock_host_passes_gate_under_pytest(client: TestClient) -> None:
    """Non-routable test host is NOT SSRF-blocked: the gate passes and the
    (failing) validation runs, returning HTTP 200 valid=false."""
    u = _mkuser("ssrfmock")
    r = u.post(
        "/api/v1/providers/draft-validate",
        json={"provider_type": "CUSTOM", "credentials": {"base_url": "http://mock"}},
    )
    assert r.status_code == 200, r.text
    assert "valid" in r.json()


def test_egress_unit_rejections_and_prod_dns_pinning() -> None:
    from tollms.core.egress import UnsafeEgressError, assert_safe_url, safe_join
    from tollms.api.providers import service as providers_service

    for url in SSRF_URLS:
        with pytest.raises(UnsafeEgressError):
            assert_safe_url(url, resolve_dns=False)
    with pytest.raises(UnsafeEgressError):
        safe_join("http://10.0.0.1/", "/x")
    # Prod path enforces DNS resolution: the choke point passes
    # resolve_dns=True outside pytest (pinned A/AAAA, rebinding killed).
    src = inspect.getsource(providers_service._guard_base_url)
    assert "resolve_dns=" in src and "PYTEST_CURRENT_TEST" in src


# --- 2. credentials ------------------------------------------------------------


def test_provider_secrets_masked_fernet_and_rotatable(
    client: TestClient, db: Session
) -> None:
    from tollms.api.providers import service as providers_service

    u = _mkuser("cred")
    secret = "sk-audit-secret-xyz123"
    r = u.post(
        "/api/v1/providers",
        json={"name": "cred-prov", "provider_type": "CUSTOM",
              "credentials": {"base_url": "http://mock", "api_key": secret}},
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    body = u.get(f"/api/v1/providers/{pid}").json()
    assert secret not in str(body)
    assert body["credentials_masked"]["api_key"].startswith("****")
    assert body["credentials_masked"]["base_url"] == "http://mock"
    row = providers_service.get_provider(db, uuid.UUID(pid), None)
    assert secret not in row.credentials_encrypted  # Fernet at rest
    assert providers_service.decrypted_credentials(row)["api_key"] == secret
    old_cipher = row.credentials_encrypted
    assert u.patch(f"/api/v1/providers/{pid}",
                   json={"credentials": {"base_url": "http://mock",
                                         "api_key": "sk-rotated-999"}}).status_code == 200
    db.expire_all()
    assert providers_service.get_provider(db, uuid.UUID(pid), None) \
        .credentials_encrypted != old_cipher
    sec = u.get(f"/api/v1/providers/{pid}/security").json()
    assert sec["encrypted"] is True and sec["algorithm"] == "fernet"
    assert secret not in str(sec) and "credentials_encrypted" not in str(sec)


def test_apikey_rotation_replaces_hash(client: TestClient, db: Session) -> None:
    from tollms.models.api_key import ApiKey

    u = _mkuser("rot")
    created = u.post("/api/v1/keys", json={"name": "rot-key"}).json()
    kid = created["key"]["id"]
    old_raw = created["raw_key"]
    old_hash = db.scalar(select(ApiKey.key_hash).where(ApiKey.id == uuid.UUID(kid)))
    rot = u.post(f"/api/v1/keys/{kid}/rotate")
    assert rot.status_code == 200, rot.text
    assert rot.json()["key"]["rotation_count"] == 1
    assert rot.json()["raw_key"] != old_raw
    new_hash = db.scalar(select(ApiKey.key_hash).where(ApiKey.id == uuid.UUID(kid)))
    assert new_hash != old_hash


# --- 5. authZ ------------------------------------------------------------------


def test_nonadmin_denied_admin_paths_public_paths_open(
    client: TestClient, db: Session
) -> None:
    u = _mkuser("authz")
    assert u.get("/api/v1/security/audit").status_code == 403
    assert u.post("/api/v1/governance/provider-policies",
                  json={"provider_key": "k", "display_name": "K",
                        "scope": "global"}).status_code == 403
    rep = u.post("/api/v1/governance/abuse-reports",
                 json={"reason_code": "policy_violation",
                       "details": "audit probe report body"}).json()
    assert u.patch(f"/api/v1/governance/abuse-reports/{rep['id']}/status",
                   json={"status": "under_review"}).status_code == 403
    assert u.get("/api/admin/compliance/incidents").status_code == 403
    assert u.post("/api/admin/compliance/subprocessors",
                  json={"name": "X"}).status_code == 403
    _promote(db, u)  # control: admin reads work
    assert u.get("/api/v1/security/audit").status_code == 200


def test_public_intake_and_subprocessor_list_unauthenticated(client: TestClient) -> None:
    anon = TestClient(app)
    r = anon.post(
        "/api/v1/incidents/reports/vulnerability",
        json={"title": "audit probe vuln",
              "details": "probe details with enough length",
              "reporter_contact": "audit@tollma.ai"},
    )
    assert r.status_code == 201, r.text
    assert set(r.json()) == {"id", "status", "received_at"}  # no PII echo
    s = anon.get("/api/v1/subprocessors")
    assert s.status_code == 200, s.text
    assert isinstance(s.json(), list)
    for item in s.json():
        assert set(item) == {"name", "purpose", "location", "status"}


# --- 7. rate limits --------------------------------------------------------------


def test_auth_lockout_spotcheck(client: TestClient, monkeypatch) -> None:
    from tollms.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "login_max_attempts", 3)
    monkeypatch.setattr(settings, "login_lockout_seconds", 900)
    # Use a dedicated account for the lockout probe.
    probe = TestClient(app)
    em = f"audit-lock-{uuid.uuid4().hex[:8]}@tollma.ai"
    s = probe.post("/auth/signup", json={"email": em, "password": "Password123",
                                        "age_confirmed": True})
    assert s.status_code == 200, s.text
    for _ in range(3):
        bad = probe.post("/auth/login", json={"email": em, "password": "WrongPass1"})
        assert bad.status_code == 401, bad.text
    locked = probe.post("/auth/login", json={"email": em, "password": "Password123",
                                             "age_confirmed": True})
    assert locked.status_code == 429, locked.text
    assert locked.headers.get("retry-after") is not None


def test_intake_burst_rate_limited(client: TestClient) -> None:
    anon = TestClient(app)
    codes: list[int] = []
    for i in range(25):
        r = anon.post(
            "/api/v1/incidents/reports/vulnerability",
            json={"title": f"audit burst {i} {uuid.uuid4().hex[:4]}",
                  "details": "burst probe details with enough length"},
        )
        codes.append(r.status_code)
    assert codes[0] == 201, codes
    assert codes[-1] == 429, codes  # 20/hour scope+IP guard engaged


def _flat_routes(routes):
    """FastAPI >=0.141 nests included routers (_IncludedRouter)."""
    for r in routes:
        orig = getattr(r, "original_router", None)
        if orig is not None:
            yield from _flat_routes(getattr(orig, "routes", []))
            continue
        sub = getattr(r, "routes", None)
        if sub:
            yield from _flat_routes(sub)
        else:
            yield r


def test_intake_routes_carry_rate_limit_guard() -> None:
    guarded = 0
    for route in _flat_routes(app.routes):
        path = getattr(route, "path", "")
        if path.startswith("/api/v1/incidents/reports/") or path == "/api/v1/subprocessors":
            deps = getattr(getattr(route, "dependant", None), "dependencies", [])
            assert deps, f"{path} has no rate-limit guard"
            guarded += 1
    assert guarded == 4


# --- 8. headers ------------------------------------------------------------------


def test_api_security_headers_present(client: TestClient) -> None:
    r = client.get("/api/v1/legal/documents")
    assert r.status_code == 200
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"
    assert r.headers.get("referrer-policy") == "no-referrer"
    assert "microphone" in r.headers.get("permissions-policy", "")
    assert r.headers.get("content-security-policy") == \
        "default-src 'none'; frame-ancestors 'none'"


# --- 9. logging ------------------------------------------------------------------


def test_audit_log_scrubs_secrets_and_hashes_ip(client: TestClient, db: Session) -> None:
    from tollms.api.security import service as security_service

    u = _mkuser("scrub")
    row = security_service.record_event(
        db, event_type="auth.login_failed", actor_type="anonymous",
        outcome="denied", ip_hash=security_service.hash_field("9.9.9.9"),
        metadata={"password": "Hunter2!", "token": "tok-abc",
                  "email": "victim@tollma.ai", "ip": "9.9.9.9",
                  "provider": "local", "attempt": 3},
    )
    assert row is not None
    assert row.metadata_["password"] == "[redacted]"
    assert row.metadata_["token"] == "[redacted]"
    assert row.metadata_["email"] == "[redacted]"
    assert row.ip_hash != "9.9.9.9" and len(row.ip_hash) == 64
    assert security_service.hash_field("9.9.9.9") == row.ip_hash  # deterministic
    _promote(db, u)
    body = u.get("/api/v1/security/audit",
                 params={"event_type": "auth.login_failed"}).text
    assert "Hunter2!" not in body and "tok-abc" not in body
    assert "victim@tollma.ai" not in body and "9.9.9.9" not in body
    assert "[redacted]" in body


def test_legal_acceptance_ip_is_hashed_not_raw(client: TestClient, db: Session) -> None:
    from tollms.api.legal import service as legal_service
    from tollms.models.legal import LegalAcceptance

    u = _mkuser("iplog")
    legal_service.upsert_document(
        db, slug="audit-ip", version="1.0.0", title="IP", locale="en-IN",
        body="# ip", requires_reaccept=False, effective_at=None, publish=True,
    )
    r = u.post("/api/v1/legal/acceptances", json={"slug": "audit-ip"},
                 headers={"x-forwarded-for": "9.9.9.9"})
    assert r.status_code == 200, r.text
    row = db.scalars(select(LegalAcceptance).where(
        LegalAcceptance.user_id == _uid(u))).one()
    assert row.ip_trunc is not None and row.ip_trunc.startswith("hash:")
    assert "testclient" not in (row.ip_trunc or "")


# --- 10. zero-retention ------------------------------------------------------------


def test_zero_retention_shortcircuits_prompt_logging(
    client: TestClient, db: Session
) -> None:
    from tollms.api.privacy import service as privacy_service
    from tollms.services.prompt_logging import resolution

    u = _mkuser("zr")
    uid = _uid(u)
    assert privacy_service.is_zero_retention(db, uid) is False
    r = u.put("/api/v1/privacy/retention",
              json={"data_category": "prompt_logs", "zero_retention": True})
    assert r.status_code == 200, r.text
    assert privacy_service.is_zero_retention(db, uid) is True
    resolved = resolution.resolve_setting(db, uid)
    assert resolved.setting is None and resolved.match_source is None


# --- 11. sessions + confirm-age ------------------------------------------------------


def test_revoked_sessions_rejected(client: TestClient) -> None:
    u = _mkuser("revoke")
    r = u.post("/api/v1/security/sessions/revoke-all")
    assert r.status_code == 200, r.text
    assert r.json()["revoked"] >= 1
    assert u.post("/auth/refresh").status_code == 401
    assert u.get("/auth/me").status_code == 401


def test_legacy_null_age_gated_until_confirm_age(
    client: TestClient, db: Session
) -> None:
    from tollms.models.user import User

    u = _mkuser("agegate")
    row = db.get(User, _uid(u))
    assert row is not None
    row.age_confirmed_at = None
    db.commit()
    r = u.get("/api/v1/privacy/consents")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "AGE_CONFIRMATION_REQUIRED"
    assert u.post("/auth/confirm-age").status_code == 200
    assert u.get("/api/v1/privacy/consents").status_code == 200


# --- 14. JWT -----------------------------------------------------------------------


def test_jwt_secret_required_no_silent_fallback(monkeypatch, tmp_path) -> None:
    from tollms.core.config import ConfigurationError, Settings

    assert Settings.model_fields["jwt_secret"].is_required()
    # Scrub every source: env (both cases) + .env files (empty cwd).
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("jwt_secret", raising=False)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ConfigurationError) as exc:
        Settings()
    assert "JWT_SECRET" in str(exc.value)


# --- 3. erasure + purge --------------------------------------------------------------


def test_erasure_request_grace_and_idempotent(
    client: TestClient, db: Session
) -> None:
    u = _mkuser("erasure")
    r = u.post("/api/v1/privacy/erasure", json={"current_password": "Password123"})
    assert r.status_code == 200, r.text
    assert r.json()["days_remaining"] == 15
    again = u.post("/api/v1/privacy/erasure", json={})
    assert again.status_code == 200, again.text
    assert again.json()["scheduled_for"] == r.json()["scheduled_for"]


def _seed_owned_rows(db: Session, uid: uuid.UUID) -> dict:
    from tollms.core.crypto import encrypt
    from tollms.models.api_key import ApiRequestLog
    from tollms.models.attachment import Attachment
    from tollms.models.conversation import Conversation
    from tollms.models.guardrail import GuardrailTrigger
    from tollms.models.message import Message, Role
    from tollms.models.prompt_logging import PromptLog
    from tollms.models.provider import Provider, ProviderType
    from tollms.models.request_log import ExportEvent, RequestLog
    from tollms.models.search_index import ConversationSearchEntry

    prov = Provider(user_id=uid, name="purge-prov",
                    provider_type=ProviderType.CUSTOM,
                    credentials_encrypted=encrypt("{}"))
    db.add(prov)
    conv = Conversation(user_id=uid, title="purge me")
    db.add(conv)
    db.flush()
    db.add(Message(conversation_id=conv.id, user_id=uid, role=Role.USER,
                   content="hello"))
    db.add(Attachment(user_id=uid, conversation_id=conv.id, filename="f.txt",
                       mime_type="text/plain", storage_path="audit-test/x.txt",
                       file_size=3))
    db.add(ConversationSearchEntry(user_id=uid, conversation_id=conv.id,
                                   kind="message", title="purge me",
                                   content="hello"))
    db.add(PromptLog(user_id=uid, conversation_id=conv.id, endpoint="chat",
                      input_cipher="c"))
    db.add(GuardrailTrigger(user_id=uid, input_excerpt="bad",
                             output_excerpt="worse"))
    db.add(RequestLog(user_id=uid))
    db.add(ApiRequestLog(user_id=uid, request_id=f"audit-{uuid.uuid4().hex[:8]}",
                         endpoint="chat"))
    db.add(ExportEvent(user_id=uid, dataset="conversations", format="json"))
    db.commit()
    return {"provider": prov.id, "conversation": conv.id}


def _count(db: Session, model, uid: uuid.UUID) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(
        model.user_id == uid)) or 0)


def test_purge_covers_owned_tables(client: TestClient, db: Session) -> None:
    from tollms.models.attachment import Attachment
    from tollms.models.conversation import Conversation
    from tollms.models.message import Message
    from tollms.models.provider import Provider
    from tollms.models.search_index import ConversationSearchEntry
    from tollms.services.jobs import scheduler

    u = _mkuser("purge")
    uid = _uid(u)
    key = u.post("/api/v1/keys", json={"name": "purge-key"}).json()
    assert key["key"]["id"]
    _seed_owned_rows(db, uid)
    counts = scheduler._purge_user_data(db, uid)
    assert counts["conversations"] == 1
    assert counts["attachments"] == 1
    assert counts["providers"] == 1
    assert counts["api_keys"] >= 1
    for model in (Provider, Conversation, Message, Attachment,
                  ConversationSearchEntry):
        assert _count(db, model, uid) == 0, model.__tablename__


def test_purge_leaves_no_orphan_ledger_rows(client: TestClient, db: Session) -> None:
    """Ledger rows (prompt logs, guardrail excerpts, request logs, export
    events) must not survive the purge with content intact. FAIL = finding."""
    from tollms.models.api_key import ApiRequestLog
    from tollms.models.guardrail import GuardrailTrigger
    from tollms.models.prompt_logging import PromptLog
    from tollms.models.request_log import ExportEvent, RequestLog
    from tollms.services.jobs import scheduler

    u = _mkuser("purgegap")
    uid = _uid(u)
    _seed_owned_rows(db, uid)
    scheduler._purge_user_data(db, uid)
    leftover = {
        m.__tablename__: _count(db, m, uid)
        for m in (PromptLog, GuardrailTrigger, RequestLog, ApiRequestLog,
                  ExportEvent)
    }
    assert leftover == {k: 0 for k in leftover}, f"orphan rows after purge: {leftover}"


def test_legal_hold_blocks_purge(client: TestClient, db: Session) -> None:
    from tollms.models.incidents import LegalRequest
    from tollms.services.jobs import scheduler

    assert scheduler._legal_hold_active(db) is False
    db.add(LegalRequest(claimant="audit hold", hold_active=True))
    db.commit()
    assert scheduler._legal_hold_active(db) is True
