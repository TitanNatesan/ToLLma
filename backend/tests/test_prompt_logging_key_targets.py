"""Key-specific prompt log targets + reviewer-fix coverage.

Matrix: global vs teams(team-hit/key-hit) vs disabled; cross-workspace key
404s; stale targets cleared on mode switch; dead-key inertness;
unknown-provenance no-capture; match_source values; audit-in-transaction.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.main import app
from tollms.models.api_key import ApiKey
from tollms.models.organization import AuditLog, Membership, MembershipState
from tollms.models.prompt_logging import (
    PromptLog,
    PromptLoggingKeyTarget,
    PromptLoggingSetting,
    PromptLoggingTeamTarget,
)
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import resolution as resolution_engine
from tests.test_prompt_logging import (
    _assign,
    _enable_personal,
    _invite,
    _join_team,
    _me,
    _mk_key,
    _mk_org_rows,
    _mk_team,
    _org,
    _other,
    _seed_org_setting,
    _set,
    _team,
    PL,
)

ORG = "/api/v1/orgs"


def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["id"])


def _cap(db: Session, **kw) -> PromptLog | None:
    kw.setdefault("input_text", "i")
    kw.setdefault("output_text", "o")
    return capture_engine.capture_post(db, endpoint="chat", source="internal",
                                       request_id=f"r-{uuid.uuid4().hex[:8]}",
                                       status="completed", **kw)


def _org_setup(client: TestClient, db: Session, user_factory):
    """Root org with one member + team; returns (root, member, oid, tid)."""
    root = user_factory()
    member_client = _other(f"kt-{uuid.uuid4().hex[:8]}@tollma.ai")
    member = _me(member_client)
    oid = _org(client)["id"]
    _invite(client, member_client, db, oid)
    tid = _team(client, oid)["id"]
    return root, member_client, member, oid, tid


# --- precedence matrix -----------------------------------------------------


def test_org_precedence_matrix(client: TestClient, db: Session, user_factory) -> None:
    root, member_client, member, oid, tid = _org_setup(client, db, user_factory)
    root_id, mem_id = _uid(root), uuid.UUID(member["id"])
    _join_team(client, oid, tid, member["id"])
    org_key = _mk_key(db, mem_id, uuid.UUID(oid))
    other_key = _mk_key(db, mem_id, uuid.UUID(oid))
    db.commit()

    # teams mode with both legs targeted
    r = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "teams",
        "team_ids": [tid], "key_ids": [str(org_key.id)]})
    assert r.status_code == 200, r.text

    def resolve(**kw):
        return resolution_engine.resolve_setting(
            db, user_id=mem_id, org_id=uuid.UUID(oid), **kw)

    # team hit (target key not used)
    res = resolve(api_key_id=other_key.id, key_provenance="organization")
    assert res.match_source == "team" and res.setting is not None

    # key hit (caller leaves the team)
    from tollms.models.organization import Membership as _M, TeamMembership as _TM
    mem_row = db.scalar(select(_M).where(_M.org_id == uuid.UUID(oid), _M.user_id == mem_id))
    db.execute(_TM.__table__.delete().where(_TM.membership_id == mem_row.id))
    db.commit()
    res = resolve(api_key_id=org_key.id, key_provenance="organization")
    assert res.match_source == "key" and res.team_ids == []
    # neither leg hits
    assert resolve(api_key_id=other_key.id, key_provenance="organization").setting is None

    # disabled beats everything
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": False, "mode": "teams",
                                        "team_ids": [tid], "key_ids": [str(org_key.id)]})
    assert resolve(api_key_id=org_key.id, key_provenance="organization").setting is None

    # global matches with a source tag even with targets stored on disk
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global"})
    sid = db.scalar(select(PromptLoggingSetting.id).where(
        PromptLoggingSetting.org_id == uuid.UUID(oid)))
    db.add(PromptLoggingTeamTarget(setting_id=sid, team_id=uuid.UUID(tid)))
    db.add(PromptLoggingKeyTarget(setting_id=sid, api_key_id=other_key.id))
    db.commit()
    res = resolve(api_key_id=other_key.id, key_provenance="organization")
    assert res.match_source == "global" and res.setting is not None
    row = _cap(db, input_text="i", output_text="o", user_id=mem_id,
               org_id=uuid.UUID(oid), api_key_id=other_key.id,
               key_provenance="organization")
    assert row is not None and row.match_source == "global"


def test_personal_key_matrix(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    key = _mk_key(db, uid)
    stranger_key = _mk_key(db, uid)
    db.commit()

    r = client.put(f"{PL}/settings", json={"enabled": True, "mode": "teams",
                                            "key_ids": [str(key.id)]})
    assert r.status_code == 200, r.text
    assert r.json()["key_ids"] == [str(key.id)]

    row = _cap(db, input_text="i", output_text="o", user_id=uid, api_key_id=key.id)
    assert row is not None and row.match_source == "key"
    assert _cap(db, user_id=uid, api_key_id=stranger_key.id) is None

    client.put(f"{PL}/settings", json={"enabled": True, "mode": "global"})
    row = _cap(db, user_id=uid, api_key_id=stranger_key.id)
    assert row is not None and row.match_source == "global"


# --- cross-workspace key 404s + caps ---------------------------------------


def test_key_workspace_404_oracle(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    oid = _org(client)["id"]
    personal_key = _mk_key(db, uid)
    org_key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()

    # org settings reject personal keys and unknown ids with the same 404
    for bad in (str(personal_key.id), str(uuid.uuid4()), "not-a-uuid"):
        r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                                "mode": "teams", "key_ids": [bad]})
        assert r.status_code == 404, (bad, r.text)
        assert r.json()["error"]["message"] == "prompt log not found"

    # personal settings reject org keys
    r = client.put(f"{PL}/settings", json={"enabled": True, "mode": "teams",
                                            "key_ids": [str(org_key.id)]})
    assert r.status_code == 404
    assert r.json()["error"]["message"] == "prompt log not found"

    # cross-org key rejected
    stranger = _other("kt-x@tollma.ai")
    soid = _org(stranger)["id"]
    skey = _mk_key(db, _uid(_me(stranger)), uuid.UUID(soid))
    db.commit()
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                            "mode": "teams", "key_ids": [str(skey.id)]})
    assert r.status_code == 404

    # caps are 422
    many = [str(uuid.uuid4()) for _ in range(101)]
    assert client.put(f"{PL}/settings", json={"org_id": oid, "mode": "teams",
                                               "key_ids": many}).status_code == 422
    assert client.put(f"{PL}/settings", json={"org_id": oid, "mode": "teams",
                                               "team_ids": many}).status_code == 422


# --- stale targets cleared on mode switch ----------------------------------


def test_mode_switch_clears_targets(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    key = _mk_key(db, uid)
    db.commit()

    r = client.put(f"{PL}/settings", json={"enabled": True, "mode": "teams",
                                            "key_ids": [str(key.id)]})
    assert r.json()["key_ids"] == [str(key.id)]
    r = client.put(f"{PL}/settings", json={"enabled": True, "mode": "global"})
    assert r.status_code == 200, r.text
    assert r.json()["team_ids"] == [] and r.json()["key_ids"] == []
    setting_id = uuid.UUID(r.json()["id"])
    assert db.scalars(select(PromptLoggingKeyTarget).where(
        PromptLoggingKeyTarget.setting_id == setting_id)).all() == []


# --- dead/disabled keys -----------------------------------------------------


def test_dead_key_target_inert(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    dead = _mk_key(db, uid)
    off = _mk_key(db, uid)
    off.enabled = False  # disabled (not deleted): auth would fail upstream,
    db.commit()          # but the ledger checks deletion only -> still live.

    client.put(f"{PL}/settings", json={"enabled": True, "mode": "teams",
                                        "key_ids": [str(dead.id), str(off.id)]})
    dead.is_deleted = True
    db.commit()
    assert _cap(db, user_id=uid, api_key_id=dead.id) is None
    row = _cap(db, user_id=uid, api_key_id=off.id)
    assert row is not None and row.match_source == "key"


# --- unknown provenance + status fallback -----------------------------------


def test_unknown_provenance_no_capture(client: TestClient, db: Session, user_factory,
                                       monkeypatch) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    key = _mk_key(db, uid)
    db.commit()

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(type(db), "get", boom)
    resolved = resolution_engine.resolve_setting(
        db, user_id=uid, api_key_id=key.id, key_provenance="organization")
    assert resolved.setting is None
    monkeypatch.undo()
    assert _cap(db, user_id=uid, api_key_id=key.id) is not None


def test_capture_status_fallback(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    row = capture_engine.capture_post(
        db, input_text="i", output_text="o", user_id=uid,
        endpoint="chat", source="internal", request_id="r-fb", status="weird-state")
    assert row is not None and row.status == "failed"


# --- match_source values + legacy null --------------------------------------


def test_match_source_values_and_legacy_null(client: TestClient, db: Session,
                                            user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    _enable_personal(client)
    row = _cap(db, user_id=uid)
    assert row is not None and row.match_source == "global"

    legacy = PromptLog(workspace_type="personal", user_id=uid, org_id=None,
                       key_provenance="personal", team_ids=[], endpoint="chat",
                       source="internal", status="completed",
                       expires_at=datetime.now(timezone.utc) + timedelta(days=90))
    db.add(legacy)
    db.commit()
    got = {r["id"]: r.get("match_source") for r in
           client.get(f"{PL}/logs").json()["items"]}
    assert got[str(row.id)] == "global"
    assert got[str(legacy.id)] is None


# --- audit in the committing transaction -------------------------------------


def test_settings_audit_failure_rolls_back(client: TestClient, db: Session,
                                           user_factory, monkeypatch) -> None:
    user_factory()
    oid = _org(client)["id"]

    import tollms.api.prompt_logging.settings as settings_mod

    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr(settings_mod, "_audit", boom)
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True})
    assert r.status_code == 500, r.text
    assert db.scalar(select(PromptLoggingSetting).where(
        PromptLoggingSetting.org_id == uuid.UUID(oid))) is None


def test_delete_audit_failure_rolls_back(client: TestClient, db: Session,
                                         user_factory, monkeypatch) -> None:
    from tests.test_prompt_logging import _org_seed

    root = user_factory()
    oid = _org(client)["id"]
    log_id = _org_seed(client, db, root, oid)

    import tollms.api.prompt_logging.records as records_mod

    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr(records_mod, "_audit", boom)
    r = client.delete(f"{PL}/logs/{log_id}", params={"org_id": oid})
    assert r.status_code == 500, r.text
    assert db.get(PromptLog, uuid.UUID(log_id)) is not None


def test_purge_audit_failure_rolls_back(client: TestClient, db: Session,
                                        user_factory, monkeypatch) -> None:
    from tests.test_prompt_logging import _org_seed

    root = user_factory()
    oid = _org(client)["id"]
    _org_seed(client, db, root, oid)

    import tollms.api.prompt_logging.records as records_mod

    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr(records_mod, "_audit", boom)
    r = client.post(f"{PL}/logs/purge", json={}, params={"org_id": oid})
    assert r.status_code == 500, r.text
    rows = db.scalars(select(PromptLog).where(
        PromptLog.org_id == uuid.UUID(oid))).all()
    assert rows and all(not row.content_expired for row in rows)


def test_org_delete_and_purge_audit_committed(client: TestClient, db: Session,
                                              user_factory) -> None:
    from tests.test_prompt_logging import _org_seed

    root = user_factory()
    oid = _org(client)["id"]
    log_id = _org_seed(client, db, root, oid)
    assert client.delete(f"{PL}/logs/{log_id}", params={"org_id": oid}).status_code == 204
    assert db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.log.delete")) is not None
    r = client.post(f"{PL}/logs/purge", json={}, params={"org_id": oid})
    assert r.status_code == 200, r.text
    assert db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid),
        AuditLog.action == "prompt_logs.purge")) is not None


# --- ACTIVE-only member filter + param guards --------------------------------


def test_suspended_member_filter_404(client: TestClient, db: Session,
                                     user_factory) -> None:
    root, member_client, member, oid, tid = _org_setup(client, db, user_factory)
    from tests.test_prompt_logging import _org_seed

    _org_seed(client, db, root, oid)
    mem = db.scalar(select(Membership).where(
        Membership.org_id == uuid.UUID(oid),
        Membership.user_id == uuid.UUID(member["id"])))
    assert mem is not None and mem.state == MembershipState.ACTIVE.value
    mem.state = "suspended"
    db.commit()
    r = member_client.get(f"{PL}/logs", params={"org_id": oid, "user_id": member["id"]})
    assert r.status_code == 404


def test_from_to_length_and_parse_truncation(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.get(f"{PL}/logs", params={"from": "x" * 65}).status_code == 422
    assert client.get(f"{PL}/logs", params={"to": "x" * 65}).status_code == 422

    from tollms.api.orgs.common.guards import _parse_time

    with pytest.raises(Exception) as exc:
        _parse_time("z" * 200, "from")
    assert "z" * 200 not in str(exc.value)
    assert "z" * 64 in str(exc.value)
