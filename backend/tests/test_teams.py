"""Org teams tests: CRUD, roster, team-set assignment, effective-permission
union, escalation guards, system-set write rejection, suspend/leave/remove
cascades, root protection, audit events, 404-oracle isolation."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tollms.main import app
from tollms.models.organization import Invitation, Membership, TeamMembership
from tollms.models.user import User

ORG = "/api/v1/orgs"


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"team-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "Team Org") -> dict:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _email_of(c: TestClient) -> str:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()["email"]


def _user_id(db, email: str) -> str:
    return str(db.execute(select(User.id).where(func.lower(User.email) == email.lower())).scalar_one())


def _token(db, invitation_id: str) -> str:
    inv = db.get(Invitation, uuid.UUID(invitation_id))
    db.refresh(inv)
    return inv.token


def _invite_and_accept(root_client: TestClient, member_client: TestClient, db,
                       oid: str, set_ids: list[str]) -> None:
    inv = root_client.post(f"{ORG}/{oid}/invitations",
                           json={"email": _email_of(member_client), "set_ids": set_ids})
    assert inv.status_code == 201, inv.text
    acc = member_client.post(f"{ORG}/invitations/by-token/{_token(db, inv.json()['id'])}/accept")
    assert acc.status_code == 200, acc.text


def _mkset(c: TestClient, oid: str, name: str, permissions: list[str]) -> dict:
    r = c.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": permissions})
    assert r.status_code == 201, r.text
    return r.json()


def _mkteam(c: TestClient, oid: str, name: str = "Eng", set_ids: list[str] | None = None,
            description: str | None = None) -> dict:
    body: dict = {"name": name, "set_ids": set_ids or []}
    if description is not None:
        body["description"] = description
    r = c.post(f"{ORG}/{oid}/teams", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _perms(c: TestClient, oid: str) -> list[str]:
    r = c.get(f"{ORG}/{oid}")
    assert r.status_code == 200, r.text
    return sorted(r.json()["permissions"])


def _system_set_id(c: TestClient, oid: str, name: str) -> str:
    sets = c.get(f"{ORG}/{oid}/sets").json()
    return next(s["id"] for s in sets if s["name"] == name)


def test_team_crud_happy(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    s = _mkset(client, oid, "Usage", ["Analytics.ViewUsage"])

    team = _mkteam(client, oid, "Eng", [s["id"]], description="Backend folks")
    assert team["name"] == "Eng"
    assert team["description"] == "Backend folks"
    assert team["codes"] == ["Analytics.ViewUsage"]
    assert team["member_count"] == 0 and team["members"] == []
    assert [x["name"] for x in team["sets"]] == ["Usage"]

    listed = client.get(f"{ORG}/{oid}/teams")
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1
    assert listed.json()[0]["member_count"] == 0
    assert listed.json()[0]["codes"] == ["Analytics.ViewUsage"]

    detail = client.get(f"{ORG}/{oid}/teams/{team['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["sets"][0]["codes"] == ["Analytics.ViewUsage"]

    upd = client.patch(f"{ORG}/{oid}/teams/{team['id']}",
                       json={"name": "Platform", "description": "New"})
    assert upd.status_code == 200, upd.text
    assert upd.json()["name"] == "Platform" and upd.json()["description"] == "New"

    assert client.delete(f"{ORG}/{oid}/teams/{team['id']}").status_code == 204
    assert client.get(f"{ORG}/{oid}/teams/{team['id']}").status_code == 404
    assert client.get(f"{ORG}/{oid}/teams").json() == []


def test_team_duplicate_name_409(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    _mkteam(client, oid, "Eng")
    assert client.post(f"{ORG}/{oid}/teams", json={"name": "Eng"}).status_code == 409
    assert client.post(f"{ORG}/{oid}/teams", json={"name": "eng"}).status_code == 409
    assert client.post(f"{ORG}/{oid}/teams", json={"name": "   "}).status_code == 422
    assert client.post(f"{ORG}/{oid}/teams", json={"set_ids": []}).status_code == 422
    other = _mkteam(client, oid, "Design")
    assert client.patch(f"{ORG}/{oid}/teams/{other['id']}",
                        json={"name": "ENG"}).status_code == 409


def test_team_cross_org_404_oracle(client: TestClient, db, user_factory) -> None:
    user_factory()
    org_a = _mkorg(client, name="Org A")
    team_a = _mkteam(client, org_a["id"], "A-Team")

    other = _mkuser("other")
    org_b = _mkorg(other, name="Org B")
    stranger = _mkuser("stranger")
    stranger_uid = _user_id(db, _email_of(stranger))

    # Stranger to A: every team endpoint is 404 (never 403).
    paths = [
        ("get", f"{ORG}/{org_a['id']}/teams", None),
        ("get", f"{ORG}/{org_a['id']}/teams/{team_a['id']}", None),
        ("post", f"{ORG}/{org_a['id']}/teams", {"name": "X"}),
        ("patch", f"{ORG}/{org_a['id']}/teams/{team_a['id']}", {"name": "X"}),
        ("delete", f"{ORG}/{org_a['id']}/teams/{team_a['id']}", None),
        ("post", f"{ORG}/{org_a['id']}/teams/{team_a['id']}/members",
         {"user_id": stranger_uid}),
        ("delete", f"{ORG}/{org_a['id']}/teams/{team_a['id']}/members/{stranger_uid}", None),
        ("put", f"{ORG}/{org_a['id']}/teams/{team_a['id']}/sets", {"set_ids": []}),
    ]
    for method, path, body in paths:
        r = getattr(stranger, method)(path, json=body) if body is not None \
            else getattr(stranger, method)(path)
        assert r.status_code == 404, (method, path, r.status_code, r.text)

    # Member of B reaching into A by id: same 404 oracle.
    assert other.get(f"{ORG}/{org_a['id']}/teams/{team_a['id']}").status_code == 404
    assert other.patch(f"{ORG}/{org_a['id']}/teams/{team_a['id']}",
                       json={"name": "Hijack"}).status_code == 404
    assert other.delete(f"{ORG}/{org_a['id']}/teams/{team_a['id']}").status_code == 404
    assert other.put(f"{ORG}/{org_a['id']}/teams/{team_a['id']}/sets",
                     json={"set_ids": []}).status_code == 404
    assert other.post(f"{ORG}/{org_a['id']}/teams/{team_a['id']}/members",
                      json={"user_id": stranger_uid}).status_code == 404
    assert other.delete(
        f"{ORG}/{org_a['id']}/teams/{team_a['id']}/members/{stranger_uid}").status_code == 404
    # Sanity: B's own namespace still works.
    assert other.post(f"{ORG}/{org_b['id']}/teams", json={"name": "B-Team"}).status_code == 201


def test_team_add_remove_members(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    bob, cara = _mkuser("bob"), _mkuser("cara")
    _invite_and_accept(client, bob, db, oid, [])
    _invite_and_accept(client, cara, db, oid, [])
    bob_uid, cara_uid = _user_id(db, _email_of(bob)), _user_id(db, _email_of(cara))
    team = _mkteam(client, oid, "Eng")
    tid = team["id"]

    added = client.post(f"{ORG}/{oid}/teams/{tid}/members", json={"user_id": bob_uid})
    assert added.status_code == 200, added.text
    assert added.json()["member_count"] == 1
    row = added.json()["members"][0]
    assert row["user_id"] == bob_uid and row["state"] == "active"
    assert row["email"] == _email_of(bob) and row["membership_id"]

    # Duplicate add is 409; adding a non-member is 404.
    assert client.post(f"{ORG}/{oid}/teams/{tid}/members",
                      json={"user_id": bob_uid}).status_code == 409
    dave = _mkuser("dave")
    assert client.post(f"{ORG}/{oid}/teams/{tid}/members",
                      json={"user_id": _user_id(db, _email_of(dave))}).status_code == 404

    # Multi-team membership: bob joins a second team too.
    team2 = _mkteam(client, oid, "Design")
    assert client.post(f"{ORG}/{oid}/teams/{team2['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200
    assert client.post(f"{ORG}/{oid}/teams/{tid}/members",
                      json={"user_id": cara_uid}).status_code == 200
    assert client.get(f"{ORG}/{oid}/teams/{tid}").json()["member_count"] == 2

    assert client.delete(f"{ORG}/{oid}/teams/{tid}/members/{bob_uid}").status_code == 204
    assert client.delete(f"{ORG}/{oid}/teams/{tid}/members/{bob_uid}").status_code == 404
    assert client.delete(f"{ORG}/{oid}/teams/{tid}/members/{cara_uid}").status_code == 204
    assert client.get(f"{ORG}/{oid}/teams/{tid}").json()["members"] == []
    # Bob's other team membership is untouched.
    assert len(client.get(f"{ORG}/{oid}/teams/{team2['id']}").json()["members"]) == 1


def test_effective_union_direct_plus_teams(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    sa = _mkset(client, oid, "Direct", ["Analytics.ViewUsage"])
    sb = _mkset(client, oid, "TeamOne", ["Members.Read"])
    sc = _mkset(client, oid, "TeamTwo", ["Members.Read", "Analytics.ViewUsage"])
    bob = _mkuser("union")
    _invite_and_accept(client, bob, db, oid, [])
    bob_uid = _user_id(db, _email_of(bob))

    assert client.post(f"{ORG}/{oid}/members/{bob_uid}/sets",
                      json={"set_ids": [sa["id"]]}).status_code == 200
    t1 = _mkteam(client, oid, "T1", [sb["id"]])
    t2 = _mkteam(client, oid, "T2", [sc["id"]])
    assert client.post(f"{ORG}/{oid}/teams/{t1['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200
    assert client.post(f"{ORG}/{oid}/teams/{t2['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200

    # Deduped union of direct + both teams.
    assert _perms(bob, oid) == ["Analytics.ViewUsage", "Members.Read"]
    members = {m["email"]: m for m in client.get(f"{ORG}/{oid}/members").json()}
    mine = members[_email_of(bob)]
    assert sorted(mine["permissions"]) == ["Analytics.ViewUsage", "Members.Read"]
    assert mine["permission_sets"] == ["Direct"]


def test_suspend_empties_team_leg_and_resume_restores(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    sa = _mkset(client, oid, "Direct", ["Analytics.ViewUsage"])
    sb = _mkset(client, oid, "TeamSet", ["Members.Read"])
    bob = _mkuser("susp")
    _invite_and_accept(client, bob, db, oid, [])
    bob_uid = _user_id(db, _email_of(bob))
    assert client.post(f"{ORG}/{oid}/members/{bob_uid}/sets",
                      json={"set_ids": [sa["id"]]}).status_code == 200
    team = _mkteam(client, oid, "Eng", [sb["id"]])
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200
    assert _perms(bob, oid) == ["Analytics.ViewUsage", "Members.Read"]

    susp = client.post(f"{ORG}/{oid}/members/{bob_uid}/suspend")
    assert susp.status_code == 200, susp.text
    assert susp.json()["permissions"] == []
    assert bob.get(f"{ORG}/{oid}").status_code == 404
    # Roster row survives suspend (state visible in detail).
    detail = client.get(f"{ORG}/{oid}/teams/{team['id']}").json()
    assert [m["user_id"] for m in detail["members"]] == [bob_uid]
    assert detail["members"][0]["state"] == "suspended"

    resumed = client.post(f"{ORG}/{oid}/members/{bob_uid}/resume")
    assert resumed.status_code == 200, resumed.text
    assert sorted(resumed.json()["permissions"]) == ["Analytics.ViewUsage", "Members.Read"]
    assert _perms(bob, oid) == ["Analytics.ViewUsage", "Members.Read"]


def test_escalation_matrix(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    low = _mkset(client, oid, "Low", ["Analytics.ViewUsage"])
    high = _mkset(client, oid, "High", ["Members.Invite"])
    lead_set = _mkset(client, oid, "Lead", ["Teams.Create", "Teams.Read", "Teams.Update",
                                           "Teams.AssignMembers", "Teams.AssignPermissionSets",
                                           "Analytics.ViewUsage"])
    lead = _mkuser("lead")
    _invite_and_accept(client, lead, db, oid, [lead_set["id"]])

    # Creator WITHOUT code X cannot grant X via a team (404 oracle)...
    assert lead.post(f"{ORG}/{oid}/teams",
                     json={"name": "Coup", "set_ids": [high["id"]]}).status_code == 404
    # ...but WITH X they can.
    own = lead.post(f"{ORG}/{oid}/teams", json={"name": "Helpers", "set_ids": [low["id"]]})
    assert own.status_code == 201, own.text

    priv = _mkteam(client, oid, "Priv", [high["id"]])
    member = _mkuser("pawn")
    _invite_and_accept(client, member, db, oid, [])
    member_uid = _user_id(db, _email_of(member))
    # Adding someone to a team whose codes exceed your own is denied...
    assert lead.post(f"{ORG}/{oid}/teams/{priv['id']}/members",
                     json={"user_id": member_uid}).status_code == 404
    # ...as is widening your own team's sets beyond what you hold...
    assert lead.put(f"{ORG}/{oid}/teams/{own.json()['id']}/sets",
                    json={"set_ids": [high["id"]]}).status_code == 404
    # ...while in-scope operations succeed...
    assert lead.put(f"{ORG}/{oid}/teams/{own.json()['id']}/sets",
                    json={"set_ids": [low["id"]]}).status_code == 200
    assert lead.post(f"{ORG}/{oid}/teams/{own.json()['id']}/members",
                     json={"user_id": member_uid}).status_code == 200
    # ...and root (full catalog) is exempt.
    assert client.post(f"{ORG}/{oid}/teams/{priv['id']}/members",
                      json={"user_id": member_uid}).status_code == 200


def test_system_set_in_write_rejected(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    owner_id = _system_set_id(client, oid, "Owner")
    member_id = _system_set_id(client, oid, "Member")

    assert client.post(f"{ORG}/{oid}/teams",
                      json={"name": "Sys", "set_ids": [owner_id]}).status_code == 422
    team = _mkteam(client, oid, "Eng")
    assert client.put(f"{ORG}/{oid}/teams/{team['id']}/sets",
                      json={"set_ids": [member_id]}).status_code == 422
    assert client.get(f"{ORG}/{oid}/teams/{team['id']}").json()["codes"] == []


def test_put_sets_replace_all(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    sa = _mkset(client, oid, "SetA", ["Analytics.ViewUsage"])
    sb = _mkset(client, oid, "SetB", ["Members.Read"])
    team = _mkteam(client, oid, "Eng", [sa["id"]])
    assert team["codes"] == ["Analytics.ViewUsage"]

    replaced = client.put(f"{ORG}/{oid}/teams/{team['id']}/sets", json={"set_ids": [sb["id"]]})
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["codes"] == ["Members.Read"]
    assert [s["name"] for s in replaced.json()["sets"]] == ["SetB"]

    cleared = client.put(f"{ORG}/{oid}/teams/{team['id']}/sets", json={"set_ids": []})
    assert cleared.status_code == 200 and cleared.json()["codes"] == []


def test_delete_team_preserves_users_and_kills_leg(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    sa = _mkset(client, oid, "Direct", ["Analytics.ViewUsage"])
    sb = _mkset(client, oid, "TeamSet", ["Members.Read"])
    bob = _mkuser("gone")
    _invite_and_accept(client, bob, db, oid, [])
    bob_uid = _user_id(db, _email_of(bob))
    assert client.post(f"{ORG}/{oid}/members/{bob_uid}/sets",
                      json={"set_ids": [sa["id"]]}).status_code == 200
    team = _mkteam(client, oid, "Eng", [sb["id"]])
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200
    assert _perms(bob, oid) == ["Analytics.ViewUsage", "Members.Read"]

    assert client.delete(f"{ORG}/{oid}/teams/{team['id']}").status_code == 204
    # Membership, user, and direct grants survive; only the team leg is gone.
    members = {m["email"]: m for m in client.get(f"{ORG}/{oid}/members").json()}
    assert members[_email_of(bob)]["state"] == "active"
    assert _perms(bob, oid) == ["Analytics.ViewUsage"]
    assert bob.get("/auth/me").status_code == 200
    # The orphaned set is now deletable (no dangling team reference).
    assert client.delete(f"{ORG}/{oid}/sets/{sb['id']}").status_code == 204


def test_audit_rows_present(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    s = _mkset(client, oid, "SetS", ["Analytics.ViewUsage"])
    bob = _mkuser("aud")
    _invite_and_accept(client, bob, db, oid, [])
    bob_uid = _user_id(db, _email_of(bob))

    team = _mkteam(client, oid, "Eng", [s["id"]])
    tid = team["id"]
    assert client.patch(f"{ORG}/{oid}/teams/{tid}", json={"description": "d"}).status_code == 200
    assert client.put(f"{ORG}/{oid}/teams/{tid}/sets",
                     json={"set_ids": [s["id"]]}).status_code == 200
    assert client.post(f"{ORG}/{oid}/teams/{tid}/members",
                      json={"user_id": bob_uid}).status_code == 200
    assert client.delete(f"{ORG}/{oid}/teams/{tid}/members/{bob_uid}").status_code == 204
    assert client.delete(f"{ORG}/{oid}/teams/{tid}").status_code == 204

    actions = {a["action"] for a in client.get(f"{ORG}/{oid}/audit").json()}
    assert {"team.created", "team.updated", "team.sets_assigned", "team.member_added",
            "team.member_removed", "team.deleted"} <= actions


def test_leave_drops_team_memberships(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    bob = _mkuser("leaver")
    _invite_and_accept(client, bob, db, oid, [])
    bob_uid = _user_id(db, _email_of(bob))
    team = _mkteam(client, oid, "Eng")
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200

    assert bob.post(f"{ORG}/{oid}/leave").status_code == 204
    detail = client.get(f"{ORG}/{oid}/teams/{team['id']}").json()
    assert detail["members"] == [] and detail["member_count"] == 0
    mem = db.execute(
        select(Membership).where(Membership.org_id == uuid.UUID(oid),
                                 Membership.user_id == uuid.UUID(bob_uid))
    ).scalars().first()
    leftovers = db.execute(
        select(TeamMembership).where(TeamMembership.membership_id == mem.id)).all()
    assert leftovers == []


def test_remove_member_drops_team_rows(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    bob = _mkuser("removed")
    _invite_and_accept(client, bob, db, oid, [])
    bob_uid = _user_id(db, _email_of(bob))
    team = _mkteam(client, oid, "Eng")
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                      json={"user_id": bob_uid}).status_code == 200

    assert client.delete(f"{ORG}/{oid}/members/{bob_uid}").status_code == 204
    assert db.execute(select(TeamMembership)).all() == []
    assert client.get(f"{ORG}/{oid}/teams/{team['id']}").json()["members"] == []


def test_root_team_removal_blocked(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    team = _mkteam(client, oid, "Eng")
    root_uid = _user_id(db, _email_of(client))
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                      json={"user_id": root_uid}).status_code == 200
    # Root-protection precedent mirrored from remove_member: never detach root.
    assert client.delete(
        f"{ORG}/{oid}/teams/{team['id']}/members/{root_uid}").status_code == 409
    assert len(client.get(f"{ORG}/{oid}/teams/{team['id']}").json()["members"]) == 1


def test_delete_set_blocked_when_team_assigned(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    s = _mkset(client, oid, "TeamOnly", ["Analytics.ViewUsage"])
    team = _mkteam(client, oid, "Eng", [s["id"]])
    assert client.delete(f"{ORG}/{oid}/sets/{s['id']}").status_code == 409
    assert client.put(f"{ORG}/{oid}/teams/{team['id']}/sets",
                     json={"set_ids": []}).status_code == 200
    assert client.delete(f"{ORG}/{oid}/sets/{s['id']}").status_code == 204


def test_update_rejects_org_id_and_noop(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    team = _mkteam(client, oid, "Eng")
    other_oid = _mkorg(client, name="Other")["id"]
    # org_id is immutable: rejected as 422, never applied.
    assert client.patch(f"{ORG}/{oid}/teams/{team['id']}",
                        json={"org_id": other_oid, "name": "X"}).status_code == 422
    assert client.get(f"{ORG}/{oid}/teams/{team['id']}").json()["name"] == "Eng"
    assert client.patch(f"{ORG}/{oid}/teams/{team['id']}", json={}).status_code == 200


def test_team_permission_gates(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    reader_set = _mkset(client, oid, "Reader", ["Teams.Read"])
    reader = _mkuser("reader")
    _invite_and_accept(client, reader, db, oid, [reader_set["id"]])
    reader_uid = _user_id(db, _email_of(reader))
    team = _mkteam(client, oid, "Eng")
    tid = team["id"]

    assert reader.get(f"{ORG}/{oid}/teams").status_code == 200
    assert reader.get(f"{ORG}/{oid}/teams/{tid}").status_code == 200
    assert reader.post(f"{ORG}/{oid}/teams", json={"name": "Nope"}).status_code == 404
    assert reader.patch(f"{ORG}/{oid}/teams/{tid}", json={"name": "Nope"}).status_code == 404
    assert reader.delete(f"{ORG}/{oid}/teams/{tid}").status_code == 404
    assert reader.post(f"{ORG}/{oid}/teams/{tid}/members",
                      json={"user_id": reader_uid}).status_code == 404
    assert reader.delete(
        f"{ORG}/{oid}/teams/{tid}/members/{reader_uid}").status_code == 404
    assert reader.put(f"{ORG}/{oid}/teams/{tid}/sets",
                      json={"set_ids": []}).status_code == 404

    bare = _mkuser("bare")
    _invite_and_accept(client, bare, db, oid, [])
    assert bare.get(f"{ORG}/{oid}/teams").status_code == 404
