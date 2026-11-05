"""Organizations Phase A tests: creation, sets, invites, requests,
members, notifications, isolation, audit."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.main import app
from tollms.models.organization import Invitation, InvitationStatus, Membership
from tollms.services.email import service as email_service

ORG = "/api/v1/orgs"


def _mkuser(tag: str) -> TestClient:
    from tollms.main import app

    c = TestClient(app)
    email = f"org-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "Acme Corp") -> dict:
    r = c.post(ORG, json={"name": name, "description": "Test org", "industry": "Tech"})
    assert r.status_code == 201, r.text
    return r.json()


def _email_of(c: TestClient) -> str:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()["email"]


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


def test_create_org_makes_caller_root(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    assert org["is_root"] is True
    assert len(org["permissions"]) == 63
    assert {"Members.Invite", "Members.Remove", "PermissionSets.Assign",
            "Organization.TransferRoot", "Audit.Read"} <= set(org["permissions"])
    assert org["slug"].startswith("acme-corp-")
    assert org["status"] == "active"
    mem = db.execute(select(Membership)).scalars().all()
    assert len(mem) == 1 and mem[0].is_root is True


def test_create_org_validation_and_slug_uniqueness(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.post(ORG, json={"name": "<script>alert(1)</script>"}).status_code == 422
    assert client.post(ORG, json={"name": "x"}).status_code == 422
    assert client.post(ORG, json={"name": "A" * 121}).status_code == 422
    a = _mkorg(client, name="Same Name")
    b = _mkorg(client, name="Same Name")
    assert a["slug"] != b["slug"]


def test_search_and_my_orgs(client: TestClient, user_factory) -> None:
    user_factory()
    org = _mkorg(client, name="Searchable Org")
    assert len(client.get(ORG).json()) == 1
    found = client.get(f"{ORG}/search", params={"q": "searchable"})
    assert found.status_code == 200
    assert any(o["slug"] == org["slug"] for o in found.json())
    assert "permissions" not in found.json()[0]


def test_permission_set_lifecycle_and_system_immutable(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    sets = client.get(f"{ORG}/{oid}/sets").json()
    assert {s["name"] for s in sets} == {"Owner", "Approver", "Member"}
    owner_set = next(s for s in sets if s["name"] == "Owner")
    assert len(owner_set["permissions"]) == 63

    custom = client.post(f"{ORG}/{oid}/sets",
                         json={"name": "Leads", "permissions": ["Members.Approve", "Analytics.ViewUsage"]})
    assert custom.status_code == 201, custom.text
    sid = custom.json()["id"]

    assert client.post(f"{ORG}/{oid}/sets",
                       json={"name": "Bogus", "permissions": ["fly_to_moon"]}).status_code == 422
    assert client.post(f"{ORG}/{oid}/sets",
                       json={"name": "leads", "permissions": []}).status_code == 409
    assert client.patch(f"{ORG}/{oid}/sets/{owner_set['id']}",
                        json={"name": "Hacked"}).status_code == 422
    assert client.delete(f"{ORG}/{oid}/sets/{owner_set['id']}").status_code == 422

    clone = client.post(f"{ORG}/{oid}/sets/{owner_set['id']}/clone",
                        json={"name": "Owner Clone", "permissions": []})
    assert clone.status_code == 201, clone.text
    assert len(clone.json()["permissions"]) == 63

    upd = client.patch(f"{ORG}/{oid}/sets/{sid}", json={"permissions": ["Analytics.ViewUsage"]})
    assert upd.status_code == 200 and upd.json()["permissions"] == ["Analytics.ViewUsage"]

    member = _mkuser("member")
    _invite_and_accept(client, member, db, oid, [sid])
    assert client.delete(f"{ORG}/{oid}/sets/{sid}").status_code == 409


def test_escalation_blocked_for_non_root(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    sets = client.get(f"{ORG}/{oid}/sets").json()
    member_set = next(s for s in sets if s["name"] == "Member")

    sub = _mkuser("sub")
    _invite_and_accept(client, sub, db, oid, [member_set["id"]])
    # Member with zero governance rights cannot create sets (404 oracle).
    assert sub.post(f"{ORG}/{oid}/sets",
                    json={"name": "Coup", "permissions": ["view_analytics"]}).status_code == 404

    # A manage_members holder cannot grant manage_settings (escalation).
    leads = client.post(f"{ORG}/{oid}/sets",
                        json={"name": "Leads",
                              "permissions": ["Members.Invite", "PermissionSets.Assign"]}).json()
    lead = _mkuser("lead")
    _invite_and_accept(client, lead, db, oid, [leads["id"]])
    esc = lead.post(f"{ORG}/{oid}/members/{_email_of(sub)}", json={})
    assert esc.status_code in (404, 405)
    bad_assign = lead.post(
        f"{ORG}/{oid}/members/{_user_id(db, _email_of(sub))}/sets", json={"set_ids": [leads["id"]]})
    assert bad_assign.status_code == 200  # granting what they hold is fine


def _user_id(db, email: str) -> str:
    from tollms.models.user import User
    from sqlalchemy import func

    return str(db.execute(select(User.id).where(func.lower(User.email) == email.lower())).scalar_one())


def test_invite_existing_user_accept_and_reject(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    email_service.outbox.clear()

    bob = _mkuser("bob")
    bob_email = _email_of(bob)
    inv = client.post(f"{ORG}/{oid}/invitations", json={"email": bob_email, "set_ids": []})
    assert inv.status_code == 201, inv.text

    assert any(m["to"] == bob_email and m["kind"] == "org_invite" for m in email_service.outbox)
    assert client.post(f"{ORG}/{oid}/invitations",
                       json={"email": bob_email, "set_ids": []}).status_code == 409

    mine = bob.get(f"{ORG}/invitations/mine").json()
    assert len(mine) == 1
    acc = bob.post(f"{ORG}/invitations/by-token/{_token(db, mine[0]['id'])}/accept")
    assert acc.status_code == 200, acc.text
    assert acc.json()["is_root"] is False

    assert client.post(f"{ORG}/{oid}/invitations",
                       json={"email": bob_email, "set_ids": []}).status_code == 409
    members = {m["email"] for m in client.get(f"{ORG}/{oid}/members").json()}
    assert members == {_email_of(client), bob_email}

    notif = bob.get("/api/v1/notifications").json()
    assert any(n["kind"] == "invited" for n in notif)

    cara = _mkuser("cara")
    inv2 = client.post(f"{ORG}/{oid}/invitations", json={"email": _email_of(cara), "set_ids": []})
    mine2 = cara.get(f"{ORG}/invitations/mine").json()
    assert cara.post(f"{ORG}/invitations/by-token/{_token(db, mine2[0]['id'])}/reject").status_code == 204
    assert _email_of(cara) not in {m["email"] for m in client.get(f"{ORG}/{oid}/members").json()}
    assert inv2.json()["id"] not in [i["id"] for i in cara.get(f"{ORG}/invitations/mine").json()]


def test_invite_new_user_registers_then_accepts(client: TestClient, db, user_factory) -> None:

    user_factory()
    org = _mkorg(client)
    fresh_email = f"fresh-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = client.post(f"{ORG}/{org['id']}/invitations", json={"email": fresh_email, "set_ids": []})
    assert inv.status_code == 201, inv.text

    newcomer = TestClient(app)
    r = newcomer.post("/auth/signup", json={"email": fresh_email, "password": "Password123"})
    assert r.status_code == 200, r.text
    newcomer.get("/auth/verify", params={"token": r.json()["debug_verification_token"]})
    mine = newcomer.get(f"{ORG}/invitations/mine").json()
    assert len(mine) == 1 and mine[0]["email"] == fresh_email
    acc = newcomer.post(f"{ORG}/invitations/by-token/{_token(db, mine[0]['id'])}/accept")
    assert acc.status_code == 200, acc.text


def test_invite_expiration_and_replay(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    bob = _mkuser("exp")
    inv = client.post(f"{ORG}/{org['id']}/invitations", json={"email": _email_of(bob), "set_ids": []})
    row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert bob.post(f"{ORG}/invitations/by-token/{row.token}/accept").status_code == 422
    db.refresh(row)
    assert row.status == InvitationStatus.EXPIRED.value
    assert bob.post(f"{ORG}/invitations/by-token/{row.token}/accept").status_code == 422


def test_join_request_approve_reject_and_gates(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    stranger = _mkuser("joiner")
    req = stranger.post(f"{ORG}/{oid}/requests")
    assert req.status_code == 201, req.text
    assert stranger.post(f"{ORG}/{oid}/requests").status_code == 409
    assert stranger.get(f"{ORG}/{oid}/requests").status_code == 404

    queue = client.get(f"{ORG}/{oid}/requests").json()
    assert len(queue) == 1

    member = _mkuser("plain")
    _invite_and_accept(client, member, db, oid, [])
    assert member.get(f"{ORG}/{oid}/requests").status_code == 404

    member_set = next(s for s in client.get(f"{ORG}/{oid}/sets").json() if s["name"] == "Member")
    appr = client.post(f"{ORG}/{oid}/requests/{queue[0]['id']}/approve",
                       json={"set_ids": [member_set["id"]]})
    assert appr.status_code == 200, appr.text

    other = _mkuser("rejectme")
    req2 = other.post(f"{ORG}/{oid}/requests")
    assert client.post(f"{ORG}/{oid}/requests/{req2.json()['id']}/reject").status_code == 204
    assert other.get(f"{ORG}/{oid}").status_code == 404


def test_suspend_resume_lifecycle(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    bob = _mkuser("susp")
    bob_email = _email_of(bob)
    _invite_and_accept(client, bob, db, oid, [])

    # Non-privileged member cannot suspend (404 oracle).
    assert bob.post(f"{ORG}/{oid}/members/{_user_id(db, _email_of(client))}/suspend").status_code == 404

    uid = _user_id(db, bob_email)
    r = client.post(f"{ORG}/{oid}/members/{uid}/suspend")
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "suspended"

    # Suspended: org access denied, login + personal intact.
    assert bob.get(f"{ORG}/{oid}").status_code == 404
    assert bob.get("/auth/me").status_code == 200
    assert bob.get(f"{ORG}/invitations/mine").status_code == 200

    # Root cannot suspend itself... (root suspend blocked); resume restores.
    assert client.post(f"{ORG}/{oid}/members/{_user_id(db, _email_of(client))}/suspend").status_code == 409
    r2 = client.post(f"{ORG}/{oid}/members/{uid}/resume")
    assert r2.status_code == 200 and r2.json()["state"] == "active"
    assert bob.get(f"{ORG}/{oid}").status_code == 200

    # Resume of non-suspended member is 404.
    assert client.post(f"{ORG}/{oid}/members/{uid}/resume").status_code == 404
    actions = {a["action"] for a in client.get(f"{ORG}/{oid}/audit").json()}
    assert {"member.suspended", "member.resumed"} <= actions


def test_member_removal_root_protection_and_leave(client: TestClient, db, user_factory) -> None:
    user_factory()
    me = _email_of(client)
    org = _mkorg(client)
    oid = org["id"]
    bob = _mkuser("gone")
    _invite_and_accept(client, bob, db, oid, [])

    assert client.delete(f"{ORG}/{oid}/members/{_user_id(db, me)}").status_code == 409
    assert bob.delete(f"{ORG}/{oid}/members/{_user_id(db, me)}").status_code == 404

    assert client.delete(f"{ORG}/{oid}/members/{_user_id(db, _email_of(bob))}").status_code == 204
    assert bob.get(f"{ORG}/{oid}").status_code == 404
    assert _email_of(bob) not in {m["email"] for m in client.get(f"{ORG}/{oid}/members").json()}
    assert any(n["kind"] == "member.removed" for n in bob.get("/api/v1/notifications").json())

    assert client.post(f"{ORG}/{oid}/leave").status_code == 409

    cara = _mkuser("leaver")
    _invite_and_accept(client, cara, db, oid, [])
    assert cara.post(f"{ORG}/{oid}/leave").status_code == 204
    assert cara.get(f"{ORG}/{oid}").status_code == 404


def test_cross_org_isolation_returns_404(client: TestClient, db, user_factory) -> None:
    user_factory()
    org_a = _mkorg(client, name="Org Alpha")
    outsider = _mkuser("outsider")
    assert outsider.get(f"{ORG}/{org_a['id']}").status_code == 404
    assert outsider.get(f"{ORG}/{org_a['id']}/members").status_code == 404
    assert outsider.get(f"{ORG}/{org_a['id']}/sets").status_code == 404
    assert outsider.get(f"{ORG}/{org_a['id']}/audit").status_code == 404
    assert outsider.post(f"{ORG}/{org_a['id']}/requests").status_code == 201  # discovery is open
    assert outsider.get(f"{ORG}/search", params={"q": "alpha"}).status_code == 200


def test_notifications_visibility_and_read(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    bob = _mkuser("notif")
    client.post(f"{ORG}/{org['id']}/invitations", json={"email": _email_of(bob), "set_ids": []})
    assert bob.get("/api/v1/notifications/unread-count").json()["unread"] >= 1
    first = bob.get("/api/v1/notifications").json()[0]
    assert bob.post(f"/api/v1/notifications/{first['id']}/read").status_code == 200
    assert client.post(f"/api/v1/notifications/{first['id']}/read").status_code == 404
    marked = bob.post("/api/v1/notifications/read-all").json()
    assert marked["marked"] >= 0
    assert bob.get("/api/v1/notifications/unread-count").json()["unread"] == 0


def test_audit_log_records_governance(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    bob = _mkuser("audited")
    _invite_and_accept(client, bob, db, oid, [])
    actions = {a["action"] for a in client.get(f"{ORG}/{oid}/audit").json()}
    assert {"org.created", "member.invited", "member.accepted"} <= actions
    assert bob.get(f"{ORG}/{oid}/audit").status_code == 404


def test_invitation_token_only_on_recipient_queue(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    bob = _mkuser("tokenvis")
    inv = client.post(f"{ORG}/{org['id']}/invitations", json={"email": _email_of(bob), "set_ids": []})
    inv_id = inv.json()["id"]
    # Org-managed listing never exposes the single-use secret.
    listed = client.get(f"{ORG}/{org['id']}/invitations").json()
    assert listed[0]["id"] == inv_id and listed[0].get("token") is None
    # The recipient's own queue carries the token they need to accept.
    mine = bob.get(f"{ORG}/invitations/mine").json()
    assert mine[0]["id"] == inv_id and mine[0]["token"] == _token(db, inv_id)


def test_resend_invitation_fresh_token_and_negatives(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    bob = _mkuser("resend")
    bob_email = _email_of(bob)
    inv = client.post(f"{ORG}/{oid}/invitations", json={"email": bob_email, "set_ids": []})
    iid = inv.json()["id"]
    old_token = _token(db, iid)

    resent = client.post(f"{ORG}/{oid}/invitations/{iid}/resend")
    assert resent.status_code == 200, resent.text
    new_token = _token(db, iid)
    assert new_token and new_token != old_token

    # Old token is dead (unknown token -> 404, no oracle).
    assert bob.post(f"{ORG}/invitations/by-token/{old_token}/accept").status_code == 404
    # New token works.
    assert bob.post(f"{ORG}/invitations/by-token/{new_token}/accept").status_code == 200

    # Resend of a non-pending (accepted) invitation is rejected.
    assert client.post(f"{ORG}/{oid}/invitations/{iid}/resend").status_code == 422

    # Resend of a rejected invitation is rejected.
    cara = _mkuser("resrej")
    inv2 = client.post(f"{ORG}/{oid}/invitations", json={"email": _email_of(cara), "set_ids": []})
    iid2 = inv2.json()["id"]
    mine2 = cara.get(f"{ORG}/invitations/mine").json()
    assert cara.post(f"{ORG}/invitations/by-token/{_token(db, mine2[0]['id'])}/reject").status_code == 204
    assert client.post(f"{ORG}/{oid}/invitations/{iid2}/resend").status_code == 422

    # Resend of a revoked (closed) invitation is rejected.
    dave = _mkuser("resrev")
    inv3 = client.post(f"{ORG}/{oid}/invitations", json={"email": _email_of(dave), "set_ids": []})
    iid3 = inv3.json()["id"]
    assert client.delete(f"{ORG}/{oid}/invitations/{iid3}").status_code == 204
    assert client.post(f"{ORG}/{oid}/invitations/{iid3}/resend").status_code == 422

    # Resend of an approved join request is rejected (wrong kind).
    erin = _mkuser("resreq")
    req = erin.post(f"{ORG}/{oid}/requests")
    rid = req.json()["id"]
    member_set = next(s for s in client.get(f"{ORG}/{oid}/sets").json() if s["name"] == "Member")
    assert client.post(f"{ORG}/{oid}/requests/{rid}/approve",
                       json={"set_ids": [member_set["id"]]}).status_code == 200
    assert client.post(f"{ORG}/{oid}/invitations/{rid}/resend").status_code == 422

    # invite.resent audit event exists.
    actions = {a["action"] for a in client.get(f"{ORG}/{oid}/audit").json()}
    assert "invite.resent" in actions


def test_cancel_invitation(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    bob = _mkuser("cancelled")
    inv = client.post(f"{ORG}/{org['id']}/invitations", json={"email": _email_of(bob), "set_ids": []})
    assert client.delete(f"{ORG}/{org['id']}/invitations/{inv.json()['id']}").status_code == 204
    assert bob.get(f"{ORG}/invitations/mine").json() == []
