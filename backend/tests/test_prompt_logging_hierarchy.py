"""Hierarchical enablement: key inherit/ON/OFF + global mandatory.

Table-E matrix (resolution + capture) + API (key_states, key sub-endpoint
incl. forged-disable 422s, multi-key OR, personal isolation, team
membership irrelevance).

Cases:
 1. global disabled -> no capture (any mode/targets).
 2. global enabled + mode global -> capture global (targets ignored).
 3. keys + listed key + inherit -> capture key.
 4. keys + listed key + explicit False -> no capture (veto wins).
 5. keys + unlisted key + explicit True -> capture key.
 6. keys + unlisted key + inherit -> no capture.
 7. keys + empty targets -> no capture.
 8. team membership never influences logging.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.prompt_logging import (
    PromptLog,
    PromptLoggingKeyOverride,
    PromptLoggingSetting,
)
from tollms.services.prompt_logging import capture as capture_engine
from tollms.services.prompt_logging import resolution as resolution_engine
from tests.test_prompt_logging import (
    _assign,
    _invite,
    _me,
    _mk_key,
    _mk_org_rows,
    _mk_team,
    _org,
    _other,
    _seed_org_setting,
    _set,
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


def _keys_setting(client, db, oid, key_id=None, **kw):
    body = {"org_id": oid, "enabled": True, "mode": "keys", **kw}
    if key_id is not None:
        body["key_ids"] = [str(key_id)]
    r = client.put(f"{PL}/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --- Table-E matrix -----------------------------------------------------------


def test_case1_disabled_never_captures(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
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
    key = _mk_key(db, uid, org.id)
    other = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyOverride(
        setting_id=setting.id, api_key_id=other.id, enabled=False))
    db.commit()
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.match_source == "global" and res.setting is not None
    assert _cap(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                key_provenance="organization").match_source == "global"


def test_case3_listed_key_inherit_captures_key(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id, mode="keys")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=key.id))
    db.commit()  # no override row = inherit; listed key defaults on
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.match_source == "key" and res.setting is not None


def test_case4_key_false_vetoes_listed_key(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id, mode="keys")
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=key.id))
    db.add(PromptLoggingKeyOverride(setting_id=setting.id, api_key_id=key.id, enabled=False))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None
    assert _cap(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                key_provenance="organization") is None


def test_case5_key_true_captures_without_listing(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id, mode="keys")
    key = _mk_key(db, uid, org.id)  # NOT in the key allow-list
    db.add(PromptLoggingKeyOverride(setting_id=setting.id, api_key_id=key.id, enabled=True))
    db.commit()
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                   key_provenance="organization")
    assert res.setting is not None and res.match_source == "key"


def test_case6_unlisted_key_inherit_captures_nothing(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    setting = _seed_org_setting(db, org.id, mode="keys")
    listed = _mk_key(db, uid, org.id)
    key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=listed.id))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None


def test_case7_empty_targets_capture_nothing(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid)
    _seed_org_setting(db, org.id, mode="keys")
    key = _mk_key(db, uid, org.id)
    db.commit()
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key.id,
                    key_provenance="organization").setting is None


def test_case8_team_membership_irrelevant(client: TestClient, db: Session, user_factory) -> None:
    """A caller in a team is NOT logged unless their own key hits: team
    membership never influences logging, even when the setting targets a
    key belonging to a teammate."""
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    user = user_factory()
    uid = _uid(user)
    org, mem, team = _mk_org_team(db, uid)
    _join(db, team, mem)  # caller IS in a team
    setting = _seed_org_setting(db, org.id, mode="keys")
    teammate_key = _mk_key(db, uid, org.id)
    own_key = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=teammate_key.id))
    db.commit()
    # Same team, but the call's key is not targeted: nothing captured.
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=own_key.id,
                    key_provenance="organization").setting is None
    assert _cap(db, user_id=uid, org_id=org.id, api_key_id=own_key.id,
                key_provenance="organization") is None
    # The targeted key captures regardless of any team roster.
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=teammate_key.id,
                   key_provenance="organization")
    assert res.setting is not None and res.match_source == "key"


def test_multi_key_or(client: TestClient, db: Session, user_factory) -> None:
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    user = user_factory()
    uid = _uid(user)
    org, _, _ = _mk_org_team(db, uid, "HA")
    db.commit()
    setting = _seed_org_setting(db, org.id, mode="keys")
    key_a = _mk_key(db, uid, org.id)
    key_b = _mk_key(db, uid, org.id)
    key_c = _mk_key(db, uid, org.id)
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=key_a.id))
    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=key_b.id))
    db.add(PromptLoggingKeyOverride(setting_id=setting.id, api_key_id=key_a.id, enabled=False))
    db.commit()
    # Disabled override on key_a behaves like unlisted; key_b still hits.
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key_a.id,
                    key_provenance="organization").setting is None
    res = _resolve(db, user_id=uid, org_id=org.id, api_key_id=key_b.id,
                   key_provenance="organization")
    assert res.setting is not None and res.match_source == "key"
    assert _resolve(db, user_id=uid, org_id=org.id, api_key_id=key_c.id,
                    key_provenance="organization").setting is None


# --- API: key_states on PUT /settings ------------------------------------------


def test_put_settings_key_states_roundtrip(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    body = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "keys",
        "key_ids": [str(key.id)], "key_states": {str(key.id): False}}).json()
    assert body["key_states"] == {str(key.id): False}
    assert body["effective_summary"]["scope"] == {"keys": 0}
    body = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "keys",
        "key_ids": [str(key.id)], "key_states": {str(key.id): None}}).json()
    assert body["key_states"] == {str(key.id): True}  # null = inherit = default True
    assert db.scalars(select(PromptLoggingKeyOverride)).all() == []  # null deletes the row
    assert body["effective_summary"]["scope"] == {"keys": 1}


def test_forged_disable_while_global_on_422(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    # Mandatory global ON first.
    r = client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                           "mode": "global", "capture_input": True})
    assert r.status_code == 200, r.text
    # Forged weakening is 422, not applied.
    assert client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "global",
        "key_ids": [str(key.id)], "key_states": {str(key.id): False}}).status_code == 422
    # Null (inherit) is not a disable - allowed shape (targets cleared in global).
    assert client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True,
                                              "mode": "global"}).status_code == 200
    # ...and keys mode still allows explicit off.
    r = client.put(f"{PL}/settings", json={
        "org_id": oid, "enabled": True, "mode": "keys",
        "key_ids": [str(key.id)], "key_states": {str(key.id): False}})
    assert r.status_code == 200, r.text


def test_state_endpoints(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    _keys_setting(client, db, oid, key.id)

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
    assert client.put(f"{PL}/settings/keys/{uuid.uuid4()}",
                      params={"org_id": oid}, json={"enabled": False}).status_code == 404
    other = _other(f"hs-{uuid.uuid4().hex[:8]}@tollma.ai")
    soid = _org(other)["id"]
    assert client.put(f"{PL}/settings/keys/{key.id}",
                      params={"org_id": soid}, json={"enabled": False}).status_code == 404


def test_state_endpoints_forged_disable_global_422(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    oid = _org(client)["id"]
    key = _mk_key(db, uid, uuid.UUID(oid))
    db.commit()
    _keys_setting(client, db, oid, key.id)
    client.put(f"{PL}/settings", json={"org_id": oid, "enabled": True, "mode": "global"})
    assert client.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                      json={"enabled": False}).status_code == 422
    # Global mode clears stored targets, so force-on has no listed row left:
    # 404 oracle (nothing to weaken or strengthen).
    assert client.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                      json={"enabled": True}).status_code == 404


def test_state_endpoints_manage_gated(client: TestClient, db: Session, user_factory) -> None:
    user_factory()
    member = _other(f"hm-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(client)["id"]
    _invite(client, member, db, oid)
    key = _mk_key(db, uuid.UUID(_me(member)["id"]), uuid.UUID(oid))
    db.commit()
    _keys_setting(client, db, oid, key.id)
    # No PromptLogs.Manage -> 404 (oracle, not 403).
    assert member.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                      json={"enabled": False}).status_code == 404
    sid = _set(client, oid, "HManage", ["PromptLogs.Manage"])
    _assign(client, oid, _me(member)["id"], [sid])
    assert member.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
                      json={"enabled": False}).status_code == 200


def test_personal_key_isolation_with_overrides(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = _uid(user)
    key = _mk_key(db, uid)
    stranger_key = _mk_key(db, uid)
    db.commit()
    r = client.put(f"{PL}/settings", json={
        "enabled": True, "mode": "keys", "key_ids": [str(key.id)],
        "key_states": {str(key.id): False}})
    assert r.status_code == 200, r.text
    assert r.json()["key_states"] == {str(key.id): False}
    # Same user, same workspace: forced-off key never logs...
    assert _resolve(db, user_id=uid, api_key_id=key.id).setting is None
    # ...unlisted keys never log either; org policy never governs here.
    assert _resolve(db, user_id=uid, api_key_id=stranger_key.id).setting is None
    # Force-on captures.
    client.put(f"{PL}/settings", json={
        "enabled": True, "mode": "keys", "key_ids": [str(key.id)],
        "key_states": {str(key.id): True}})
    res = _resolve(db, user_id=uid, api_key_id=key.id)
    assert res.setting is not None and res.match_source == "key"


def test_key_disabled_drops_capture_api(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    root = _other(f"ho-{uuid.uuid4().hex[:8]}@tollma.ai")
    oid = _org(root)["id"]
    _invite(root, client, db, oid)
    _keys_setting(root, db, oid)
    setting = db.scalar(select(PromptLoggingSetting).where(
        PromptLoggingSetting.org_id == uuid.UUID(oid)))
    key = _mk_key(db, uid, uuid.UUID(oid))
    from tollms.models.prompt_logging import PromptLoggingKeyTarget

    db.add(PromptLoggingKeyTarget(setting_id=setting.id, api_key_id=key.id))
    db.commit()
    assert _resolve(db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
                    key_provenance="organization").match_source == "key"
    root.put(f"{PL}/settings/keys/{key.id}", params={"org_id": oid},
             json={"enabled": False})
    assert _resolve(db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
                    key_provenance="organization").setting is None
    row = _cap(db, user_id=uid, org_id=uuid.UUID(oid), api_key_id=key.id,
               key_provenance="organization")
    assert row is None
    assert db.scalars(select(PromptLog)).all() == []
