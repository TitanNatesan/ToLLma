"""Org tables enrichment: members/sets/teams/keys/invitations/requests/audit
filters, pagination, enrichment correctness, defaults-unchanged shapes, and
404-oracle authz on every new param."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.main import app
from tollms.models.api_key import ApiRequestLog
from tollms.models.organization import AuditLog, Invitation
from tollms.models.request_log import RequestLog
from tollms.models.user import User

ORG = "/api/v1/orgs"


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"tables-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "Tables Org") -> dict:
    r = c.post(ORG, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _me(c: TestClient) -> dict:
    r = c.get("/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _email_of(c: TestClient) -> str:
    return _me(c)["email"]


def _token(db, invitation_id: str) -> str:
    inv = db.get(Invitation, uuid.UUID(invitation_id))
    db.refresh(inv)
    return inv.token


def _invite_and_accept(root: TestClient, member: TestClient, db, oid: str,
                       set_ids: list[str]) -> None:
    inv = root.post(f"{ORG}/{oid}/invitations",
                    json={"email": _email_of(member), "set_ids": set_ids})
    assert inv.status_code == 201, inv.text
    acc = member.post(f"{ORG}/invitations/by-token/{_token(db, inv.json()['id'])}/accept")
    assert acc.status_code == 200, acc.text


def _member_set_id(c: TestClient, oid: str, name: str = "Member") -> str:
    sets = c.get(f"{ORG}/{oid}/sets").json()
    return next(s["id"] for s in sets if s["name"] == name)


def _make_set(c: TestClient, oid: str, name: str, codes: list[str]) -> str:
    r = c.post(f"{ORG}/{oid}/sets", json={"name": name, "permissions": codes})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _mkteam(c: TestClient, oid: str, name: str, set_ids: list[str] | None = None) -> dict:
    r = c.post(f"{ORG}/{oid}/teams", json={"name": name, "set_ids": set_ids or []})
    assert r.status_code == 201, r.text
    return r.json()


def _issue(c: TestClient, oid: str, assignee: str, name: str | None = None) -> dict:
    r = c.post(f"{ORG}/{oid}/keys",
               json={"assignee_user_id": assignee,
                     "name": name or f"k-{uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    return r.json()


# --- members -----------------------------------------------------------------


def test_members_enrichment_and_filters(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)

    sub = _mkuser("enr")
    sub_id = _me(sub)["id"]
    sub_email = _email_of(sub)
    _invite_and_accept(client, sub, db, oid, [member_set])

    team = _mkteam(client, oid, "EnrTeam")
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                       json={"user_id": sub_id}).status_code == 200
    key = _issue(client, oid, sub_id)

    members = {m["user_id"]: m for m in client.get(f"{ORG}/{oid}/members").json()}
    assert set(members) == {root_id, sub_id}
    row = members[sub_id]
    assert row["teams"] == [{"id": team["id"], "name": "EnrTeam"}]
    assert row["team_ids"] == [team["id"]]
    assert row["set_ids"] == [member_set]
    assert row["joined_at"] is not None
    assert row["key_count"] == 1
    assert key["key"]["id"] not in str(members[root_id])
    assert members[root_id]["key_count"] == 0
    assert members[root_id]["joined_at"] is not None

    # search matches email substring; state filters; unknown state ignored.
    found = client.get(f"{ORG}/{oid}/members", params={"search": sub_email[:12]}).json()
    assert [m["user_id"] for m in found] == [sub_id]
    assert client.get(f"{ORG}/{oid}/members", params={"state": "suspended"}).json() == []
    assert client.get(f"{ORG}/{oid}/members", params={"state": "banana"}).json() != []

    assert client.post(f"{ORG}/{oid}/members/{sub_id}/suspend").status_code == 200
    susp = client.get(f"{ORG}/{oid}/members", params={"state": "suspended"}).json()
    assert [m["user_id"] for m in susp] == [sub_id]
    assert susp[0]["key_count"] == 0  # suspend revokes keys; team rows kept
    assert susp[0]["team_ids"] == [team["id"]]
    active = client.get(f"{ORG}/{oid}/members", params={"state": "active"}).json()
    assert [m["user_id"] for m in active] == [root_id]

    # limit/offset paginate the same ordering (root first).
    page1 = client.get(f"{ORG}/{oid}/members", params={"limit": 1}).json()
    page2 = client.get(f"{ORG}/{oid}/members", params={"limit": 1, "offset": 1}).json()
    assert [m["user_id"] for m in page1] == [root_id]
    assert [m["user_id"] for m in page2] == [sub_id]


# --- sets --------------------------------------------------------------------


def test_sets_counts_search_pagination(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)
    extra = _make_set(client, oid, "Counted", ["Members.Read"])

    sub = _mkuser("cnt")
    sub_id = _me(sub)["id"]
    _invite_and_accept(client, sub, db, oid, [extra])
    team = _mkteam(client, oid, "CountTeam", [extra])
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                       json={"user_id": sub_id}).status_code == 200

    by_name = {s["name"]: s for s in client.get(f"{ORG}/{oid}/sets").json()}
    assert by_name["Counted"]["member_count"] == 1
    assert by_name["Counted"]["team_count"] == 1
    assert by_name["Member"]["member_count"] == 0
    assert by_name["Member"]["team_count"] == 0

    searched = client.get(f"{ORG}/{oid}/sets", params={"search": "count"}).json()
    assert [s["name"] for s in searched] == ["Counted"]
    page = client.get(f"{ORG}/{oid}/sets", params={"limit": 2, "offset": 1}).json()
    full = client.get(f"{ORG}/{oid}/sets").json()
    assert page == full[1:3]


# --- teams -------------------------------------------------------------------


def test_teams_include_search_pagination(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    usage = _make_set(client, oid, "Usage", ["Analytics.ViewUsage"])
    sub = _mkuser("tinc")
    sub_id = _me(sub)["id"]
    _invite_and_accept(client, sub, db, oid, [_member_set_id(client, oid)])
    team = _mkteam(client, oid, "IncTeam", [usage])
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                       json={"user_id": sub_id}).status_code == 200
    _mkteam(client, oid, "OtherTeam")

    # Default = stripped shape: no members/sets keys at all.
    listed = client.get(f"{ORG}/{oid}/teams").json()
    assert len(listed) == 2
    assert "members" not in listed[0] and "sets" not in listed[0]
    assert listed[0]["member_count"] == 1

    both = client.get(f"{ORG}/{oid}/teams", params={"include": "members,sets"}).json()
    inc = next(t for t in both if t["name"] == "IncTeam")
    assert [m["user_id"] for m in inc["members"]] == [sub_id]
    assert [s["name"] for s in inc["sets"]] == ["Usage"]
    assert inc["sets"][0]["codes"] == ["Analytics.ViewUsage"]

    only_members = client.get(f"{ORG}/{oid}/teams", params={"include": "members"}).json()
    assert "members" in only_members[0] and "sets" not in only_members[0]
    # Unknown tokens are ignored back to the stripped default.
    assert "members" not in client.get(f"{ORG}/{oid}/teams", params={"include": "banana"}).json()[0]

    searched = client.get(f"{ORG}/{oid}/teams", params={"search": "incteam"}).json()
    assert [t["name"] for t in searched] == ["IncTeam"]
    page = client.get(f"{ORG}/{oid}/teams", params={"limit": 1, "offset": 1}).json()
    assert [t["name"] for t in page] == [sorted(["IncTeam", "OtherTeam"])[1]]


# --- keys --------------------------------------------------------------------


def test_keys_spend_search_pagination(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]

    rich = _issue(client, oid, root_id, name="rich-key")
    _issue(client, oid, root_id, name="poor-key")
    kid = uuid.UUID(rich["key"]["id"])
    db.add(ApiRequestLog(request_id=f"req-{uuid.uuid4().hex[:8]}",
                         api_key_id=kid, user_id=uuid.UUID(root_id), org_id=uuid.UUID(oid),
                         endpoint="chat_completions", status="success",
                         total_tokens=10, cost=Decimal("1.25")))
    db.add(ApiRequestLog(request_id=f"req-{uuid.uuid4().hex[:8]}",
                         api_key_id=kid, user_id=uuid.UUID(root_id), org_id=uuid.UUID(oid),
                         endpoint="chat_completions", status="failed",
                         total_tokens=99, cost=Decimal("9.99")))
    db.commit()

    keys = {k["name"]: k for k in client.get(f"{ORG}/{oid}/keys").json()}
    assert keys["rich-key"]["spend_usd"] == 1.25  # success only; failed excluded
    assert keys["poor-key"]["spend_usd"] == 0.0

    assert [k["name"] for k in client.get(f"{ORG}/{oid}/keys", params={"search": "RICH"}).json()] == ["rich-key"]
    assert len(client.get(f"{ORG}/{oid}/keys", params={"limit": 1}).json()) == 1
    assert len(client.get(f"{ORG}/{oid}/keys", params={"limit": 1, "offset": 1}).json()) == 1


# --- invitations + requests ----------------------------------------------------


def test_invitations_kind_and_search(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    email = f"kind-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = client.post(f"{ORG}/{oid}/invitations", json={"email": email, "set_ids": []})
    assert inv.status_code == 201, inv.text

    joiner = _mkuser("kindreq")
    assert joiner.post(f"{ORG}/{oid}/requests").status_code == 201

    invites = client.get(f"{ORG}/{oid}/invitations").json()
    assert {i["email"] for i in invites} == {email}
    both = client.get(f"{ORG}/{oid}/invitations", params={"kind": "banana"}).json()
    assert len(both) == 2  # unknown kind ignored: both queues
    reqs = client.get(f"{ORG}/{oid}/invitations", params={"kind": "request"}).json()
    assert len(reqs) == 1 and reqs[0]["kind"] == "request"

    searched = client.get(f"{ORG}/{oid}/invitations",
                          params={"kind": "banana", "search": email[:12]}).json()
    assert [i["email"] for i in searched] == [email]
    page = client.get(f"{ORG}/{oid}/invitations",
                      params={"kind": "banana", "limit": 1, "offset": 1}).json()
    assert len(page) == 1


def test_requests_status_filter(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    a = _mkuser("reqa")
    b = _mkuser("reqb")
    ra = a.post(f"{ORG}/{oid}/requests")
    assert ra.status_code == 201, ra.text
    rb = b.post(f"{ORG}/{oid}/requests")
    assert rb.status_code == 201, rb.text

    member_set = _member_set_id(client, oid)
    assert client.post(f"{ORG}/{oid}/requests/{ra.json()['id']}/approve",
                       json={"set_ids": [member_set]}).status_code == 200

    pending = client.get(f"{ORG}/{oid}/requests").json()
    assert [r["id"] for r in pending] == [rb.json()["id"]]
    accepted = client.get(f"{ORG}/{oid}/requests", params={"status": "accepted"}).json()
    assert [r["id"] for r in accepted] == [ra.json()["id"]]
    # Unknown status ignored: every request status.
    assert len(client.get(f"{ORG}/{oid}/requests", params={"status": "banana"}).json()) == 2
    searched = client.get(f"{ORG}/{oid}/requests",
                          params={"status": "banana", "search": _email_of(b)[:12]}).json()
    assert [r["email"] for r in searched] == [_email_of(b)]
    assert len(client.get(f"{ORG}/{oid}/requests", params={"limit": 1}).json()) == 1


# --- audit ---------------------------------------------------------------------


def test_audit_filters_enrichment_pagination(client: TestClient, db, user_factory) -> None:
    user_factory()
    root = _me(client)
    org = _mkorg(client)
    oid = org["id"]
    sub = _mkuser("aud")
    _invite_and_accept(client, sub, db, oid, [])

    full = client.get(f"{ORG}/{oid}/audit").json()
    actions = {a["action"] for a in full}
    assert {"org.created", "member.invited", "member.accepted"} <= actions

    created = client.get(f"{ORG}/{oid}/audit", params={"action": "org.created"}).json()
    assert len(created) == 1 and created[0]["actor_email"] == root["email"]
    assert created[0]["actor_name"] is None  # signup leaves full_name empty
    db.query(User).filter(User.id == uuid.UUID(root["id"])).update({"full_name": "Root Chief"})
    db.commit()
    renamed = client.get(f"{ORG}/{oid}/audit", params={"action": "org.created"}).json()
    assert renamed[0]["actor_name"] == "Root Chief"
    assert client.get(f"{ORG}/{oid}/audit", params={"action": "no.such.action"}).json() == []

    by_actor = client.get(f"{ORG}/{oid}/audit", params={"actor": root["id"]}).json()
    assert by_actor and all(a["actor_user_id"] == root["id"] for a in by_actor)
    assert client.get(f"{ORG}/{oid}/audit", params={"actor": "not-a-uuid"}).status_code == 422

    assert client.get(f"{ORG}/{oid}/audit", params={"from": "2000-01-01"}).json() != []
    assert client.get(f"{ORG}/{oid}/audit", params={"from": "2999-01-01"}).json() == []
    assert client.get(f"{ORG}/{oid}/audit", params={"to": "2000-01-01"}).json() == []
    assert client.get(f"{ORG}/{oid}/audit", params={"from": "not-a-date"}).status_code == 422

    # System events keep null enrichment.
    db.add(AuditLog(org_id=uuid.UUID(oid), actor_user_id=None,
                    action="test.system.ping", target={}))
    db.commit()
    sys_rows = client.get(f"{ORG}/{oid}/audit", params={"action": "test.system.ping"}).json()
    assert len(sys_rows) == 1
    assert sys_rows[0]["actor_user_id"] is None
    assert sys_rows[0]["actor_email"] is None and sys_rows[0]["actor_name"] is None

    # Cursor pagination: offset form and id form agree, pages are disjoint.
    newest_first = client.get(f"{ORG}/{oid}/audit", params={"limit": 100}).json()
    first = client.get(f"{ORG}/{oid}/audit", params={"limit": 1}).json()
    second_by_offset = client.get(f"{ORG}/{oid}/audit", params={"limit": 1, "cursor": "1"}).json()
    second_by_id = client.get(f"{ORG}/{oid}/audit",
                              params={"limit": 1, "cursor": first[0]["id"]}).json()
    assert first == newest_first[:1]
    assert second_by_offset == second_by_id == newest_first[1:2]
    assert first[0]["id"] != second_by_offset[0]["id"]
    assert client.get(f"{ORG}/{oid}/audit", params={"cursor": "bogus!!"}).status_code == 422


# --- analytics -----------------------------------------------------------------


def _seed_gateway(db, oid: str, uid: str, kid: str | None, cost: str,
                  tokens: int, when: datetime) -> None:
    db.add(ApiRequestLog(request_id=f"req-{uuid.uuid4().hex[:8]}",
                         api_key_id=uuid.UUID(kid) if kid else None,
                         user_id=uuid.UUID(uid), org_id=uuid.UUID(oid),
                         endpoint="chat_completions", status="success",
                         model="m", provider="p",
                         total_tokens=tokens, cost=Decimal(cost),
                         created_at=when))
    db.commit()


def test_analytics_filters_by_key_and_by_team(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)

    mate = _mkuser("mate")
    mate_id = _me(mate)["id"]
    _invite_and_accept(client, mate, db, oid, [member_set])

    old = datetime(2020, 5, 5, tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    key = _issue(client, oid, root_id)
    kid = key["key"]["id"]
    _seed_gateway(db, oid, root_id, kid, "2.00", 200, old)
    _seed_gateway(db, oid, mate_id, None, "4.00", 400, now)

    body = client.get(f"{ORG}/{oid}/analytics/overview").json()
    assert body["totals"]["requests"] == 2
    assert body["by_team"] == []  # documented: never attributed per team
    assert len(body["by_key"]) == 1
    assert body["by_key"][0]["key_id"] == kid
    assert body["by_key"][0]["requests"] == 1
    assert Decimal(str(body["by_key"][0]["cost"])) == Decimal("2.00")

    narrowed = client.get(f"{ORG}/{oid}/analytics/overview",
                          params={"from": "2021-01-01"}).json()
    assert narrowed["totals"]["requests"] == 1
    assert narrowed["totals"]["tokens"] == 400
    windowed = client.get(f"{ORG}/{oid}/analytics/overview",
                          params={"from": "2020-01-01", "to": "2020-12-31"}).json()
    assert windowed["totals"]["requests"] == 1
    assert windowed["totals"]["tokens"] == 200

    keyed = client.get(f"{ORG}/{oid}/analytics/overview", params={"key_id": kid}).json()
    assert keyed["totals"]["requests"] == 1
    assert keyed["by_key"][0]["key_id"] == kid
    assert client.get(f"{ORG}/{oid}/analytics/overview",
                      params={"key_id": "not-a-uuid"}).status_code == 422
    assert client.get(f"{ORG}/{oid}/analytics/overview",
                      params={"key_id": str(uuid.uuid4())}).status_code == 404

    # team_id scopes every section to the roster (mate is not on the team).
    team = _mkteam(client, oid, "ScopeTeam")
    scoped_empty = client.get(f"{ORG}/{oid}/analytics/overview",
                              params={"team_id": team["id"]}).json()
    assert scoped_empty["totals"]["requests"] == 0
    assert scoped_empty["by_team"] == []
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                       json={"user_id": mate_id}).status_code == 200
    scoped = client.get(f"{ORG}/{oid}/analytics/overview",
                        params={"team_id": team["id"]}).json()
    assert scoped["totals"]["requests"] == 1
    assert scoped["totals"]["tokens"] == 400
    assert client.get(f"{ORG}/{oid}/analytics/overview",
                      params={"team_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"{ORG}/{oid}/analytics/overview",
                      params={"from": "bogus"}).status_code == 422


# --- defaults unchanged + authz --------------------------------------------------


def test_table_defaults_unchanged(client: TestClient, db, user_factory) -> None:
    """Historical shapes keep working: existing fields, orderings, defaults."""
    user_factory()
    org = _mkorg(client)
    oid = org["id"]

    members = client.get(f"{ORG}/{oid}/members").json()
    assert len(members) == 1 and members[0]["is_root"] is True
    assert members[0]["state"] == "active"
    assert set(members[0]) >= {"user_id", "email", "permission_sets", "permissions"}

    sets = client.get(f"{ORG}/{oid}/sets").json()
    assert {s["name"] for s in sets} == {"Owner", "Approver", "Member"}
    assert all("permissions" in s for s in sets)

    team = _mkteam(client, oid, "Plain")
    listed = client.get(f"{ORG}/{oid}/teams").json()
    assert [t["id"] for t in listed] == [team["id"]]
    assert listed[0]["codes"] == [] and listed[0]["member_count"] == 0

    keys = client.get(f"{ORG}/{oid}/keys").json()
    assert keys == []
    audit = client.get(f"{ORG}/{oid}/audit").json()
    assert {a["action"] for a in audit} >= {"org.created"}
    assert all(set(a) >= {"id", "action", "target", "created_at"} for a in audit)
    body = client.get(f"{ORG}/{oid}/analytics/overview").json()
    assert set(body) >= {"totals", "by_day", "by_model", "by_provider", "by_user",
                         "by_team", "by_key"}


def test_tables_stranger_404_on_new_params(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    stranger = _mkuser("outsider")
    team = _mkteam(client, oid, "Hidden")

    assert stranger.get(f"{ORG}/{oid}/members", params={"search": "x"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/members", params={"state": "active"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/sets", params={"search": "x"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/teams", params={"include": "members,sets"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/teams", params={"search": "x"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/keys", params={"search": "x"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/invitations", params={"kind": "request"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/requests", params={"status": "pending"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/audit", params={"action": "org.created"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/audit", params={"cursor": "1"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/analytics/overview",
                        params={"from": "2020-01-01"}).status_code == 404
    assert stranger.get(f"{ORG}/{oid}/analytics/overview",
                        params={"team_id": team["id"]}).status_code == 404


def test_analytics_reliability_fields(client: TestClient, db, user_factory) -> None:
    """Additive reliability signals: success counts cover both ledgers and all
    statuses; rates are percent floats (null when empty); scoping keeps them."""
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]
    key = _issue(client, oid, root_id)
    kid = key["key"]["id"]

    db.add(RequestLog(user_id=uuid.UUID(root_id), org_id=uuid.UUID(oid),
                      status="success", prompt_tokens=100, cache_read_tokens=40,
                      total_tokens=100, total_cost=Decimal("1.00")))
    db.add(ApiRequestLog(request_id=f"req-{uuid.uuid4().hex[:8]}",
                         api_key_id=uuid.UUID(kid), user_id=uuid.UUID(root_id),
                         org_id=uuid.UUID(oid), endpoint="chat_completions",
                         status="success", model="m", provider="p",
                         input_tokens=160, cache_read_tokens=40,
                         total_tokens=200, cost=Decimal("2.00")))
    db.add(RequestLog(user_id=uuid.UUID(root_id), org_id=uuid.UUID(oid),
                      status="failed", error_code="boom"))
    db.commit()

    body = client.get(f"{ORG}/{oid}/analytics/overview").json()
    assert body["total_requests"] == 3
    assert body["successful_requests"] == 2
    assert abs(body["success_rate"] - 100.0 * 2 / 3) < 1e-6
    assert body["cache_read_tokens"] == 80
    assert body["input_tokens"] == 260
    assert 0 <= body["cache_hit_rate"] <= 100
    assert abs(body["cache_hit_rate"] - 100.0 * 80 / 340) < 1e-6
    # Existing success-only shape is unchanged.
    assert body["totals"]["requests"] == 2

    fresh = _mkorg(client, "Fresh Org")
    empty = client.get(f"{ORG}/{fresh['id']}/analytics/overview").json()
    assert empty["total_requests"] == 0 and empty["successful_requests"] == 0
    assert empty["success_rate"] is None and empty["cache_hit_rate"] is None

    keyed_r = client.get(f"{ORG}/{oid}/analytics/overview", params={"key_id": kid})
    assert keyed_r.status_code == 200, keyed_r.text
    keyed = keyed_r.json()
    assert keyed["total_requests"] == 1 and keyed["successful_requests"] == 1
    assert keyed["success_rate"] == 100.0
    assert keyed["cache_read_tokens"] == 40 and keyed["input_tokens"] == 160
    assert abs(keyed["cache_hit_rate"] - 20.0) < 1e-6

    team = _mkteam(client, oid, "RelTeam")
    scoped_empty = client.get(f"{ORG}/{oid}/analytics/overview",
                              params={"team_id": team["id"]}).json()
    assert scoped_empty["total_requests"] == 0
    assert scoped_empty["success_rate"] is None and scoped_empty["cache_hit_rate"] is None
    assert client.post(f"{ORG}/{oid}/teams/{team['id']}/members",
                       json={"user_id": root_id}).status_code == 200
    scoped_r = client.get(f"{ORG}/{oid}/analytics/overview",
                          params={"team_id": team["id"]})
    assert scoped_r.status_code == 200, scoped_r.text
    scoped = scoped_r.json()
    assert scoped["total_requests"] == 3 and scoped["successful_requests"] == 2
    assert abs(scoped["success_rate"] - 100.0 * 2 / 3) < 1e-6
    assert scoped["cache_hit_rate"] is not None
