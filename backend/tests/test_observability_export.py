"""Wave-3 observability export/privacy tests (Agent 7 wave-1 scope A/E).

Ledger export (csv/jsonl, cursor paging, Analytics.Export+Read org gate,
ExportEvent audit, no bodies), retention-gate hardening (Manage-gated obs
writes, list hides obs rows), content-view audit, encryption at rest, and
account-purge completeness (obs rows gone, security_audit.actor_user_id
nulled, PurgeAuditLog last with counts).
"""

import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.prompt_logging.settings import decrypt_body
from tollms.models.api_key import ApiKey
from tollms.models.organization import AuditLog, Invitation
from tollms.models.prompt_logging import PromptLog
from tollms.models.purge_audit import PurgeAuditLog
from tollms.models.request_log import ExportEvent
from tollms.models.security_audit import SecurityAuditEvent
from tollms.models.user import User
from tollms.services.prompt_logging import capture as capture_engine

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"
EXPORT = "/api/v1/prompt-logs/logs/export"


def _other(email: str) -> TestClient:
    from tollms.main import app

    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        c.get("/auth/verify", params={"token": token})
    return c


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _org(c: TestClient, name: str = "Export Org") -> str:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _invite(root: TestClient, member: TestClient, db: Session, oid: str) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _me(member)["email"], "set_ids": []})
    assert inv.status_code == 201, inv.text
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    db.refresh(row)
    acc = member.post(f"{ORG}/invitations/by-token/{row.token}/accept")
    assert acc.status_code == 200, acc.text


def _set(root: TestClient, oid: str, name: str, codes: list[str]) -> str:
    r = root.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": codes})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _assign(root: TestClient, oid: str, uid: str, sids: list[str]) -> None:
    r = root.post(f"{ORG}/{oid}/members/{uid}/sets", json={"set_ids": sids})
    assert r.status_code == 200, r.text


def _enable_personal(c: TestClient) -> None:
    r = c.put(f"{PL}/settings", json={"enabled": True, "mode": "global",
                                      "capture_input": True,
                                      "capture_output": True})
    assert r.status_code == 200, r.text


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"ex-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _seed_personal(c: TestClient, db: Session, user: dict, n: int = 3,
                   trace_prefix: str = "TX") -> list[str]:
    _enable_personal(c)
    uid = uuid.UUID(user["id"])
    ids = []
    for i in range(n):
        row = capture_engine.capture_post(
            db, input_text=f"secret-in-{i}", output_text=f"secret-out-{i}",
            user_id=uid, endpoint="chat", source="internal",
            request_id=f"ex-req-{i}", trace_id=f"{trace_prefix}-{i}",
            session_key="sess-ex", status="completed",
            full_tokens={"total": 10 * (i + 1)})
        assert row is not None
        ids.append(str(row.id))
    return ids


def _seed_org(c: TestClient, db: Session, user: dict, oid: str, n: int = 2,
              trace_prefix: str = "OX") -> list[str]:
    r = c.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                      "mode": "global", "capture_input": True,
                                      "capture_output": True})
    assert r.status_code == 200, r.text
    uid = uuid.UUID(user["id"])
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    ids = []
    for i in range(n):
        row = capture_engine.capture_post(
            db, input_text="org-secret-in", output_text="org-secret-out",
            user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
            key_provenance="organization", endpoint="chat_completions",
            source="external", request_id=f"ex-org-{i}",
            trace_id=f"{trace_prefix}-{i}", status="completed")
        assert row is not None
        ids.append(str(row.id))
    return ids


def _export_events(db: Session) -> list:
    db.expire_all()
    return list(db.scalars(select(ExportEvent).where(
        ExportEvent.dataset == "prompt_logs")))


# --- personal export ----------------------------------------------------------


def test_personal_export_csv_and_audit(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_personal(client, db, user, 3)

    r = client.get(EXPORT, params={"format": "csv"})
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers["content-type"]
    assert "attachment" in r.headers["content-disposition"]

    parsed = list(csv.DictReader(io.StringIO(r.text)))
    assert len(parsed) == 3
    assert parsed[0]["trace_id"].startswith("TX-")
    assert all(p["session_key"] == "sess-ex" for p in parsed)
    # Metadata only: no bodies, no secrets on the wire.
    assert "input_text" not in parsed[0] and "output_text" not in parsed[0]
    assert "secret-in-0" not in r.text and "secret-out-0" not in r.text

    evs = _export_events(db)
    assert len(evs) == 1
    assert evs[0].format == "csv" and evs[0].item_count == 3
    assert evs[0].user_id == uuid.UUID(user["id"])
    assert evs[0].detail == "personal"


def test_personal_export_jsonl_and_cursor_paging(
        client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_personal(client, db, user, 3)

    first = client.get(EXPORT, params={"format": "jsonl", "limit": 2})
    assert first.status_code == 200, first.text
    assert "ndjson" in first.headers["content-type"]
    lines = [json.loads(line) for line in first.text.strip().splitlines()]
    assert len(lines) == 2
    assert lines[0]["trace_id"].startswith("TX-")
    assert "input_cipher" not in lines[0] and "output_cipher" not in lines[0]
    cursor = first.headers.get("X-Next-Cursor")
    assert cursor is not None

    second = client.get(EXPORT, params={"format": "jsonl", "limit": 2,
                                        "cursor": cursor})
    assert second.status_code == 200, second.text
    rest = [json.loads(line) for line in second.text.strip().splitlines()]
    assert len(rest) == 1
    assert {line["id"] for line in lines} .isdisjoint({line["id"] for line in rest})
    assert second.headers.get("X-Next-Cursor") is None  # drained

    assert client.get(EXPORT, params={"format": "xml"}).status_code == 422
    assert client.get(EXPORT, params={"format": "jsonl",
                                      "cursor": "bogus"}).status_code == 422


def test_export_trace_filter_and_empty(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_personal(client, db, user, 3, trace_prefix="FX")
    r = client.get(EXPORT, params={"format": "csv", "trace_id": "FX-1"})
    assert r.status_code == 200, r.text
    assert len(list(csv.DictReader(io.StringIO(r.text)))) == 1
    empty = client.get(EXPORT, params={"format": "csv", "trace_id": "FX-nope"})
    assert empty.status_code == 200
    assert list(csv.DictReader(io.StringIO(empty.text))) == []


# --- org export gates ---------------------------------------------------------


def test_org_export_requires_read_and_export(
        client: TestClient, db: Session, user_factory) -> None:
    """E8: org export needs BOTH PromptLogs.Read and Analytics.Export."""
    root = user_factory()
    member = _other("ex-member@tollma.ai")
    oid = _org(client, "Export Gates")
    _invite(client, member, db, oid)
    _seed_org(client, db, root, oid, 2)
    _seed_personal(member, db, _me(member), 1)  # member's own personal row

    # No grants: 404 oracle.
    assert member.get(EXPORT, params={"org_id": oid}).status_code == 404
    # Read alone: still 404 (Export gate missing).
    _assign(client, oid, _me(member)["id"], [_set(client, oid, "Read", ["PromptLogs.Read"])])
    assert member.get(EXPORT, params={"org_id": oid}).status_code == 404
    # Both gates: 200 with only org rows.
    _assign(client, oid, _me(member)["id"],
            [_set(client, oid, "RE", ["PromptLogs.Read", "Analytics.Export"])])
    r = member.get(EXPORT, params={"format": "csv", "org_id": oid})
    assert r.status_code == 200, r.text
    parsed = list(csv.DictReader(io.StringIO(r.text)))
    assert len(parsed) == 2
    assert all(p["trace_id"].startswith("OX-") for p in parsed)
    assert "secret-in-0" not in r.text  # personal row excluded, no bodies

    evs = _export_events(db)
    assert len(evs) == 1 and evs[0].detail == f"org_id={oid}"


def test_export_cross_org_empty_no_leak(
        client: TestClient, db: Session, user_factory) -> None:
    """A6: exporting under another workspace yields no foreign bytes."""
    root = user_factory()
    oid_a = _org(client, "Export A")
    member = _other("ex-xorg@tollma.ai")
    oid_b = _org(member, "Export B")
    _invite(client, member, db, oid_a)
    _assign(client, oid_a, _me(member)["id"],
            [_set(client, oid_a, "RE", ["PromptLogs.Read", "Analytics.Export"])])
    _seed_org(client, db, root, oid_a, 2, trace_prefix="AX")

    r = member.get(EXPORT, params={"format": "csv", "org_id": oid_b})
    assert r.status_code == 200, r.text  # root of org_b: empty page
    assert list(csv.DictReader(io.StringIO(r.text))) == []
    # Member WITH gates in org_b still sees zero org_a rows.
    _assign(member, oid_b, _me(member)["id"],
            [_set(member, oid_b, "RE2", ["PromptLogs.Read", "Analytics.Export"])])
    r = member.get(EXPORT, params={"format": "jsonl", "org_id": oid_b,
                                   "trace_id": "AX-0"})
    assert r.status_code == 200, r.text
    assert r.text.strip() == ""  # empty page, no org_a bytes
    evs = _export_events(db)
    assert all(f"org_id={oid_a}" not in (e.detail or "") for e in evs)


# --- retention gates (E7) -----------------------------------------------------


def test_org_retention_write_requires_manage(
        client: TestClient, db: Session, user_factory) -> None:
    """E7: any-member retention writes are gone; obs writes need Manage."""
    user_factory()
    member = _other("ex-ret@tollma.ai")
    oid = _org(client, "Retention Gates")
    _invite(client, member, db, oid)

    payload = {"data_category": "prompt_logs", "retention_days": 30,
               "org_id": oid}
    assert member.put("/api/v1/privacy/retention", json=payload).status_code == 404
    zero = {"data_category": "prompt_logs", "zero_retention": True,
            "org_id": oid}
    assert member.put("/api/v1/privacy/retention", json=zero).status_code == 404

    # Non-obs category write is also member-gated (404 for the same stranger
    # shape); Manage-holder can write obs categories.
    _assign(client, oid, _me(member)["id"],
            [_set(client, oid, "Man", ["PromptLogs.Manage"])])
    r = member.put("/api/v1/privacy/retention", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["org_id"] == oid and r.json()["retention_days"] == 30


def test_org_retention_list_hides_obs_without_read(
        client: TestClient, db: Session, user_factory) -> None:
    """F-R1 list side: obs rows hidden from members lacking Read."""
    user_factory()
    member = _other("ex-retlist@tollma.ai")
    oid = _org(client, "Retention List")
    _invite(client, member, db, oid)
    assert client.put("/api/v1/privacy/retention",
                      json={"data_category": "prompt_logs",
                            "retention_days": 30, "org_id": oid}).status_code == 200
    assert client.put("/api/v1/privacy/retention",
                      json={"data_category": "messages",
                            "retention_days": 60, "org_id": oid}).status_code == 200

    # Zero-grant member: 404 oracle (no membership permission surface at all).
    assert member.get("/api/v1/privacy/retention",
                      params={"org_id": oid}).status_code == 404
    # Member holding an unrelated code: list works, obs rows filtered out.
    _assign(client, oid, _me(member)["id"],
            [_set(client, oid, "Usage", ["Analytics.ViewUsage"])])
    cats = {row["data_category"] for row in
            member.get("/api/v1/privacy/retention", params={"org_id": oid}).json()}
    assert "messages" in cats and "prompt_logs" not in cats

    _assign(client, oid, _me(member)["id"], [_set(client, oid, "Read", ["PromptLogs.Read"])])
    cats = {row["data_category"] for row in
            member.get("/api/v1/privacy/retention", params={"org_id": oid}).json()}
    assert {"messages", "prompt_logs"} <= cats


# --- content-view audit -------------------------------------------------------


def test_content_view_writes_audit_row_without_bodies(
        client: TestClient, db: Session, user_factory) -> None:
    """Org body access writes one AuditLog row (who/when/row id, never body)."""
    root = user_factory()
    member = _other("ex-view@tollma.ai")
    oid = _org(client, "View Audit")
    _invite(client, member, db, oid)
    _assign(client, oid, _me(member)["id"], [_set(client, oid, "Read", ["PromptLogs.Read"])])
    (log_id,) = _seed_org(client, db, root, oid, 1, trace_prefix="VX")

    before = db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.content_viewed"))
    assert before is None
    restricted = member.get(f"{PL}/logs/{log_id}", params={"org_id": oid}).json()
    assert restricted["content_restricted"] is True
    assert restricted["input_text"] is None
    # Restricted view writes no content-view audit row.
    assert db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.content_viewed")) is None

    _assign(client, oid, _me(member)["id"],
            [_set(client, oid, "View", ["PromptLogs.Read", "PromptLogs.ViewContent"])])
    opened = member.get(f"{PL}/logs/{log_id}", params={"org_id": oid}).json()
    assert opened["content_restricted"] is False
    assert opened["input_text"] == "org-secret-in"

    audit = db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.content_viewed"))
    assert audit is not None
    assert audit.actor_user_id == uuid.UUID(_me(member)["id"])
    blob = json.dumps(audit.target or {})
    assert log_id in blob and "org-secret-in" not in blob and "org-secret-out" not in blob


# --- encryption at rest -------------------------------------------------------


def test_bodies_encrypted_at_rest(client: TestClient, db: Session, user_factory) -> None:
    """E1: DB ciphers are Fernet tokens, never plaintext; decrypt round-trips."""
    user = user_factory()
    (log_id,) = _seed_personal(client, db, user, 1)
    row = db.get(PromptLog, uuid.UUID(log_id))
    assert row is not None and row.input_cipher and row.output_cipher
    assert row.input_cipher != "secret-in-0" and row.output_cipher != "secret-out-0"
    assert row.input_cipher.startswith("gAAAAA")  # Fernet token shape
    assert decrypt_body(row.input_cipher) == "secret-in-0"
    assert decrypt_body(row.output_cipher) == "secret-out-0"


# --- purge --------------------------------------------------------------------


def _run_deletion_job(db: Session, monkeypatch) -> None:
    from sqlalchemy.orm import sessionmaker

    from tollms.services.jobs import scheduler

    assert scheduler._scheduler is None  # pytest guard: scheduler never started
    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=db.get_bind()))
    scheduler._deletion_job()
    db.expire_all()


def test_account_purge_clears_obs_and_anonymizes_audit(
        client: TestClient, db: Session, user_factory, monkeypatch) -> None:
    """E9: purge drops obs ledgers; security_audit.actor_user_id nulled."""
    from tollms.models.scores import Score

    user = user_factory("ex-purge@tollma.ai")
    uid = uuid.UUID(user["id"])
    (log_id,) = _seed_personal(client, db, user, 1)
    from datetime import date as _date

    db.add(Score(user_id=uid, org_id=None, name="q", subject_day=_date.today(),
                 data_type="numeric",
                 value_num=1, trace_id="TX-0", prompt_log_id=uuid.UUID(log_id)))
    db.add(SecurityAuditEvent(
        actor_type="user", actor_user_id=uid,
        event_type="auth.login", severity="info", outcome="allowed"))
    db.commit()
    assert db.scalar(select(PromptLog).where(PromptLog.user_id == uid)) is not None

    now = datetime.now(timezone.utc)
    row = db.get(User, uid)
    assert row is not None
    row.deletion_requested_at = now - timedelta(days=16)
    row.deletion_scheduled_for = now - timedelta(hours=1)
    row.deletion_notice_stage = 1
    db.commit()

    _run_deletion_job(db, monkeypatch)

    assert db.get(User, uid) is None
    assert db.scalars(select(PromptLog)).all() == []  # user ledger gone
    assert db.scalars(select(Score)).all() == []  # user scores cascade
    remaining = db.scalars(select(SecurityAuditEvent)).all()
    assert remaining and all(e.actor_user_id is None for e in remaining)
    audits = db.scalars(select(PurgeAuditLog).where(
        PurgeAuditLog.deleted_user_id == uid)).all()
    assert len(audits) == 1 and audits[0].result == "ok"
    assert audits[0].counts.get("prompt_logs") == 1  # per-resource counts kept
