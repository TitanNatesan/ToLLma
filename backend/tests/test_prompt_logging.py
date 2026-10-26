"""Workspace prompt logging: settings, resolution, capture flags, ledger reads."""

import base64
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.main import app
from tollms.models.api_key import ApiKey
from tollms.models.organization import (
    AuditLog,
    Invitation,
    Membership,
    MembershipState,
    Team,
    TeamMembership,
)
from tollms.models.prompt_logging import PromptLog, PromptLoggingSetting
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import resolution as resolution_engine
from tollms.services.prompt_logging import retention as retention_engine

PL = "/api/v1/prompt-logs"
ORG = "/api/v1/orgs"


def _other(email: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        c.get("/auth/verify", params={"token": token})
    return c


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _org(c: TestClient, name: str = "PL Org") -> dict:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


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


def _team(root: TestClient, oid: str, name: str = "Red") -> dict:
    r = root.post(f"{ORG}/{oid}/teams", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _join_team(root: TestClient, oid: str, tid: str, uid: str) -> None:
    r = root.post(f"{ORG}/{oid}/teams/{tid}/members", json={"user_id": uid})
    assert r.status_code == 200, r.text


def _enable_personal(client: TestClient, **kw) -> dict:
    body = {"enabled": True, "mode": "global", "capture_input": True,
            "capture_output": True, **kw}
    r = client.put(f"{PL}/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --- settings CRUD ------------------------------------------------------------


def test_personal_settings_default_and_upsert(client: TestClient, user_factory) -> None:
    user_factory()
    body = client.get(f"{PL}/settings").json()
    assert body["enabled"] is False and body["team_ids"] == []
    assert body["effective_summary"]["capture"] == "none"

    first = _enable_personal(client)
    assert first["version"] == 1 and first["capture_input"] is True
    assert first["effective_summary"]["capture"] == "full"

    second = _enable_personal(client, mode="global", capture_output=False)
    assert second["version"] == 2
    assert second["effective_summary"]["capture"] == "input"


def test_settings_validation(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.put(f"{PL}/settings", json={"mode": "nope"}).status_code == 422
    assert client.put(f"{PL}/settings", json={"retention_days": 0}).status_code == 422
    assert client.put(f"{PL}/settings", json={"retention_days": 3651}).status_code == 422
    r = client.put(f"{PL}/settings",
                   json={"enabled": True, "team_ids": [str(uuid.uuid4())]})
    assert r.status_code == 422, r.text  # teams need an org workspace


def test_org_settings_perm_gates(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    oid = _org(client)["id"]
    member = _other("pl-member@tollma.ai")
    _invite(client, member, db, oid)

    assert member.get(f"{PL}/settings", params={"org_id": oid}).status_code == 404
    assert member.put(f"{PL}/settings", json={"org_id": oid, "enabled": True}).status_code == 404

    sid = _set(client, oid, "PLReader", ["PromptLogs.Read"])
    _assign(client, oid, _me(member)["id"], [sid])
    assert member.get(f"{PL}/settings", params={"org_id": oid}).status_code == 200
    # Read does not imply Manage.
    assert member.put(f"{PL}/settings", json={"org_id": oid, "enabled": True}).status_code == 404

    mid = _set(client, oid, "PLManager", ["PromptLogs.Manage"])
    _assign(client, oid, _me(member)["id"], [mid])
    r = member.put(f"{PL}/settings",
                   json={"org_id": oid, "enabled": True, "capture_input": True})
    assert r.status_code == 200, r.text
    assert db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.settings.update")) is not None


def test_org_team_target_validation(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    oid = _org(client)["id"]
    team = _team(client, oid)
    stranger_client = _other("pl-t@tollma.ai")
    stranger_team = _team(stranger_client, _org(stranger_client, "Other Org")["id"])

    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "teams", "team_ids": [stranger_team["id"]]})
    assert r.status_code == 422, r.text  # cross-org team rejected

    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "teams", "team_ids": [team["id"]]})
    assert r.status_code == 200, r.text
    assert r.json()["team_ids"] == [team["id"]]
    assert r.json()["effective_summary"]["scope"] == {"teams": 1}


def test_personal_upsert_skips_audit(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    _enable_personal(client)
    assert db.scalars(select(AuditLog).where(
        AuditLog.action.like("prompt_logs%"))).all() == []


# --- resolution (cases A–E + multi-org) ---------------------------------------


def _user_row(db: Session, email: str) -> uuid.UUID:
    from tollms.models.user import User

    return db.scalar(select(User.id).where(User.email == email))


def _mk_org_rows(db: Session, owner_id: uuid.UUID, name: str = "R"):
    from tollms.models.organization import Organization

    org = Organization(name=name, slug=f"{name}-{uuid.uuid4().hex[:8]}".lower(),
                       root_user_id=owner_id)
    db.add(org)
    db.flush()
    mem = Membership(org_id=org.id, user_id=owner_id, is_root=True,
                     state=MembershipState.ACTIVE.value)
    db.add(mem)
    db.flush()
    return org, mem


def _mk_key(db: Session, owner_id: uuid.UUID, org_id=None) -> ApiKey:
    key = ApiKey(user_id=owner_id, org_id=org_id, name=f"k-{uuid.uuid4().hex[:6]}",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.flush()
    return key


def _mk_team(db: Session, org_id, name: str = "T") -> Team:
    team = Team(org_id=org_id, name=f"{name}-{uuid.uuid4().hex[:6]}")
    db.add(team)
    db.flush()
    return team


def _seed_org_setting(db: Session, org_id, **kw) -> PromptLoggingSetting:
    defaults = {"mode": "global", "capture_input": True, "capture_output": True}
    defaults.update(kw)
    row = PromptLoggingSetting(org_id=org_id, user_id=None, enabled=True,
                              **defaults)
    db.add(row)
    db.commit()
    return row


def test_resolution_personal_key_never_org_logged(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org, _ = _mk_org_rows(db, uid)
    _seed_org_setting(db, org.id)  # org policy ON
    personal_key = _mk_key(db, uid)  # personal key

    # No personal setting at all: personal-key traffic resolves nothing.
    resolved = resolution_engine.resolve_setting(
        db, user_id=uid, org_id=org.id, api_key_id=personal_key.id,
        key_provenance="personal")
    assert resolved.setting is None

    # Even with a personal setting ON, the org setting must not govern.
    db.add(PromptLoggingSetting(user_id=uid, org_id=None, enabled=True,
                                capture_input=True, capture_output=True))
    db.commit()
    resolved = resolution_engine.resolve_setting(
        db, user_id=uid, org_id=org.id, api_key_id=personal_key.id,
        key_provenance="personal")
    assert resolved.setting is not None and resolved.setting.org_id is None


def test_resolution_org_key_global(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org, _ = _mk_org_rows(db, uid)
    setting = _seed_org_setting(db, org.id)
    org_key = _mk_key(db, uid, org.id)

    resolved = resolution_engine.resolve_setting(
        db, user_id=uid, org_id=org.id, api_key_id=org_key.id,
        key_provenance="organization")
    assert resolved.setting is not None and resolved.setting.id == setting.id
    assert resolved.team_ids is None


def test_resolution_teams_mode(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org, mem = _mk_org_rows(db, uid)
    setting = _seed_org_setting(db, org.id, mode="teams", capture_output=False)
    team = _mk_team(db, org.id)
    org_key = _mk_key(db, uid, org.id)

    def resolve():
        return resolution_engine.resolve_setting(
            db, user_id=uid, org_id=org.id, api_key_id=org_key.id,
            key_provenance="organization")

    # Empty target list logs nothing (never falls back to global).
    assert resolve().setting is None

    from tollms.models.prompt_logging import PromptLoggingTeamTarget
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id))
    db.commit()
    # Target exists but caller not in the team: still nothing.
    assert resolve().setting is None

    db.add(TeamMembership(team_id=team.id, membership_id=mem.id))
    db.commit()
    resolved = resolve()
    assert resolved.setting is not None and resolved.setting.id == setting.id
    assert resolved.team_ids == [str(team.id)]


def test_resolution_multi_org_and_wrong_key(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org_a, _ = _mk_org_rows(db, uid, "RA")
    org_b, _ = _mk_org_rows(db, uid, "RB")
    _seed_org_setting(db, org_b.id)  # only org B has a policy
    key_a = _mk_key(db, uid, org_a.id)

    resolved = resolution_engine.resolve_setting(
        db, user_id=uid, org_id=org_a.id, api_key_id=key_a.id,
        key_provenance="organization")
    assert resolved.setting is None  # org A's key never resolves org B's policy


def test_resolution_unscoped_legacy(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    org, _ = _mk_org_rows(db, uid)
    _seed_org_setting(db, org.id)
    db.add(PromptLoggingSetting(user_id=uid, org_id=None, enabled=True,
                                capture_input=True, capture_output=True))
    db.commit()
    resolved = resolution_engine.resolve_setting(db, user_id=uid)
    assert resolved.setting is not None and resolved.setting.org_id is None


def test_resolution_disabled_skips(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    db.add(PromptLoggingSetting(user_id=uid, org_id=None, enabled=False,
                                capture_input=True, capture_output=True))
    db.commit()
    assert resolution_engine.resolve_setting(db, user_id=uid).setting is None
    assert resolution_engine.resolve_setting(db, user_id=None).setting is None


# --- capture flags ------------------------------------------------------------


def test_capture_flags(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])

    def run(ci: bool, co: bool):
        db.query(PromptLog).delete()
        db.query(PromptLoggingSetting).delete()
        db.commit()
        db.add(PromptLoggingSetting(user_id=uid, org_id=None, enabled=True,
                                    capture_input=ci, capture_output=co))
        db.commit()
        return capture_engine.capture_post(
            db, input_text="hello input", output_text="hello output",
            user_id=uid, endpoint="chat", source="internal",
            request_id="r-1", status="completed")

    row = run(True, True)
    assert row is not None and row.input_cipher and row.output_cipher
    from tollms.api.prompt_logging.settings import decrypt_body
    assert decrypt_body(row.input_cipher) == "hello input"
    assert decrypt_body(row.output_cipher) == "hello output"
    assert (row.input_chars, row.output_chars) == (11, 12)

    row = run(True, False)
    assert row is not None and row.input_cipher and row.output_cipher is None

    row = run(False, True)
    assert row is not None and row.input_cipher is None and row.output_cipher

    row = run(False, False)  # metadata-only row still written
    assert row is not None and row.input_cipher is None and row.output_cipher is None
    assert (row.input_chars, row.output_chars) == (11, 12)


def test_capture_truncation(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.prompt_logging import MAX_BODY_CHARS

    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable_personal(client)
    big = "x" * (MAX_BODY_CHARS + 100)
    row = capture_engine.capture_post(
        db, input_text=big, output_text="ok", user_id=uid,
        endpoint="chat", source="internal", request_id="r-t", status="completed")
    assert row is not None and row.input_truncated is True
    assert row.input_chars == MAX_BODY_CHARS + 100
    assert row.output_truncated is False


def test_teams_empty_logs_nothing_end_to_end(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    oid = _org(client)["id"]
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "teams",
                                           "capture_input": True,
                                           "capture_output": True})
    assert r.status_code == 200, r.text
    key = _mk_key(db, uuid.UUID(user["id"]), uuid.UUID(oid))
    row = capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uuid.UUID(user["id"]),
        org_id=uuid.UUID(oid), api_key_id=key.id, key_provenance="organization",
        endpoint="chat", source="internal", request_id="r-e", status="completed")
    assert row is None
    assert db.scalars(select(PromptLog)).all() == []


# --- listing, detail, 404-oracles ----------------------------------------------


def _seed_rows(client: TestClient, db: Session, user: dict, n: int = 5) -> list[str]:
    _enable_personal(client)
    uid = uuid.UUID(user["id"])
    ids = []
    for i in range(n):
        row = capture_engine.capture_post(
            db, input_text=f"in-{i}", output_text=f"out-{i}", user_id=uid,
            endpoint="chat", source="internal", request_id=f"req-{i:03d}",
            status="completed" if i % 2 == 0 else "failed")
        ids.append(str(row.id))
    return ids


def test_list_pagination_and_filters(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_rows(client, db, user, 5)

    r = client.get(f"{PL}/logs", params={"limit": 2})
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 2
    cursor = r.headers.get("X-Next-Cursor")
    assert cursor is not None
    # Metadata only: no bodies on the wire.
    assert "input_text" not in r.json()["items"][0] and "input_cipher" not in r.json()["items"][0]

    seen = [row["id"] for row in r.json()["items"]]
    r2 = client.get(f"{PL}/logs", params={"limit": 2, "cursor": cursor})
    page2 = [row["id"] for row in r2.json()["items"]]
    assert not set(seen) & set(page2)
    assert r2.headers.get("X-Next-Cursor") is not None

    # Composed filters: status AND q(request_id).
    r3 = client.get(f"{PL}/logs", params={"status": "failed", "q": "req-001"})
    assert r3.status_code == 200
    assert [row["request_id"] for row in r3.json()["items"]] == ["req-001"]
    assert client.get(f"{PL}/logs", params={"status": "bogus"}).status_code == 422

    # from/to bounds.
    first = client.get(f"{PL}/logs", params={"limit": 1}).json()["items"][0]
    r4 = client.get(f"{PL}/logs", params={"to": first["created_at"]})
    assert all(row["id"] != first["id"] for row in r4.json()["items"])


def test_forged_filter_ids_oracle(client: TestClient, db: Session, user_factory,
                                  provider_factory, model_factory) -> None:
    user = user_factory()
    _seed_rows(client, db, user, 1)
    p = provider_factory("PLP")
    m = model_factory(p["id"])
    stranger = _other("pl-stranger@tollma.ai")
    stranger_key = stranger.post("/api/v1/keys", json={"name": "s"}).json()["key"]

    assert client.get(f"{PL}/logs", params={"user_id": stranger_key["id"]}).status_code == 404
    assert client.get(f"{PL}/logs", params={"key_id": stranger_key["id"]}).status_code == 404
    assert client.get(f"{PL}/logs", params={"key_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"{PL}/logs", params={"provider_id": p["id"]}).status_code == 200
    assert client.get(f"{PL}/logs",
                      params={"provider_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"{PL}/logs", params={"model_id": m["id"]}).status_code == 200
    assert client.get(f"{PL}/logs",
                      params={"team_id": str(uuid.uuid4())}).status_code == 404


def test_cross_workspace_detail_oracle(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    ids = _seed_rows(client, db, user, 1)
    stranger = _other("pl-x@tollma.ai")
    assert stranger.get(f"{PL}/logs/{ids[0]}").status_code == 404
    # Org-scoped view of a personal row is also 404.
    oid = _org(client)["id"]
    assert client.get(f"{PL}/logs/{ids[0]}", params={"org_id": oid}).status_code == 404


def test_detail_bodies_personal_owner(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    ids = _seed_rows(client, db, user, 1)
    body = client.get(f"{PL}/logs/{ids[0]}").json()
    assert body["input_text"] == "in-0" and body["content_restricted"] is False


# --- retention -----------------------------------------------------------------


def test_retention_expiry_job(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _enable_personal(client)
    uid = uuid.UUID(user["id"])
    row = capture_engine.capture_post(
        db, input_text="secret-in", output_text="secret-out", user_id=uid,
        endpoint="chat", source="internal", request_id="r-r", status="completed")
    assert row is not None
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(PromptLog.__table__.update().where(
        PromptLog.id == row.id).values(expires_at=past))
    db.commit()

    assert retention_engine.due_count(db) == 1
    assert retention_engine.expire_due_logs(db) == 1
    db.refresh(row)
    assert row.content_expired is True
    assert row.input_cipher is None and row.output_cipher is None
    # Metadata survives expiry.
    assert row.input_chars == 9 and row.request_id == "r-r"
    assert retention_engine.expire_due_logs(db) == 0  # idempotent


def test_retention_info(client: TestClient, user_factory) -> None:
    user_factory()
    body = client.get(f"{PL}/retention").json()
    assert body == {"default_days": 90, "effective_days": 90,
                    "next_run": body["next_run"]}
    _enable_personal(client, retention_days=30)
    assert client.get(f"{PL}/retention").json()["effective_days"] == 30


def test_purge_personal(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    _seed_rows(client, db, user, 2)
    r = client.post(f"{PL}/logs/purge", json={})
    assert r.status_code == 200 and r.json()["expired_count"] == 2
    rows = db.scalars(select(PromptLog)).all()
    assert all(row.content_expired and row.input_cipher is None for row in rows)
    assert all(row.request_id for row in rows)  # metadata kept


# --- org permission matrix -------------------------------------------------------

def _org_seed(client: TestClient, db: Session, user: dict, oid: str) -> str:
    """Org setting ON (full capture) + one org row. Returns the log id."""
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                            "mode": "global", "capture_input": True,
                                            "capture_output": True})
    assert r.status_code == 200, r.text
    uid = uuid.UUID(user["id"])
    key = ApiKey(user_id=uid, org_id=uuid.UUID(oid), name="org-k",
                 key_prefix=f"p-{uuid.uuid4().hex[:8]}",
                 key_hash=uuid.uuid4().hex * 2)
    db.add(key)
    db.commit()
    row = capture_engine.capture_post(
        db, input_text="org-in", output_text="org-out", user_id=uid,
        org_id=uuid.UUID(oid), api_key_id=key.id, key_provenance="organization",
        endpoint="chat_completions", source="external", request_id="org-1",
        status="completed")
    assert row is not None
    return str(row.id)


def _roster(client: TestClient, db: Session, codes: list[str]) -> tuple[TestClient, str]:
    """Root org + member holding exactly `codes`. Returns (member_client, oid)."""
    user_factory_member = None
    member = _other(f"pl-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(client)["id"]
    _invite(client, member, db, oid)
    if codes:
        sid = _set(client, oid, f"S-{uuid.uuid4().hex[:6]}", codes)
        _assign(client, oid, _me(member)["id"], [sid])
    return member, oid


def test_org_read_vs_view_content(client: TestClient, db: Session, user_factory) -> None:
    root = user_factory()
    member, oid = _roster(client, db, ["PromptLogs.Read"])
    log_id = _org_seed(client, db, root, oid)

    assert member.get(f"{PL}/logs", params={"org_id": oid}).status_code == 200
    detail = member.get(f"{PL}/logs/{log_id}", params={"org_id": oid}).json()
    assert detail["content_restricted"] is True
    assert detail["input_text"] is None and detail["input_chars"] == 6

    sid = _set(client, oid, "Viewer", ["PromptLogs.Read", "PromptLogs.ViewContent"])
    _assign(client, oid, _me(member)["id"], [sid])
    detail = member.get(f"{PL}/logs/{log_id}", params={"org_id": oid}).json()
    assert detail["content_restricted"] is False
    assert detail["input_text"] == "org-in" and detail["output_text"] == "org-out"


def test_org_manage_delete_gates(client: TestClient, db: Session, user_factory) -> None:
    root = user_factory()
    member, oid = _roster(client, db, ["PromptLogs.Read", "PromptLogs.ViewContent"])
    log_id = _org_seed(client, db, root, oid)

    assert member.put(f"{PL}/settings",
                      json={"org_id": oid, "enabled": False}).status_code == 404
    assert member.delete(f"{PL}/logs/{log_id}",
                         params={"org_id": oid}).status_code == 404
    assert member.post(f"{PL}/logs/purge", json={},
                       params={"org_id": oid}).status_code == 404

    sid = _set(client, oid, "Deleter", ["PromptLogs.Delete"])
    _assign(client, oid, _me(member)["id"], [sid])
    assert member.delete(f"{PL}/logs/{log_id}",
                         params={"org_id": oid}).status_code == 204
    assert member.get(f"{PL}/logs/{log_id}",
                      params={"org_id": oid}).status_code == 404
    r = member.post(f"{PL}/logs/purge", json={}, params={"org_id": oid})
    assert r.status_code == 200, r.text
    assert db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.purge")) is not None


def test_org_teams_and_retention_gates(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    stranger = _other("pl-g@tollma.ai")
    oid = _org(client)["id"]
    assert stranger.get(f"{PL}/teams", params={"org_id": oid}).status_code == 404
    assert stranger.get(f"{PL}/retention", params={"org_id": oid}).status_code == 404
    assert stranger.get(f"{PL}/logs", params={"org_id": oid}).status_code == 404

    member, moid = _roster(client, db, ["PromptLogs.Read"])
    teams = member.get(f"{PL}/teams", params={"org_id": moid}).json()
    assert teams == []
    assert member.get(f"{PL}/retention", params={"org_id": moid}).json()["effective_days"] == 90
    # Personal teams query is empty (personal workspaces have no teams).
    assert client.get(f"{PL}/teams").json() == []


def test_list_meta_derived_fields(client: TestClient, db: Session, user_factory) -> None:
    """B2: fields/duration_ms/completed_at/key_name ride every metadata row."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    _enable_personal(client)
    key = _mk_key(db, uid)
    capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        api_key_id=key.id, endpoint="chat", source="internal",
        request_id="derived-1", status="completed", latency_ms=1500.0)

    body = client.get(f"{PL}/logs").json()["items"][0]
    assert body["fields"] == ["input", "output"]
    assert body["duration_ms"] == 1500.0
    created = datetime.fromisoformat(body["created_at"])
    completed = datetime.fromisoformat(body["completed_at"])
    assert completed - created == timedelta(milliseconds=1500)
    assert body["key_name"] == key.name

    # Deleted key: the row keeps its metadata, key_name goes null.
    db.delete(key)
    db.commit()
    body = client.get(f"{PL}/logs").json()["items"][0]
    assert body["key_name"] is None
    assert body["fields"] == ["input", "output"]  # ciphers untouched by key delete


def test_list_meta_metadata_only_fields_empty(client: TestClient, db: Session, user_factory) -> None:
    """B2: metadata-only rows (both capture flags off) report no fields."""
    user = user_factory()
    uid = uuid.UUID(user["id"])
    db.add(PromptLoggingSetting(user_id=uid, org_id=None, enabled=True,
                               capture_input=False, capture_output=False))
    db.commit()
    capture_engine.capture_post(
        db, input_text="in", output_text="out", user_id=uid,
        endpoint="chat", source="internal", request_id="derived-2",
        status="completed")
    body = client.get(f"{PL}/logs").json()["items"][0]
    assert body["fields"] == []
    assert body["duration_ms"] is None and body["completed_at"] is None
