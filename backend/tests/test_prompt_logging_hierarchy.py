"""Hierarchical enablement: team ON/OFF + key inherit/ON/OFF + global mandatory.

Table-E matrix (resolution + capture) + API (team_states/key_states,
sub-endpoints incl. forged-disable 422s, multi-team OR, personal isolation).

Cases:
 1. global disabled -> no capture (any mode/targets).
 2. global enabled + mode global -> capture global (targets ignored).
 3. teams + enabled team hit + key inherit -> capture team.
 4. teams + team hit + key explicit False -> no capture (veto wins).
 5. teams + no team hit + key explicit True -> capture key.
 6. teams + no team hit + key inherit listed -> capture key.
 7. teams + no team hit + key inherit unlisted -> no capture.
 8. teams + empty/disabled-all targets -> no capture.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.prompt_logging import (
    PromptLog,
    PromptLoggingKeyOverride,
    PromptLoggingSetting,
    PromptLoggingTeamTarget,
)
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import resolution as resolution_engine
from tests.test_prompt_logging import (
    _assign,
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


def _uid(user: dict):
    return uuid.UUID(user["id"])


def _resolve(db, **kw):
    return resolution_engine.resolve_setting(db, **kw)


def _mk_org_team(db, owner_id, name="H"):
    from tollms.models.organization import Membership

    org, mem = _mk_org_rows(db, owner_id, name)
    team = _mk_team(db, org.id)
    return org, mem, team


def _join(db, team, mem) -> None:
    from tollms.models.organization import TeamMembership

    db.add(TeamMembership(team_id=team.id, membership_id=mem.id))
    db.commit()


def _cap(db, **kw):
    kw.setdefault("input_text", "i")
    kw.setdefault("output_text", "o")
    kw.setdefault("endpoint", "chat")
    kw.setdefault("source", "internal")
    kw.setdefault("request_id", f"h-{uuid.uuid4().hex[:8]}")
    kw.setdefault("status", "completed")
    return capture_engine.capture_post(db, **kw)


def _teams_setting(client, db, oid, tid, key_id=None, **kw):
    body = {"org_id": oid, "enabled": True, "mode": "teams",
            "team_ids": [tid], **kw}
    if key_id is not None:
        body["key_ids"] = [str(key_id)]
    r = client.put(f"{PL}/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --- Table-E matrix -----------------------------------------------------------


def test_case1_disabled_never_captures(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, mem, team = _mk_org_team(db, uid)
    _join(db, team, mem)
    key = _mk_key(db, uid, org.id)
    db.commit()
    db.add(PromptLoggingSetting(org_id=org.id, user_id=None, enabled=False,
                                mode="global", capture_input=True, capture_output=True))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None
    assert _cap(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                key_provenance="organization") is None


def test_case2_global_captures_despite_targets(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id)  # global ON
    team = _mk_team(db, org.id)
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id, enabled=False))
    db.commit()
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.match_source == "global" and res.setting is not None
    assert _cap(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                key_provenance="organization").match_source == "global"


def test_case3_team_hit_inherit_captures_team(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, mem, team = _mk_org_team(db, uid)
    _join(db, team, mem)
    setting = _seed_org_setting(db, org.id, mode="teams")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id))
    db.commit()  # no override row = inherit; key unlisted
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.match_source == "team" and res.team_ids == [str(team.id)]


def test_case4_key_false_vetoes_team_hit(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, mem, team = _mk_org_team(db, uid)
    _join(db, team, mem)
    setting = _seed_org_setting(db, org.id, mode="teams")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id))
    db.add(PromptLoggingKeyOverride(setting_id=setting.id, api_key_id=key.id, enabled=False))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None
    assert _cap(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                key_provenance="organization") is None


def test_case5_key_true_captures_without_team(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, _, team = _mk_org_team(db, uid)  # caller NOT in the team
    setting = _seed_org_setting(db, org.id, mode="teams")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id))
    db.add(PromptLoggingKeyOverride(setting_id=setting.id, api_key_id=key.id, enabled=True))
    db.commit()
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.setting is not None and res.match_source == "key"


def test_case6_listed_key_inherit_captures(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id, mode="teams")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=key.id))
    db.commit()  # absent override = default True
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.setting is not None and res.match_source == "key"


def test_case7_unlisted_key_inherit_captures_nothing(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, _, team = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id, mode="teams")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None


def test_case8_empty_and_all_disabled_capture_nothing(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, mem, team = _mk_org_team(db, uid)
    _join(db, team, mem)
    setting = _seed_org_setting(db, org.id, mode="teams")
    key = _mk_key(db, uid, org.id)
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None
    # All-disabled targets behave like empty.
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team.id, enabled=False))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None


def test_multi_team_or(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, mem, team_a = _mk_org_team(db, uid, "HA")
    team_b = _mk_team(db, org.id, "HB")
    db.commit()
    setting = _seed_org_setting(db, org.id, mode="teams")
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team_a.id, enabled=False))
    db.add(PromptLoggingTeamTarget(setting_id=setting.id, team_id=team_b.id))
    _join(db, team_a, mem)  # member of the DISABLED team only
    _join(db, team_b, mem)  # ...and the enabled one
    res = _resolve(db, user_id=uid, org_id=org.id, key_provenance="organization")
    assert res.setting is not None and res.team_ids == [str(team_b.id)]


# --- API: team_states/key_states on PUT /settings -------------------------------


def test_put_settings_states_roundtrip(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    oid = _org(client)["id"]
    tid = _team(client, oid)["id"]
    body = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "teams",
        "team_ids": [tid], "team_states": {tid: False}}).json()
    assert body["team_states"] == {tid: False}
    assert body["key_states"] == {}
    assert body["effective_summary"]["scope"] == {"teams": 0}

    # absent entry = default True
    body = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "teams",
        "team_ids": [tid]}).json()
    assert body["team_states"] == {tid: True}


def test_put_settings_key_states_roundtrip(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    body = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "teams",
        "key_ids": [str(key.id)], "key_states": {str(key.id): False}}).json()
    assert body["key_states"] == {str(key.id): False}
    body = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "teams",
        "key_ids": [str(key.id)], "key_states": {str(key.id): None}}).json()
    assert body["key_states"] == {str(key.id): True}  # null = inherit = default True
    assert db.scalars(select(PromptLoggingKeyOverride)).all() == []  # null deletes the row
    assert body["effective_summary"]["scope"] == {"teams": 0, "keys": 1}


def test_forged_disable_while_global_on_422(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    tid = _team(client, oid)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    # Mandatory global ON first.
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "global", "capture_input": True})
    assert r.status_code == 200, r.text
    # Forged weakenings are 422, not applied.
    assert client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "global",
        "team_ids": [tid], "team_states": {tid: False}}).status_code == 422
    assert client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "global",
        "key_ids": [str(key.id)], "key_states": {str(key.id): False}}).status_code == 422
    # Null (inherit) is not a disable — allowed shape (targets cleared in global).
    assert client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                              "mode": "global"}).status_code == 200
    # ...and teams mode still allows explicit off.
    r = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "teams",
        "team_ids": [tid], "team_states": {tid: False}})
    assert r.status_code == 200, r.text


def test_state_endpoints(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    tid = _team(client, oid)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    _teams_setting(client, db, oid, tid, key.id)

    r = client.put(f"{PL}/settings/teams/{tid}", params={"org_id": oid},
                   json={"enabled": False})
    assert r.status_code == 200, r.text
    assert r.json()["team_states"] == {tid: False}

    r = client.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                   json={"enabled": False})
    assert r.status_code == 200, r.text
    assert r.json()["key_states"] == {str(key.id): False}

    # null resets to inherit (deletes the row).
    r = client.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                   json={"enabled": None})
    assert r.status_code == 200, r.text
    assert r.json()["key_states"] == {str(key.id): True}
    assert db.scalars(select(PromptLoggingKeyOverride)).all() == []

    # Unknown / cross-workspace ids are 404 oracles.
    assert client.put(f"{PL}/settings/teams/{uuid.uuid4()}",
                      params={"org_id": oid}, json={"enabled": False}).status_code == 404
    other = _other(f"hs-{uuid.uuid4().hex[:8]}@tollma.ai")
    soid = _org(other)["id"]
    assert client.put(f"{PL}/settings/teams/{tid}",
                      params={"org_id": soid}, json={"enabled": False}).status_code == 404
    assert client.put(f"{PL}/settings/keys/{uuid.uuid4()}",
                      params={"org_id": oid}, json={"enabled": False}).status_code == 404
    # Personal workspace has no teams.
    assert client.put(f"{PL}/settings/teams/{tid}",
                      json={"enabled": False}).status_code == 404


def test_state_endpoints_forged_disable_global_422(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    tid = _team(client, oid)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    _teams_setting(client, db, oid, tid, key.id)
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global"})
    assert client.put(f"{PL}/settings/teams/{tid}", params={"org_id": oid},
                      json={"enabled": False}).status_code == 422
    assert client.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                      json={"enabled": False}).status_code == 422
    # Global mode clears stored targets, so force-on has no listed row left:
    # 404 oracle (nothing to weaken or strengthen).
    assert client.put(f"{PL}/settings/teams/{tid}", params={"org_id": oid},
                      json={"enabled": True}).status_code == 404


def test_state_endpoints_manage_gated(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    member = _other(f"hm-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(client)["id"]
    _invite(client, member, db, oid)
    tid = _team(client, oid)["id"]
    _teams_setting(client, db, oid, tid)
    # No PromptLogs.Manage -> 404 (oracle, not 403).
    assert member.put(f"{PL}/settings/teams/{tid}", params={"org_id": oid},
                      json={"enabled": False}).status_code == 404
    sid = _set(client, oid, "HManage", ["PromptLogs.Manage"])
    _assign(client, oid, _me(member)["id"], [sid])
    assert member.put(f"{PL}/settings/teams/{tid}", params={"org_id": oid},
                      json={"enabled": True}).status_code == 200


def test_personal_key_isolation_with_overrides(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    key = _mk_key(db, uid)
    stranger_key = _mk_key(db, uid)
    db.commit()
    r = client.put(f"{PL}/settings", json={
        "enabled": True, "mode": "teams", "key_ids": [str(key.id)],
        "key_states": {str(key.id): False}})
    assert r.status_code == 200, r.text
    assert r.json()["key_states"] == {str(key.id): False}
    # Same user, same workspace: forced-off key never logs...
    assert _resolve(db, user_id=uid, api_key_id=key.id).setting is None
    # ...unlisted keys never log either; org policy never governs here.
    assert _resolve(db, user_id=uid, api_key_id=stranger_key.id).setting is None
    # Force-on captures.
    client.put(f"{PL}/settings", json={
        "enabled": True, "mode": "teams", "key_ids": [str(key.id)],
        "key_states": {str(key.id): True}})
    res = _resolve(db, user_id=uid, api_key_id=key.id)
    assert res.setting is not None and res.match_source == "key"


def test_team_disabled_drops_capture_api(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    root = _other(f"ho-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(root)["id"]
    _invite(root, client, db, oid)
    tid = _team(root, oid)["id"]
    _join_team(root, oid, tid, user["id"])
    _teams_setting(root, db, oid, tid)
    setting = db.scalar(select(PromptLoggingSetting).where(
        PromptLoggingSetting.org_id == uuid.UUID(oid)))
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
                    key_provenance="organization").match_source == "team"
    root.put(f"{PL}/settings/teams/{tid}", params={"org_id": oid},
             json={"enabled": False})
    assert _resolve(db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
                    key_provenance="organization").setting is None
    row = _cap(db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
               key_provenance="organization")
    assert row is None
    assert db.scalars(select(PromptLog)).all() == []
