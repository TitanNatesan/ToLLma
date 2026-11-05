"""Public new-account invite flows: accept-new (atomic signup+accept) and
reject-new (public decline). No auth on either; identical 404 oracle."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tollms.main import app
from tollms.models.organization import (
    AuditLog,
    Invitation,
    InvitationStatus,
    Membership,
    MembershipPermissionSet,
    Notification,
)
from tollms.models.user import User

ORG = "/api/v1/orgs"


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"newflow-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "Newflow Org") -> dict:
    r = c.post(ORG, json={"name": name})
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


def _invite(client: TestClient, oid: str, email: str, set_ids: list[str] | None = None) -> dict:
    r = client.post(f"{ORG}/{oid}/invitations",
                    json={"email": email, "set_ids": set_ids or []})
    assert r.status_code == 201, r.text
    return r.json()


def _make_set(client: TestClient, oid: str, name: str, perms: list[str]) -> str:
    r = client.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": perms})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _err_wo_ts(r) -> dict:
    assert r.status_code in (404, 409, 422), r.text
    return {k: v for k, v in r.json()["error"].items() if k != "timestamp"}


def _user_by_email(db, email: str):
    db.expire_all()
    return db.execute(
        select(User).where(func.lower(User.email) == email.lower(), User.is_deleted.is_(False))
    ).scalars().first()


def test_accept_new_happy_path(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    sid = _make_set(client, oid, "Greeter", ["Members.Read", "Analytics.ViewUsage"])

    email = f"fresh-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, oid, email, [sid])
    anon = TestClient(app)

    r = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/accept-new",
                  json={"full_name": "Fresh Person", "password": "Password123"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["org_id"] == oid
    assert body["user"]["email"] == email
    assert body["user"]["email_verified"] is True
    assert body["user"]["full_name"] == "Fresh Person"
    assert body["access_token"] and body["refresh_token"]
    assert body["session_issued"] is True

    # Returned token is a live session: /auth/me answers.
    me = anon.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200, me.text
    assert me.json()["id"] == body["user"]["id"]

    db.expire_all()
    user = _user_by_email(db, email)
    assert user is not None and user.email_verified is True and user.has_password is True
    mem = db.execute(
        select(Membership).where(Membership.org_id == uuid.UUID(oid),
                                 Membership.user_id == user.id,
                                 Membership.is_deleted.is_(False))
    ).scalars().one()
    assert mem.state == "active" and mem.is_root is False
    assigned = set(
        db.execute(
            select(MembershipPermissionSet.set_id).where(
                MembershipPermissionSet.membership_id == mem.id)
        ).scalars().all()
    )
    assert assigned == {uuid.UUID(sid)}
    row = db.get(Invitation, uuid.UUID(inv["id"]))
    assert row.status == InvitationStatus.ACCEPTED.value and row.user_id == user.id
    assert db.execute(
        select(AuditLog.id).where(AuditLog.org_id == uuid.UUID(oid),
                                  AuditLog.action == "member.accepted")
    ).first() is not None


def test_accept_new_404_oracle(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    anon = TestClient(app)
    payload = {"full_name": "N N", "password": "Password123"}

    expected = _err_wo_ts(anon.post(f"{ORG}/invitations/by-token/does-not-exist/accept-new",
                                    json=payload))
    assert anon.post(f"{ORG}/invitations/by-token/does-not-exist/accept-new",
                     json=payload).status_code == 404

    # Tampered token -> identical 404.
    email = f"oracle-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, org["id"], email)
    real = _token(db, inv["id"])
    bad = ("x" if real[0] != "x" else "y") + real[1:]
    tampered = anon.post(f"{ORG}/invitations/by-token/{bad}/accept-new", json=payload)
    assert tampered.status_code == 404
    assert _err_wo_ts(tampered) == expected

    # Consumed token -> identical 404.
    ok = anon.post(f"{ORG}/invitations/by-token/{real}/accept-new", json=payload)
    assert ok.status_code == 200, ok.text
    consumed = anon.post(f"{ORG}/invitations/by-token/{real}/accept-new", json=payload)
    assert consumed.status_code == 404
    assert _err_wo_ts(consumed) == expected

    # Rejected token -> identical 404.
    inv2 = _invite(client, org["id"], f"oracle2-{uuid.uuid4().hex[:8]}@tollma.ai")
    tok2 = _token(db, inv2["id"])
    assert anon.post(f"{ORG}/invitations/by-token/{tok2}/reject-new").status_code == 200
    rejected = anon.post(f"{ORG}/invitations/by-token/{tok2}/accept-new", json=payload)
    assert rejected.status_code == 404
    assert _err_wo_ts(rejected) == expected

    # Expired token -> identical 404.
    inv3 = _invite(client, org["id"], f"oracle3-{uuid.uuid4().hex[:8]}@tollma.ai")
    row3 = db.get(Invitation, uuid.UUID(inv3["id"]))
    row3.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    expired = anon.post(f"{ORG}/invitations/by-token/{row3.token}/accept-new", json=payload)
    assert expired.status_code == 404
    assert _err_wo_ts(expired) == expected


def test_accept_new_existing_email_409(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    bob = _mkuser("exists")
    bob_email = _email_of(bob)
    inv = _invite(client, org["id"], bob_email)
    anon = TestClient(app)

    r = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/accept-new",
                  json={"full_name": "Bob Clone", "password": "Password123"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "INVITE_ACCOUNT_EXISTS"

    # Zero membership/invite change: invite still pending, bob not a member.
    db.expire_all()
    assert db.get(Invitation, uuid.UUID(inv["id"])).status == InvitationStatus.PENDING.value
    bob_row = _user_by_email(db, bob_email)
    assert db.execute(
        select(Membership.id).where(Membership.org_id == uuid.UUID(org["id"]),
                                    Membership.user_id == bob_row.id,
                                    Membership.is_deleted.is_(False))
    ).first() is None


def test_accept_new_weak_password_422(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    email = f"weak-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, org["id"], email)
    anon = TestClient(app)

    # No uppercase: fails the shared signup strength policy.
    r = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/accept-new",
                  json={"full_name": "Weak Pw", "password": "lowercase1"})
    assert r.status_code == 422, r.text
    assert _user_by_email(db, email) is None
    db.expire_all()
    assert db.get(Invitation, uuid.UUID(inv["id"])).status == InvitationStatus.PENDING.value


def test_accept_new_email_mismatch_422_and_match_ok(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    org = _mkorg(client)
    email = f"match-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, org["id"], email)
    anon = TestClient(app)

    r = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/accept-new",
                  json={"full_name": "X", "password": "Password123",
                        "email": "someone-else@tollma.ai"})
    assert r.status_code == 422, r.text
    assert _user_by_email(db, email) is None

    # Same address in different case: equality check passes, account created.
    r2 = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/accept-new",
                   json={"full_name": "X", "password": "Password123",
                         "email": email.upper()})
    assert r2.status_code == 200, r2.text
    assert r2.json()["user"]["email"] == email


def test_accept_new_ignores_client_sets(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    invited_sid = _make_set(client, oid, "Invited", ["Members.Read"])
    decoy_sid = _make_set(client, oid, "Decoy", ["Analytics.ViewUsage"])
    email = f"tamper-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, oid, email, [invited_sid])
    anon = TestClient(app)

    r = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/accept-new",
                  json={"full_name": "T T", "password": "Password123",
                        "set_ids": [decoy_sid], "is_root": True})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == email

    db.expire_all()
    user = _user_by_email(db, email)
    mem = db.execute(
        select(Membership).where(Membership.org_id == uuid.UUID(oid),
                                 Membership.user_id == user.id)
    ).scalars().one()
    assert mem.is_root is False
    assigned = set(
        db.execute(
            select(MembershipPermissionSet.set_id).where(
                MembershipPermissionSet.membership_id == mem.id)
        ).scalars().all()
    )
    assert assigned == {uuid.UUID(invited_sid)}


def test_reject_new_happy_path(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    email = f"decline-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, org["id"], email)
    anon = TestClient(app)

    r = anon.post(f"{ORG}/invitations/by-token/{_token(db, inv['id'])}/reject-new")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "rejected"}

    # Consumed as rejected; NO user row, NO membership anywhere near this org.
    db.expire_all()
    assert db.get(Invitation, uuid.UUID(inv["id"])).status == InvitationStatus.REJECTED.value
    assert _user_by_email(db, email) is None
    members = db.execute(
        select(Membership).where(Membership.org_id == uuid.UUID(org["id"]),
                                 Membership.is_deleted.is_(False))
    ).scalars().all()
    assert len(members) == 1 and members[0].is_root is True
    # Inviter notified via the existing rejected notifier.
    root_id = members[0].user_id
    assert db.execute(
        select(Notification.id).where(Notification.user_id == root_id,
                                      Notification.kind == "invitation.rejected")
    ).first() is not None


def test_reject_new_reuse_404(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    anon = TestClient(app)
    inv = _invite(client, org["id"], f"rej-{uuid.uuid4().hex[:8]}@tollma.ai")
    tok = _token(db, inv["id"])
    assert anon.post(f"{ORG}/invitations/by-token/{tok}/reject-new").status_code == 200
    again = anon.post(f"{ORG}/invitations/by-token/{tok}/reject-new")
    assert again.status_code == 404, again.text
    expected = _err_wo_ts(anon.post(f"{ORG}/invitations/by-token/nope/reject-new"))
    assert _err_wo_ts(again) == expected


def test_accept_new_double_accept_single_membership(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    org = _mkorg(client)
    email = f"double-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, org["id"], email)
    anon = TestClient(app)
    tok = _token(db, inv["id"])
    payload = {"full_name": "D D", "password": "Password123"}

    assert anon.post(f"{ORG}/invitations/by-token/{tok}/accept-new",
                     json=payload).status_code == 200
    second = anon.post(f"{ORG}/invitations/by-token/{tok}/accept-new", json=payload)
    assert second.status_code == 404, second.text

    db.expire_all()
    user = _user_by_email(db, email)
    rows = db.execute(
        select(Membership).where(Membership.org_id == uuid.UUID(org["id"]),
                                 Membership.user_id == user.id,
                                 Membership.is_deleted.is_(False))
    ).scalars().all()
    assert len(rows) == 1 and rows[0].state == "active"


def test_invite_email_links_directly_to_public_page(
    client: TestClient, db, user_factory
) -> None:
    """Regression: the emailed link must be the public /invite/<token> page.

    The previous link (/organizations/invites?token=…) is login-gated, so new
    users landed on /login before ever seeing their invitation.
    """
    from tollms.services.email import service as email_service

    user_factory()
    org = _mkorg(client)
    email = f"link-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = _invite(client, org["id"], email)
    tok = _token(db, inv["id"])

    msgs = [m for m in email_service.outbox
            if m.get("kind") == "org_invite" and m.get("to") == email]
    assert msgs, "expected an org_invite email in the test outbox"
    html = msgs[-1]["html"]
    assert f"/invite/{tok}" in html
    assert "organizations/invites?token=" not in html
    assert "/login" not in html
