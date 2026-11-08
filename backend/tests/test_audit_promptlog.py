"""Subagent D audit: prompt-logging config inventory verification + §10/§11 rows.

Scope: personal/org enablement, precedence matrix, content-vs-metadata
separation with synthetic markers, redaction boundaries, retention/deletion/
export/pagination/auth gates, expiry isolation, streaming statuses, duplicate
suppression, request-log-always vs prompt-log-gated, summarizer non-capture.

Fixtures are dedicated per test (unique AUDIT_* markers); nothing here
touches rows outside its own test (conftest hard-cleans between tests).
Transports are mocked (fake adapters); no real network.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.gateway import service as chat_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.prompt_logging.settings import decrypt_body
from tollms.models.api_key import ApiKey
from tollms.models.prompt_logging import PromptLog, PromptLoggingSetting
from tollms.models.request_log import RequestLog
from tollms.services.gateway.adapters.base import ChatResult
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import retention as retention_engine

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"


def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["id"])


def _enable(client: TestClient, **kw) -> dict:
    body = {"enabled": True, "mode": "global", "capture_input": True,
            "capture_output": True, **kw}
    r = client.put(f"{PL}/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"a-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _mk_org(db: Session, owner_id: uuid.UUID, name: str):
    from tollms.models.organization import Membership, MembershipState, Organization

    org = Organization(name=name, slug=f"{name}-{uuid.uuid4().hex[:8]}".lower(),
                       root_user_id=owner_id)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=owner_id, is_root=True,
                      state=MembershipState.ACTIVE.value))
    db.flush()
    return org


def _rows(db: Session) -> list:
    db.expire_all()
    return list(db.scalars(select(PromptLog).order_by(PromptLog.created_at)))


class _FakeAdapter:
    def __init__(self, text: str = "audit out") -> None:
        self._text = text

    async def chat(self, messages):
        return ChatResult(text=self._text, prompt_tokens=4,
                          completion_tokens=6, total_tokens=10)


# --- personal enable/disable -------------------------------------------------

def test_audit_personal_enable_send_record_exists(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable(client)
    row = capture_engine.capture_post(
        db, input_text="AUDIT_INPUT_P1 system+user", output_text="AUDIT_OUTPUT_P1",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-p1", status="completed",
        tokens={"prompt": 4, "completion": 6})
    assert row is not None
    assert decrypt_body(row.input_cipher) == "AUDIT_INPUT_P1 system+user"
    assert decrypt_body(row.output_cipher) == "AUDIT_OUTPUT_P1"
    assert (row.input_chars, row.output_chars) == (26, 15)
    assert row.workspace_type == "personal" and row.match_source == "global"
    detail = client.get(f"{PL}/logs/{row.id}").json()
    assert detail["input_text"] == "AUDIT_INPUT_P1 system+user"
    assert detail["content_restricted"] is False


def test_audit_personal_disable_send_disallowed_absent(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable(client)
    r = client.put(f"{PL}/settings", json={"enabled": False})
    assert r.status_code == 200, r.text
    row = capture_engine.capture_post(
        db, input_text="AUDIT_INPUT_P2", output_text="AUDIT_OUTPUT_P2",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-p2", status="completed")
    assert row is None
    assert _rows(db) == []


def test_audit_each_option_toggles_behavior(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)

    def run(ci: bool, co: bool, tag: str):
        client.put(f"{PL}/settings", json={"enabled": True, "capture_input": ci,
                                           "capture_output": co})
        return capture_engine.capture_post(
            db, input_text=f"AUDIT_IN_{tag}", output_text=f"AUDIT_OUT_{tag}",
            user_id=uid, endpoint="chat", source="internal",
            request_id=f"audit-t-{tag}", status="completed")

    both = run(True, True, "both")
    assert both.input_cipher and both.output_cipher
    only_in = run(True, False, "in")
    assert only_in.input_cipher and only_in.output_cipher is None
    only_out = run(False, True, "out")
    assert only_out.input_cipher is None and only_out.output_cipher
    meta_only = run(False, False, "meta")
    assert meta_only is not None  # metadata row persists by design
    assert meta_only.input_cipher is None and meta_only.output_cipher is None
    assert meta_only.input_chars == len("AUDIT_IN_meta")
    listed = {r["id"]: r["fields"] for r in client.get(f"{PL}/logs").json()["items"]}
    assert listed[str(both.id)] == ["input", "output"]
    assert listed[str(only_in.id)] == ["input"]
    assert listed[str(only_out.id)] == ["output"]
    assert listed[str(meta_only.id)] == []


def test_audit_reload_persistence(
        client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    first = _enable(client, capture_output=False, retention_days=30)
    assert first["version"] == 1
    db.expire_all()
    again = client.get(f"{PL}/settings").json()
    assert again["capture_input"] is True and again["capture_output"] is False
    assert again["retention_days"] == 30 and again["version"] == 1
    second = _enable(client, capture_output=False, retention_days=30)
    assert second["version"] == 2  # versioned upsert on reload


def test_audit_model_conversation_switch_no_leakage(
        client: TestClient, db: Session, user_factory,
        provider_factory, model_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable(client)
    p = provider_factory("AuditP")
    m1 = model_factory(p["id"])
    m2 = model_factory(p["id"], model_id="mock-model-2", name="Mock2")
    c1 = uuid.UUID(client.post(
        "/api/v1/conversations",
        json={"title": "Audit C1", "provider_id": p["id"],
              "model_id": m1["id"]}).json()["id"])
    c2 = uuid.UUID(client.post(
        "/api/v1/conversations",
        json={"title": "Audit C2", "provider_id": p["id"],
              "model_id": m2["id"]}).json()["id"])
    r1 = capture_engine.capture_post(
        db, input_text="AUDIT_INPUT_C1", output_text="AUDIT_OUTPUT_C1",
        user_id=uid, provider_id=uuid.UUID(p["id"]),
        model_id=uuid.UUID(m1["id"]), conversation_id=c1,
        endpoint="chat", source="internal", request_id="audit-c1",
        status="completed")
    r2 = capture_engine.capture_post(
        db, input_text="AUDIT_INPUT_C2", output_text="AUDIT_OUTPUT_C2",
        user_id=uid, provider_id=uuid.UUID(p["id"]),
        model_id=uuid.UUID(m2["id"]), conversation_id=c2,
        endpoint="chat", source="internal", request_id="audit-c2",
        status="completed")
    assert r1 is not None and r2 is not None
    by_model = client.get(f"{PL}/logs", params={"model_id": m1["id"]}).json()["items"]
    assert [r["id"] for r in by_model] == [str(r1.id)]
    d1 = client.get(f"{PL}/logs/{r1.id}").json()
    d2 = client.get(f"{PL}/logs/{r2.id}").json()
    assert d1["conversation_id"] == str(c1) and "AUDIT_OUTPUT_C1" in d1["output_text"]
    assert "AUDIT_INPUT_C1" not in (d2["input_text"] or "")  # no cross-row leak


def test_audit_no_cross_user_leakage(
        client: TestClient, db: Session, user_factory) -> None:
    from tollms.main import app as _app

    user = user_factory()
    _enable(client)
    row = capture_engine.capture_post(
        db, input_text="AUDIT_INPUT_X", output_text="AUDIT_OUTPUT_X",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-x", status="completed")
    assert row is not None
    stranger = TestClient(_app)
    r = stranger.post("/auth/signup", json={"email": "audit-stranger@tollma.ai",
                                            "password": "Password123",
                                            "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    assert token, "expected debug verification token under pytest"
    v = stranger.get("/auth/verify", params={"token": token})
    assert v.status_code == 200, v.text
    assert stranger.get(f"{PL}/logs").json()["items"] == []
    assert stranger.get(f"{PL}/logs/{row.id}").status_code == 404
    assert client.get(f"{PL}/logs").json()["items"] != []


def test_audit_unauthenticated_rejected() -> None:
    from tollms.main import app as _app

    anon = TestClient(_app)
    assert anon.get(f"{PL}/settings").status_code in (401, 403)
    assert anon.get(f"{PL}/logs").status_code in (401, 403)


# --- organization ------------------------------------------------------------

def test_audit_org_applies_and_change_applies(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    oid = client.post(ORG, json={"name": "Audit Org"}).json()["id"]
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "global", "capture_input": True,
                                           "capture_output": True})
    assert r.status_code == 200, r.text
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    first = capture_engine.capture_post(
        db, input_text="AUDIT_ORG_IN1", output_text="AUDIT_ORG_OUT1",
        user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
        key_provenance="organization", endpoint="chat_completions",
        source="external", request_id="audit-o1", status="completed")
    assert first is not None and first.org_id == uuid.UUID(oid)
    assert first.key_provenance == "organization"
    # Change applies to later sends; earlier rows keep their policy version.
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                       "mode": "global", "capture_input": True,
                                       "capture_output": False})
    second = capture_engine.capture_post(
        db, input_text="AUDIT_ORG_IN2", output_text="AUDIT_ORG_OUT2",
        user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
        key_provenance="organization", endpoint="chat_completions",
        source="external", request_id="audit-o2", status="completed")
    assert second is not None and second.output_cipher is None
    assert decrypt_body(second.input_cipher) == "AUDIT_ORG_IN2"
    db.refresh(first)
    assert decrypt_body(first.output_cipher) == "AUDIT_ORG_OUT1"


def test_audit_personal_cannot_override_org_mandatory(
        client: TestClient, db: Session, user_factory) -> None:
    """Org global ON + personal key traffic: key provenance pins the ledger,
    so a personal setting can neither divert org rows nor weaken org policy."""
    from tollms.services.prompt_logging import resolution as resolution_engine

    user = user_factory()
    uid = _uid(user)
    org = _mk_org(db, uid, "AuditMand")
    db.add(PromptLoggingSetting(org_id=org.id, user_id=None, enabled=True,
                               mode="global", capture_input=True,
                               capture_output=True))
    db.add(PromptLoggingSetting(user_id=uid, org_id=None, enabled=True,
                               mode="global", capture_input=True,
                               capture_output=True))
    db.commit()
    org_key = _mk_key(db, uid, org.id)
    personal_key = _mk_key(db, uid)
    got_org = resolution_engine.resolve_setting(
        db, user_id=uid, org_id=org.id, api_key_id=org_key.id,
        key_provenance="organization")
    assert got_org.setting is not None and got_org.setting.org_id == org.id
    got_personal = resolution_engine.resolve_setting(
        db, user_id=uid, org_id=org.id, api_key_id=personal_key.id,
        key_provenance="personal")
    assert got_personal.setting is not None and got_personal.setting.org_id is None


def test_audit_no_platform_or_request_scope() -> None:
    """Inventory honesty: there is no platform-level switch and no
    per-request opt-out — allow_store is hardcoded True at all three capture
    call sites (gateway, generation driver, public gateway)."""
    import inspect

    from tollms.services.prompt_logging import capture as cap

    assert "allow_store" in inspect.signature(cap.build_row_kwargs).parameters
    for module_path, func in (
        ("tollms.api.gateway.service", "_promptlog_capture"),
        ("tollms.services.generation", "GenerationDriver._promptlog_capture"),
        ("tollms.api.public_gateway.service", "_promptlog_capture"),
    ):
        src = inspect.getsource(__import__(module_path, fromlist=["x"]))
        assert "allow_store=True" in src, module_path


# --- content vs metadata -----------------------------------------------------

def test_audit_metadata_persists_when_content_disabled(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    client.put(f"{PL}/settings", json={"enabled": True, "capture_input": False,
                                       "capture_output": False})
    row = capture_engine.capture_post(
        db, input_text="AUDIT_META_IN", output_text="AUDIT_META_OUT",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-meta", status="completed",
        tokens={"prompt": 3, "completion": 7},
        full_tokens={"total": 10, "cache_read": 1, "cache_write": 0,
                     "reasoning": 2})
    assert row is not None
    assert row.input_cipher is None and row.output_cipher is None
    assert row.prompt_tokens == 3 and row.total_tokens == 10
    assert row.reasoning_tokens == 2 and row.cache_read_tokens == 1


def test_audit_failed_cancelled_statuses_and_levels(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable(client)
    failed = capture_engine.capture_post(
        db, input_text="AUDIT_FAIL_IN", output_text=None, user_id=uid,
        endpoint="chat", source="internal", request_id="audit-f",
        status="failed", error_code="E_UPSTREAM",
        status_message="AUDIT_FAIL upstream boom")
    cancelled = capture_engine.capture_post(
        db, input_text="AUDIT_CANCEL_IN", output_text="", user_id=uid,
        endpoint="chat", source="internal", request_id="audit-c",
        status="cancelled")
    partial = capture_engine.capture_post(
        db, input_text="AUDIT_PART_IN", output_text="AUDIT_PART_half",
        user_id=uid, endpoint="chat", source="internal",
        request_id="audit-part", status="partial")
    assert failed.status == "failed" and failed.level == "error"
    assert failed.output_cipher is None and failed.error_code == "E_UPSTREAM"
    assert decrypt_body(failed.input_cipher) == "AUDIT_FAIL_IN"
    assert "AUDIT_FAIL" in (failed.status_message or "")
    assert cancelled.status == "cancelled" and cancelled.level == "warning"
    assert partial.status == "partial" and partial.level == "warning"
    assert decrypt_body(partial.output_cipher) == "AUDIT_PART_half"


def test_audit_request_log_always_metadata_only(
        client: TestClient, db: Session, user_factory,
        provider_factory, model_factory, monkeypatch) -> None:
    """RequestLog (analytics ledger) is written even with prompt logging OFF
    and never carries content — only usage metadata."""
    import pytest as _pytest

    user = user_factory()
    uid = _uid(user)
    p = provider_factory("AuditReq")
    m = model_factory(p["id"])
    r = client.post("/api/v1/keys", json={"name": "audit req key"})
    assert r.status_code == 201, r.text
    kid = r.json()["key"]["id"]
    monkeypatch.setattr(chat_service, "build_adapter",
                        lambda *a, **k: _FakeAdapter("AUDIT_REQ_OUT"))
    result = asyncio.run(chat_service.run_chat(
        db, ChatRequest(provider_id=uuid.UUID(p["id"]),
                        model_id=uuid.UUID(m["id"]), message="AUDIT_REQ_IN",
                        key_id=uuid.UUID(kid)), None, user_id=uid))
    assert result.content == "AUDIT_REQ_OUT"
    db.expire_all()
    req_rows = db.scalars(select(RequestLog)).all()
    assert len(req_rows) == 1
    assert req_rows[0].status == "success"
    assert "AUDIT_REQ_IN" not in str(req_rows[0].__dict__)
    assert "AUDIT_REQ_OUT" not in str(req_rows[0].__dict__)
    assert _rows(db) == []  # prompt logging OFF -> no prompt row


def test_audit_summarizer_creates_no_prompt_rows(
        client: TestClient, db: Session, user_factory) -> None:
    """Compaction summarizer calls adapter.chat directly (no ledger hook):
    with full capture ON, a summary request still writes zero prompt rows.
    Cross-boundary documentation — compaction.py is NOT edited here."""
    from tollms.api.conversations import compaction

    user_factory()
    _enable(client)
    out = asyncio.run(compaction._default_summarizer(
        _FakeAdapter("AUDIT_SUMMARY"), "instruction", "AUDIT_SUMMARY_TRANSCRIPT"))
    assert out == "AUDIT_SUMMARY"
    assert _rows(db) == []


# --- redaction ----------------------------------------------------------------

def test_audit_status_message_redacts_secrets(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable(client)
    secret = "sk-AUDITSECRET1234567890"
    row = capture_engine.capture_post(
        db, input_text="in", output_text=None, user_id=_uid(user),
        endpoint="chat", source="internal", request_id="audit-red",
        status="failed", status_message=f"upstream said {secret} denied")
    assert row is not None
    assert secret not in (row.status_message or "")
    assert "[redacted-secret]" in (row.status_message or "")


def test_audit_bodies_encrypted_not_redacted_by_design(
        client: TestClient, db: Session, user_factory) -> None:
    """Bodies are encrypted verbatim (vault, ViewContent-gated) — secret
    shapes inside input/output are NOT scrubbed; only status_message is."""
    user = user_factory()
    _enable(client)
    marker = "sk-AUDITBODYSECRET1234567890"
    row = capture_engine.capture_post(
        db, input_text=f"key is {marker}", output_text="ok",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-body", status="completed")
    assert row is not None
    assert decrypt_body(row.input_cipher) == f"key is {marker}"


def test_audit_export_never_carries_bodies(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable(client)
    capture_engine.capture_post(
        db, input_text="AUDIT_EXPORT_IN", output_text="AUDIT_EXPORT_OUT",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-exp", status="completed")
    for fmt, ctype in (("csv", "text/csv"), ("jsonl", "application/x-ndjson")):
        r = client.get(f"{PL}/logs/export", params={"format": fmt})
        assert r.status_code == 200, r.text
        assert ctype in r.headers["content-type"]
        assert "AUDIT_EXPORT_IN" not in r.text
        assert "AUDIT_EXPORT_OUT" not in r.text
    # Formula-injection guard: dangerous leading chars are quote-prefixed.
    from tollms.api.prompt_logging.records import _csv_safe

    assert _csv_safe("=cmd") == "'=cmd"
    assert _csv_safe("plain") == "plain"


# --- retention / deletion / expiry --------------------------------------------

def test_audit_expiry_touches_only_dedicated_rows(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable(client)
    doomed = capture_engine.capture_post(
        db, input_text="AUDIT_DOOMED_IN", output_text="AUDIT_DOOMED_OUT",
        user_id=uid, endpoint="chat", source="internal",
        request_id="audit-doomed", status="completed")
    kept = capture_engine.capture_post(
        db, input_text="AUDIT_KEPT_IN", output_text="AUDIT_KEPT_OUT",
        user_id=uid, endpoint="chat", source="internal",
        request_id="audit-kept", status="completed")
    assert doomed is not None and kept is not None
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(PromptLog.__table__.update().where(
        PromptLog.id == doomed.id).values(expires_at=past))
    db.commit()
    assert retention_engine.expire_due_logs(db) == 1
    db.refresh(doomed)
    db.refresh(kept)
    assert doomed.content_expired is True and doomed.input_cipher is None
    assert doomed.request_id == "audit-doomed"  # metadata kept
    assert kept.content_expired is False and kept.input_cipher is not None
    assert retention_engine.expire_due_logs(db) == 0  # idempotent


def test_audit_delete_removes_row_purge_keeps_metadata(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable(client)
    gone = capture_engine.capture_post(
        db, input_text="AUDIT_GONE", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="audit-gone",
        status="completed")
    assert client.delete(f"{PL}/logs/{gone.id}").status_code == 204
    assert client.get(f"{PL}/logs/{gone.id}").status_code == 404
    kept = capture_engine.capture_post(
        db, input_text="AUDIT_PURGED", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="audit-purged",
        status="completed")
    r = client.post(f"{PL}/logs/purge", json={})
    assert r.status_code == 200 and r.json()["expired_count"] == 1
    db.refresh(kept)
    assert kept.content_expired is True and kept.input_cipher is None
    assert kept.request_id == "audit-purged"


def test_audit_pagination_stable_and_bounded(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable(client)
    for i in range(5):
        capture_engine.capture_post(
            db, input_text=f"AUDIT_PAGE_{i}", output_text="o",
            user_id=_uid(user), endpoint="chat", source="internal",
            request_id=f"audit-page-{i}", status="completed")
    seen: set[str] = set()
    cursor = None
    for _ in range(3):
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        r = client.get(f"{PL}/logs", params=params)
        assert r.status_code == 200, r.text
        for item in r.json()["items"]:
            assert item["id"] not in seen
            seen.add(item["id"])
        cursor = r.headers.get("X-Next-Cursor")
        if not cursor:
            break
    assert len(seen) == 5
    assert client.get(f"{PL}/logs", params={"cursor": "bogus"}).status_code == 422
    assert client.get(f"{PL}/logs", params={"status": "bogus"}).status_code == 422


# --- streaming / duplicates / final usage -------------------------------------

def test_audit_duplicate_delivery_suppressed(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable(client)
    gid = uuid.uuid4()
    first = capture_engine.capture_post(
        db, input_text="AUDIT_DUP_IN", output_text="AUDIT_DUP_OUT",
        user_id=uid, endpoint="chat", source="internal",
        request_id="audit-dup", generation_id=gid, status="completed")
    assert first is not None
    second = capture_engine.capture_post(
        db, input_text="AUDIT_DUP_IN", output_text="AUDIT_DUP_OUT",
        user_id=uid, endpoint="chat", source="internal",
        request_id="audit-dup", generation_id=gid, status="completed")
    assert second is None  # unique (request_id, generation_id) collapses redelivery
    assert len(_rows(db)) == 1


def test_audit_final_usage_persisted(
        client: TestClient, db: Session, user_factory) -> None:
    from decimal import Decimal

    user = user_factory()
    _enable(client)
    row = capture_engine.capture_post(
        db, input_text="AUDIT_USE_IN", output_text="AUDIT_USE_OUT",
        user_id=_uid(user), endpoint="chat", source="internal",
        request_id="audit-use", status="completed",
        tokens={"prompt": 11, "completion": 22},
        full_tokens={"total": 33, "cache_read": 4, "cache_write": 5,
                     "reasoning": 6},
        estimated=False,
        cost={"input": Decimal("0.0001"), "output": Decimal("0.0002"),
              "total": Decimal("0.0003")},
        currency="USD", pricing_version="audit-pin-1",
        finish_reason="stop",
        model_params={"temperature": 0.5},
        latency_ms=123.0)
    assert row is not None
    detail = client.get(f"{PL}/logs/{row.id}").json()
    assert detail["prompt_tokens"] == 11 and detail["completion_tokens"] == 22
    assert detail["total_tokens"] == 33 and detail["reasoning_tokens"] == 6
    assert detail["cache_read_tokens"] == 4
    assert detail["total_cost"] == "0.00030000"
    assert detail["currency"] == "USD" and detail["pricing_version"] == "audit-pin-1"
    assert detail["finish_reason"] == "stop"
    assert detail["model_params"] == {"temperature": 0.5}
    assert detail["latency_ms"] == 123.0 and detail["duration_ms"] == 123
