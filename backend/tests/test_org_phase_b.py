"""Organizations Phase B tests: org keys, personal isolation, revocation hooks,
org providers, budgets, attribution, invite preview, analytics gates."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.main import app
from tollms.core.exceptions import ForbiddenError, NotFoundError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.organization import AuditLog, Invitation
from tollms.models.provider import Provider
from tollms.models.request_log import RequestLog
from tollms.services.api_keys import keys as key_engine
from tollms.api.public_gateway import service as gateway_service

ORG = "/api/v1/orgs"

SSE_BODY = (
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,'
    '"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
    "data: [DONE]\n\n"
)


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"phaseb-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _mkorg(c: TestClient, name: str = "PhaseB Org") -> dict:
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


def _issue(c: TestClient, oid: str, assignee: str, **kw) -> dict:
    payload = {"assignee_user_id": assignee, "name": f"k-{uuid.uuid4().hex[:6]}", **kw}
    r = c.post(f"{ORG}/{oid}/keys", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# --- org keys -----------------------------------------------------------------


def test_org_key_create_list_revoke(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]

    created = _issue(client, oid, root_id, description="ops key",
                     max_budget_usd="25.50",
                     model_permissions=[{"provider_id": None, "model_id": None}])
    assert created["raw_key"].startswith("tma_sk_live_")
    key = created["key"]
    assert key["org_id"] == oid
    assert key["assignee_user_id"] == root_id
    assert key["issued_by"] == root_id
    assert key["masked"] == f"{created['raw_key'][:16]}…"
    assert "key_hash" not in key and created["raw_key"] not in str(key)
    assert Decimal(key["policy"]["max_budget_usd"]) == Decimal("25.50")

    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(key["id"])))
    assert stored.org_id == uuid.UUID(oid)
    assert stored.issued_by == uuid.UUID(root_id)
    assert stored.key_hash == key_engine.hash_key(created["raw_key"])

    listed = client.get(f"{ORG}/{oid}/keys")
    assert listed.status_code == 200
    assert [k["id"] for k in listed.json()] == [key["id"]]
    assert "key_hash" not in listed.text and created["raw_key"] not in listed.text

    assert key_engine.authenticate(db, created["raw_key"]) is not None

    assert client.delete(f"{ORG}/{oid}/keys/{key['id']}").status_code == 204
    assert client.get(f"{ORG}/{oid}/keys").json() == []
    assert key_engine.authenticate(db, created["raw_key"]) is None
    # Revoked keys never reactivate: the row stays dead.
    db.expire_all()
    dead = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(key["id"])))
    assert dead.enabled is False and dead.is_deleted is True


def test_org_key_requires_keys_create_and_member_assignee(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)

    sub = _mkuser("nokeys")
    sub_id = _me(sub)["id"]
    _invite_and_accept(client, sub, db, oid, [member_set])

    # Member without Keys.Create gets the 404 oracle (never 403).
    r = sub.post(f"{ORG}/{oid}/keys", json={"assignee_user_id": sub_id, "name": "x"})
    assert r.status_code == 404, r.text
    assert sub.get(f"{ORG}/{oid}/keys").status_code == 404
    assert sub.delete(f"{ORG}/{oid}/keys/{uuid.uuid4()}").status_code == 404

    # Assignee must be an ACTIVE member: strangers and outsiders rejected.
    outsider = _mkuser("outsider")
    outsider_id = _me(outsider)["id"]
    r = client.post(f"{ORG}/{oid}/keys",
                    json={"assignee_user_id": outsider_id, "name": "x"})
    assert r.status_code == 404, r.text

    # Root issuing to self works; issuing to a real member works.
    own = _issue(client, oid, root_id)
    assert own["key"]["assignee_user_id"] == root_id
    mem_key = _issue(client, oid, sub_id)
    assert mem_key["key"]["assignee_user_id"] == sub_id


def test_org_key_budget_cap_enforced(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]

    budget = client.get(f"{ORG}/{oid}/budget")
    assert budget.status_code == 200
    assert Decimal(budget.json()["max_spend"] or 0) == 0
    assert budget.json()["max_spend"] is None
    assert Decimal(budget.json()["allocated"]) == 0
    assert budget.json()["unallocated"] is None

    assert client.patch(f"{ORG}/{oid}/budget", json={"max_spend": "10.00"}).status_code == 200
    got = client.get(f"{ORG}/{oid}/budget").json()
    assert Decimal(got["max_spend"]) == Decimal("10.00") and Decimal(got["allocated"]) == 0
    assert Decimal(got["unallocated"]) == Decimal("10.00")

    _issue(client, oid, root_id, max_budget_usd="6.00")
    got = client.get(f"{ORG}/{oid}/budget").json()
    assert Decimal(got["allocated"]) == Decimal("6.00")
    assert Decimal(got["unallocated"]) == Decimal("4.00")

    # allocated(6) + new(5) > cap(10) -> 422.
    r = client.post(f"{ORG}/{oid}/keys",
                    json={"assignee_user_id": root_id, "name": "over",
                          "max_budget_usd": "5.00"})
    assert r.status_code == 422, r.text

    # Lowering the cap below allocated is also 422.
    r = client.patch(f"{ORG}/{oid}/budget", json={"max_spend": "5.00"})
    assert r.status_code == 422, r.text

    # Clearing the cap restores unlimited issuance.
    assert client.patch(f"{ORG}/{oid}/budget", json={"max_spend": None}).status_code == 200
    _issue(client, oid, root_id, max_budget_usd="500.00")


def test_personal_org_key_isolation(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]

    personal = client.post("/api/v1/keys", json={"name": "personal"})
    assert personal.status_code == 201, personal.text
    pid = personal.json()["key"]["id"]

    org_created = _issue(client, oid, root_id)
    kid = org_created["key"]["id"]

    # Personal scope sees only personal keys; org scope only org keys.
    personal_ids = [k["id"] for k in client.get("/api/v1/keys").json()]
    assert pid in personal_ids and kid not in personal_ids
    org_ids = [k["id"] for k in client.get(f"{ORG}/{oid}/keys").json()]
    assert kid in org_ids and pid not in org_ids

    # Read contract: the holder (root assignee here) with Keys.Read gets 200
    # on single-read + analytics; every write stays org-managed (404 oracle).
    assert client.get(f"/api/v1/keys/{kid}").status_code == 200
    assert client.get(f"/api/v1/keys/{kid}/analytics").status_code == 200
    assert client.patch(f"/api/v1/keys/{kid}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/v1/keys/{kid}").status_code == 404
    assert client.post(f"/api/v1/keys/{kid}/rotate").status_code == 404
    assert client.put(f"/api/v1/keys/{kid}/policy", json={}).status_code == 404
    assert client.put(f"/api/v1/keys/{kid}/ip-rules", json=[]).status_code == 404
    assert client.put(f"/api/v1/keys/{kid}/model-permissions", json=[]).status_code == 404

    # Strangers (non-members) get the 404 oracle on org-key reads too.
    stranger = _mkuser("stranger-keys")
    assert stranger.get(f"/api/v1/keys/{kid}").status_code == 404
    assert stranger.get(f"/api/v1/keys/{kid}/analytics").status_code == 404

    # Org endpoints cannot touch personal keys either.
    assert client.delete(f"{ORG}/{oid}/keys/{pid}").status_code == 404


def test_removal_revokes_only_assignee_org_keys(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)

    gone = _mkuser("gone")
    gone_id = _me(gone)["id"]
    stays = _mkuser("stays")
    stays_id = _me(stays)["id"]
    _invite_and_accept(client, gone, db, oid, [member_set])
    _invite_and_accept(client, stays, db, oid, [member_set])

    # A's personal key (outside org scope entirely).
    own = gone.post("/api/v1/keys", json={"name": "personal-of-gone"})
    assert own.status_code == 201, own.text
    own_raw = own.json()["raw_key"]

    key_gone = _issue(client, oid, gone_id)
    key_stays = _issue(client, oid, stays_id)

    members = client.get(f"{ORG}/{oid}/members").json()
    target = next(m["user_id"] for m in members if m["user_id"] == gone_id)
    assert client.delete(f"{ORG}/{oid}/members/{target}").status_code == 204

    # Removed member's org key is dead; everyone else unaffected.
    assert key_engine.authenticate(db, key_gone["raw_key"]) is None
    assert key_engine.authenticate(db, key_stays["raw_key"]) is not None
    assert key_engine.authenticate(db, own_raw) is not None
    remaining = [k["id"] for k in client.get(f"{ORG}/{oid}/keys").json()]
    assert key_gone["key"]["id"] not in remaining
    assert key_stays["key"]["id"] in remaining
    assert own.json()["key"]["id"] in [k["id"] for k in gone.get("/api/v1/keys").json()]

    # Re-accepting (new membership) does NOT restore the old key row.
    _invite_and_accept(client, gone, db, oid, [member_set])
    assert key_engine.authenticate(db, key_gone["raw_key"]) is None


def test_suspend_revokes_and_resume_does_not_restore(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)

    sub = _mkuser("susp")
    sub_id = _me(sub)["id"]
    _invite_and_accept(client, sub, db, oid, [member_set])
    created = _issue(client, oid, sub_id)

    assert client.post(f"{ORG}/{oid}/members/{sub_id}/suspend").status_code == 200
    assert key_engine.authenticate(db, created["raw_key"]) is None

    assert client.post(f"{ORG}/{oid}/members/{sub_id}/resume").status_code == 200
    # Resume restores access, never keys: re-issuance is a new row.
    assert key_engine.authenticate(db, created["raw_key"]) is None
    assert client.get(f"{ORG}/{oid}/keys").json() == []


# --- org providers ---------------------------------------------------------------


def test_org_providers_scope_and_visibility(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)
    sub = _mkuser("prov")
    _invite_and_accept(client, sub, db, oid, [member_set])

    personal = client.post("/api/v1/providers", json={
        "name": "Mine", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert personal.status_code == 201, personal.text

    # Member without Providers.Create cannot create org providers (404 oracle).
    r = sub.post(f"{ORG}/{oid}/providers", json={
        "name": "OrgProv", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert r.status_code == 404, r.text

    created = client.post(f"{ORG}/{oid}/providers", json={
        "name": "OrgProv", "provider_type": "CUSTOM",
        "credentials": {"api_key": "s3cr3t", "base_url": "http://mock"}})
    assert created.status_code == 201, created.text
    body = created.json()
    assert "s3cr3t" not in str(body) and "credentials_encrypted" not in str(body)
    org_pid = body["id"]

    # Personal registry boundary: the V1 list shows ONLY personal rows, even
    # for members; org rows are served by the org endpoints (secrets masked).
    mine = {p["id"]: p for p in client.get("/api/v1/providers").json()}
    assert personal.json()["id"] in mine and org_pid not in mine
    theirs = {p["id"]: p for p in sub.get("/api/v1/providers").json()}
    assert org_pid not in theirs and personal.json()["id"] not in theirs
    org_list = {p["id"] for p in client.get(f"{ORG}/{oid}/providers").json()}
    assert org_pid in org_list and personal.json()["id"] not in org_list
    assert "s3cr3t" not in sub.get(f"{ORG}/{oid}/providers").text
    # Personal detail/update/delete on an org row are 404 (use org endpoints).
    assert sub.get(f"/api/v1/providers/{org_pid}").status_code == 404
    assert sub.patch(f"/api/v1/providers/{org_pid}", json={"name": "x"}).status_code == 404
    assert sub.delete(f"/api/v1/providers/{org_pid}").status_code == 404

    # Strangers see neither.
    stranger = _mkuser("stranger")
    assert stranger.get(f"/api/v1/providers/{org_pid}").status_code == 404

    # Same name in the other scope does not collide.
    dup = sub.post(f"{ORG}/{oid}/providers", json={
        "name": "Mine", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert dup.status_code == 404  # no perm -> oracle (root tested below)
    root_dup = client.post(f"{ORG}/{oid}/providers", json={
        "name": "Mine", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert root_dup.status_code == 201, root_dup.text


# --- gateway attribution ------------------------------------------------------------


def _bind_mock(monkeypatch) -> None:
    from tollms.services.gateway.factory import build_adapter as real_build

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/chat/completions":
            return httpx.Response(200, content=SSE_BODY.encode(),
                                  headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "unexpected path"})

    transport = httpx.MockTransport(handler)

    def fake_build_adapter(provider, model, credentials):
        return real_build(provider, model, credentials, transport)

    monkeypatch.setattr(gateway_service, "build_adapter", fake_build_adapter)


def test_gateway_org_attribution(client: TestClient, db, user_factory, provider_factory,
                                model_factory, monkeypatch) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]

    prov = client.post(f"{ORG}/{oid}/providers/register", json={
        "name": "OrgGW", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [{"model_id": "org-model", "name": "Org Model",
                    "endpoint_type": "chat_completions",
                    "input_price": "1", "output_price": "2"}]})
    assert prov.status_code == 201, prov.text

    org_key = _issue(client, oid, root_id)
    personal = client.post("/api/v1/keys", json={"name": "pattr"})
    assert personal.status_code == 201, personal.text

    _bind_mock(monkeypatch)
    ref = "OrgGW/org-model"
    ok = client.post("/v1/chat/completions",
                     json={"model": ref, "messages": [{"role": "user", "content": "hi"}]},
                     headers={"Authorization": f"Bearer {org_key['raw_key']}"})
    assert ok.status_code == 200, ok.text

    row = db.scalar(select(ApiRequestLog).where(
        ApiRequestLog.api_key_id == uuid.UUID(org_key["key"]["id"])))
    assert row is not None and row.org_id == uuid.UUID(oid)

    # A personal key calling a personal model attributes NULL org.
    pprov = provider_factory("PAttr")
    model_factory(pprov["id"], model_id="p-model")
    ok2 = client.post("/v1/chat/completions",
                      json={"model": "PAttr/p-model",
                            "messages": [{"role": "user", "content": "hi"}]},
                      headers={"Authorization": f"Bearer {personal.json()['raw_key']}"})
    assert ok2.status_code == 200, ok2.text
    row2 = db.scalar(select(ApiRequestLog).where(
        ApiRequestLog.api_key_id == uuid.UUID(personal.json()["key"]["id"])))
    assert row2 is not None and row2.org_id is None


# --- invite preview ------------------------------------------------------------------


def test_invite_preview_happy_path_and_404s(client: TestClient, db, user_factory) -> None:
    user_factory()
    root = _me(client)
    org = _mkorg(client, name="Preview Org")
    oid = org["id"]
    sid = _make_set(client, oid, "Greeter", ["Members.Read", "Analytics.ViewUsage"])

    anon = TestClient(app)
    email = f"invited-{uuid.uuid4().hex[:8]}@tollma.ai"
    inv = client.post(f"{ORG}/{oid}/invitations",
                      json={"email": email, "set_ids": [sid]})
    assert inv.status_code == 201, inv.text
    token = _token(db, inv.json()["id"])

    preview = anon.get(f"/api/v1/orgs/invitations/preview/{token}")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["org_name"] == "Preview Org"
    assert body["org_slug"] == org["slug"]
    assert body["email"] == email
    assert body["invited_by"]["email"] == root["email"]
    assert body["permission_sets"][0]["name"] == "Greeter"
    assert set(body["permission_sets"][0]["codes"]) == {"Members.Read", "Analytics.ViewUsage"}
    assert "token" not in body

    bad = anon.get("/api/v1/orgs/invitations/preview/does-not-exist")
    assert bad.status_code == 404
    expected_404 = {k: v for k, v in bad.json()["error"].items() if k != "timestamp"}

    # Expired token -> identical 404.
    inv_row = db.get(Invitation, uuid.UUID(inv.json()["id"]))
    inv_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    expired = anon.get(f"/api/v1/orgs/invitations/preview/{token}")
    assert expired.status_code == 404
    assert {k: v for k, v in expired.json()["error"].items() if k != "timestamp"} == expected_404

    # Consumed token -> identical 404.
    inv_row.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    inv_row.status = "accepted"
    db.commit()
    consumed = anon.get(f"/api/v1/orgs/invitations/preview/{token}")
    assert consumed.status_code == 404
    assert {k: v for k, v in consumed.json()["error"].items() if k != "timestamp"} == expected_404


# --- analytics ------------------------------------------------------------------------


def _seed_org_traffic(db, oid: str, user_a: str, user_b: str) -> None:
    db.add(RequestLog(user_id=uuid.UUID(user_a), org_id=uuid.UUID(oid),
                      api_key_id=None, total_tokens=100, total_cost=Decimal("0.5"),
                      status="success"))
    db.add(ApiRequestLog(request_id=f"req-{uuid.uuid4().hex[:8]}",
                         user_id=uuid.UUID(user_b), org_id=uuid.UUID(oid),
                         endpoint="chat_completions", status="success",
                         model="m", provider="p",
                         total_tokens=50, cost=Decimal("0.25")))
    # Personal traffic elsewhere must not leak in.
    db.add(RequestLog(user_id=uuid.UUID(user_a), org_id=None,
                      total_tokens=999, total_cost=Decimal("9")))
    db.commit()


def test_org_analytics_gates_and_cost_redaction(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)
    usage_only = _make_set(client, oid, "UsageOnly", ["Analytics.ViewUsage"])
    usage_cost = _make_set(client, oid, "UsageCost",
                           ["Analytics.ViewUsage", "Analytics.ViewCost"])

    plain = _mkuser("plain")
    plain_id = _me(plain)["id"]
    viewer = _mkuser("viewer")
    viewer_id = _me(viewer)["id"]
    coster = _mkuser("coster")
    _invite_and_accept(client, plain, db, oid, [member_set])
    _invite_and_accept(client, viewer, db, oid, [usage_only])
    _invite_and_accept(client, coster, db, oid, [usage_cost])

    _seed_org_traffic(db, oid, plain_id, viewer_id)

    # No ViewUsage -> 404 oracle.
    assert plain.get(f"{ORG}/{oid}/analytics/overview").status_code == 404
    stranger = _mkuser("stranger2")
    assert stranger.get(f"{ORG}/{oid}/analytics/overview").status_code == 404

    # ViewUsage without ViewCost -> aggregates with null costs.
    redacted = viewer.get(f"{ORG}/{oid}/analytics/overview")
    assert redacted.status_code == 200, redacted.text
    body = redacted.json()
    assert body["totals"]["requests"] == 2
    assert body["totals"]["tokens"] == 150
    assert body["totals"]["cost"] is None
    assert all(p["cost"] is None for p in body["by_day"])
    assert all(m["cost"] is None for m in body["by_model"])
    assert all(p["cost"] is None for p in body["by_provider"])
    assert all(u["cost"] is None for u in body["by_user"])
    by_user = {u["user_id"]: u for u in body["by_user"]}
    assert by_user[plain_id]["requests"] == 1
    assert by_user[plain_id]["removed_badge"] is False
    assert by_user[viewer_id]["requests"] == 1
    # Metadata only: no prompts, responses, or message content anywhere.
    assert "prompt" not in redacted.text.lower().replace("prompt_tokens", "")

    # ViewUsage + ViewCost -> costs included.
    full = coster.get(f"{ORG}/{oid}/analytics/overview")
    assert full.status_code == 200, full.text
    assert Decimal(str(full.json()["totals"]["cost"])) == Decimal("0.75")
    assert full.json()["by_model"][0]["requests"] >= 1

    # Root sees costs too.
    root_view = client.get(f"{ORG}/{oid}/analytics/overview")
    assert Decimal(str(root_view.json()["totals"]["cost"])) == Decimal("0.75")


def test_org_analytics_removed_badge(client: TestClient, db, user_factory) -> None:
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)
    usage_cost = _make_set(client, oid, "UC2",
                           ["Analytics.ViewUsage", "Analytics.ViewCost"])
    doomed = _mkuser("doomed")
    doomed_id = _me(doomed)["id"]
    seer = _mkuser("seer")
    _invite_and_accept(client, doomed, db, oid, [member_set])
    _invite_and_accept(client, seer, db, oid, [usage_cost])
    _seed_org_traffic(db, oid, doomed_id, doomed_id)

    members = client.get(f"{ORG}/{oid}/members").json()
    target = next(m["user_id"] for m in members if m["user_id"] == doomed_id)
    assert client.delete(f"{ORG}/{oid}/members/{target}").status_code == 204

    body = seer.get(f"{ORG}/{oid}/analytics/overview").json()
    row = next(u for u in body["by_user"] if u["user_id"] == doomed_id)
    assert row["removed_badge"] is True
    assert row["requests"] == 2


# --- org-key model scope (key-org binding) ---------------------------------------


def _org_provider_with_model(c: TestClient, db, oid: str, name: str) -> tuple[str, str]:
    """Org provider + one model via the org flow (register wizard). The
    personal /api/v1/models endpoint can no longer target org providers."""
    from tollms.models.registered_model import AIModel

    p = c.post(f"{ORG}/{oid}/providers/register", json={
        "name": name, "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [{"model_id": f"{name}-model", "name": f"{name} Model",
                    "endpoint_type": "chat_completions",
                    "input_price": "1", "output_price": "2"}]})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]
    mid = db.scalar(select(AIModel.id).where(
        AIModel.provider_id == uuid.UUID(pid),
        AIModel.model_id == f"{name}-model"))
    assert mid is not None
    return pid, str(mid)


def test_org_key_rejects_cross_org_models(client: TestClient, db, user_factory) -> None:
    """A granter in two orgs cannot stamp org B's model onto an org A key."""
    user_factory()
    org_a = _mkorg(client, "ScopeA")["id"]
    org_b = _mkorg(client, "ScopeB")["id"]
    _, model_b = _org_provider_with_model(client, db, org_b, "ProvB")
    _, model_a = _org_provider_with_model(client, db, org_a, "ProvA")
    me_id = _me(client)["id"]

    bad = client.post(f"{ORG}/{org_a}/keys", json={
        "assignee_user_id": me_id, "name": "cross-org",
        "model_permissions": [{"model_id": model_b}]})
    assert bad.status_code == 422, bad.text
    assert "outside this organization" in bad.text

    good = client.post(f"{ORG}/{org_a}/keys", json={
        "assignee_user_id": me_id, "name": "same-org",
        "model_permissions": [{"model_id": model_a}]})
    assert good.status_code == 201, good.text


def test_personal_key_rejects_org_models(client: TestClient, db, user_factory) -> None:
    """Personal keys can never carry org-provider models (scope-aware)."""
    user_factory()
    org = _mkorg(client)["id"]
    _, model_o = _org_provider_with_model(client, db, org, "OrgOnly")
    r = client.post("/api/v1/keys", json={
        "name": "personal-sneak", "model_permissions": [{"model_id": model_o}]})
    assert r.status_code == 422, r.text


def test_invite_preview_expired_and_consumed_404(client: TestClient, db, user_factory) -> None:
    """Preview oracle: expired/consumed/invalid tokens are identical 404s."""
    from datetime import timedelta

    from tollms.models.organization import Invitation

    user_factory()
    org = _mkorg(client)["id"]
    member = _mkuser("preview")
    inv = client.post(f"{ORG}/{org}/invitations",
                      json={"email": _email_of(member), "set_ids": []})
    assert inv.status_code == 201, inv.text
    iid = inv.json()["id"]

    row = db.get(Invitation, uuid.UUID(iid))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.get(f"{ORG}/invitations/preview/{_token(db, iid)}").status_code == 404

    inv2 = client.post(f"{ORG}/{org}/invitations",
                       json={"email": _email_of(member), "set_ids": []})
    assert inv2.status_code == 201, inv2.text
    iid2 = inv2.json()["id"]
    tok2 = _token(db, iid2)
    assert member.post(f"{ORG}/invitations/by-token/{tok2}/accept").status_code == 200
    assert client.get(f"{ORG}/invitations/preview/{tok2}").status_code == 404
    assert client.get(f"{ORG}/invitations/preview/garbage-token-xyz").status_code == 404


def test_org_analytics_counts_only_successful_requests(
    client: TestClient, db, user_factory,
) -> None:
    """Failed/denied attempts stay in the logs but out of usage analytics."""
    user_factory()
    org = _mkorg(client)
    oid = org["id"]
    member_set = _member_set_id(client, oid)
    viewer = _mkuser("viewer")
    _invite_and_accept(client, viewer, db, oid, [member_set])
    viewer_id = _me(viewer)["id"]

    db.add(RequestLog(user_id=uuid.UUID(viewer_id), org_id=uuid.UUID(oid),
                      total_tokens=100, total_cost=Decimal("0.5"),
                      status="success"))
    db.add(RequestLog(user_id=uuid.UUID(viewer_id), org_id=uuid.UUID(oid),
                      total_tokens=0, total_cost=Decimal("0"),
                      status="failed"))
    db.add(ApiRequestLog(request_id=f"req-{uuid.uuid4().hex[:8]}",
                         user_id=uuid.UUID(viewer_id), org_id=uuid.UUID(oid),
                         endpoint="chat_completions", status="failed",
                         model="probed-model", provider="p",
                         total_tokens=0, cost=Decimal("0")))
    db.commit()

    body = client.get(f"{ORG}/{oid}/analytics/overview").json()
    assert body["totals"]["requests"] == 1
    assert body["totals"]["tokens"] == 100
    assert all(r["requests"] == 1 for r in body["by_user"])
    assert "probed-model" not in str(body["by_model"])


# --- org provider register (atomic wizard) + model perm gates ---------------------


def _reg_payload(name: str = "OrgWiz", **kw) -> dict:
    payload = {
        "name": name, "provider_type": "CUSTOM",
        "description": "wizard",
        "credentials": {"base_url": "http://mock"},
        "validation_status": "valid",
        "validation_message": "credentials valid",
        "models": [
            {"model_id": "m1", "name": "M1", "endpoint_type": "chat_completions"},
            {"model_id": "m2", "name": "M2", "endpoint_type": "chat_completions",
             "input_price": "2.5", "output_price": "10"},
        ],
    }
    payload.update(kw)
    return payload


def _audit_row(db, oid: str, action: str):
    db.expire_all()
    return db.scalar(select(AuditLog).where(
        AuditLog.org_id == uuid.UUID(oid), AuditLog.action == action))


def test_org_provider_register_atomic_happy(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]

    r = client.post(f"{ORG}/{oid}/providers/register", json=_reg_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    pid = body["id"]
    assert body["validation_status"] == "valid"
    assert body["validation_message"] == "credentials valid"
    assert body["last_validated_at"] is not None
    assert "credentials_encrypted" not in str(body)

    # Provider row is org-scoped with the caller kept as audit-only user_id.
    row = db.get(Provider, uuid.UUID(pid))
    assert row.org_id == uuid.UUID(oid) and row.user_id == uuid.UUID(root_id)

    from tollms.models.registered_model import AIModel

    # Personal registry boundary: org models never leak onto V1.
    assert client.get("/api/v1/models", params={"provider_id": pid}).json() == []
    models = db.scalars(select(AIModel).where(
        AIModel.provider_id == uuid.UUID(pid))).all()
    assert sorted(m.model_id for m in models) == ["m1", "m2"]

    audit = _audit_row(db, oid, "provider.created")
    assert audit is not None
    assert audit.target["provider_id"] == pid and audit.target["models_created"] == 2

    # Org-scoped uniqueness: same name rejected, nothing extra persisted.
    dup = client.post(f"{ORG}/{oid}/providers/register", json=_reg_payload())
    assert dup.status_code == 422, dup.text
    assert len(client.get(f"{ORG}/{oid}/providers").json()) == 1
    assert client.get("/api/v1/models", params={"provider_id": pid}).json() == []


def test_org_register_name_scopes_independent(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]

    personal = client.post("/api/v1/providers", json={
        "name": "Shared", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert personal.status_code == 201, personal.text

    org = client.post(f"{ORG}/{oid}/providers/register",
                      json=_reg_payload(name="Shared", models=[]))
    assert org.status_code == 201, org.text
    assert uuid.UUID(org.json()["id"]) != uuid.UUID(personal.json()["id"])

    again = client.post("/api/v1/providers", json={
        "name": "OrgWiz", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert again.status_code == 201, again.text


def test_org_register_requires_create_perm(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    sub = _mkuser("noprovcreate")
    _invite_and_accept(client, sub, db, oid, [_member_set_id(client, oid)])

    # Member without Providers.Create gets the 404 oracle (never 403).
    r = sub.post(f"{ORG}/{oid}/providers/register", json=_reg_payload())
    assert r.status_code == 404, r.text
    assert client.get(f"{ORG}/{oid}/providers").json() == []


def test_org_register_cross_org_and_body_org_id(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid_a = _mkorg(client, "RegA")["id"]
    other = _mkuser("crossreg")
    oid_b = _mkorg(other, "RegB")["id"]

    # Strangers (non-members) get 404 in both directions.
    assert client.post(f"{ORG}/{oid_b}/providers/register",
                       json=_reg_payload()).status_code == 404
    assert other.post(f"{ORG}/{oid_a}/providers/register",
                      json=_reg_payload()).status_code == 404

    # A perm-holding member of A posting into B is still 404.
    full = _make_set(client, oid_a, "ProvFull",
                     ["Providers.Create", "Providers.Read", "Providers.Update", "Providers.Delete"])
    sub = _mkuser("crossmember")
    _invite_and_accept(client, sub, db, oid_a, [full])
    assert sub.post(f"{ORG}/{oid_b}/providers/register",
                    json=_reg_payload()).status_code == 404

    # org_id smuggled in the body is rejected (422); the path owns the scope.
    bad = _reg_payload()
    bad["org_id"] = oid_a
    r = client.post(f"{ORG}/{oid_a}/providers/register", json=bad)
    assert r.status_code == 422, r.text
    assert client.get(f"{ORG}/{oid_a}/providers").json() == []


def test_org_register_invalid_model_atomic(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]

    bad = _reg_payload()
    bad["models"] = [{"model_id": "", "name": "Bad", "endpoint_type": "chat_completions"}]
    r = client.post(f"{ORG}/{oid}/providers/register", json=bad)
    assert r.status_code == 422, r.text
    assert client.get(f"{ORG}/{oid}/providers").json() == []
    assert client.get("/api/v1/models").json() == []


def test_org_model_perm_gates(client: TestClient, db, user_factory) -> None:
    """Org model perm gates, behind the personal registry boundary.

    The personal /api/v1/models endpoints 404 every org-scoped op (even for
    perm-holding members — org models are managed via the org flow); the
    Providers.* perm gates still fire at the service layer.
    """
    from tollms.api.models import service as models_service
    from tollms.api.models.schemas import ModelCreate, ModelUpdate
    from tollms.core.exceptions import NotFoundError

    user_factory()
    root_id = uuid.UUID(_me(client)["id"])
    oid = _mkorg(client)["id"]
    full = _make_set(client, oid, "ProvFull",
                     ["Providers.Create", "Providers.Read", "Providers.Update", "Providers.Delete"])
    bare = _mkuser("baremodel")
    empowered = _mkuser("fullmodel")
    _invite_and_accept(client, bare, db, oid, [_member_set_id(client, oid)])
    _invite_and_accept(client, empowered, db, oid, [full])
    bare_id = uuid.UUID(_me(bare)["id"])
    empowered_id = uuid.UUID(_me(empowered)["id"])

    prov = client.post(f"{ORG}/{oid}/providers", json={
        "name": "Gated", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert prov.status_code == 201, prov.text
    pid = prov.json()["id"]

    # Seed via the service-level org flow (dual visibility, perm-gated).
    seed = models_service.create_model(
        db, ModelCreate(provider_id=uuid.UUID(pid), model_id="seed", name="Seed",
                        endpoint_type="chat_completions"),
        user_id=root_id)
    mid = str(seed.id)

    payload = {"provider_id": pid, "model_id": "x", "name": "X",
               "endpoint_type": "chat_completions"}
    # Personal endpoints 404 org rows for everyone (boundary, not the perm).
    assert bare.post("/api/v1/models", json=payload).status_code == 404
    assert bare.patch(f"/api/v1/models/{mid}", json={"name": "Nope"}).status_code == 404
    assert bare.delete(f"/api/v1/models/{mid}").status_code == 404
    assert client.get(f"/api/v1/models/{mid}").status_code == 404
    assert empowered.post("/api/v1/models", json=payload).status_code == 404
    assert empowered.patch(f"/api/v1/models/{mid}", json={"name": "Nope"}).status_code == 404
    assert empowered.delete(f"/api/v1/models/{mid}").status_code == 404

    # Service-layer perm gates: perm-less member gets the 404 oracle.
    with pytest.raises(NotFoundError):
        models_service.create_model(
            db, ModelCreate(provider_id=uuid.UUID(pid), model_id="x", name="X",
                            endpoint_type="chat_completions"),
            user_id=bare_id)

    # Perm-holding member: all three ops succeed.
    created = models_service.create_model(
        db, ModelCreate(provider_id=uuid.UUID(pid), model_id="x", name="X",
                        endpoint_type="chat_completions"),
        user_id=empowered_id)
    renamed = models_service.update_model(
        db, seed.id, ModelUpdate(name="Renamed"), user_id=empowered_id)
    assert renamed.name == "Renamed"
    models_service.delete_model(db, created.id, user_id=empowered_id)

    audit = _audit_row(db, oid, "model.created")
    assert audit is not None and audit.target["provider_id"] == pid


def test_org_provider_rotate_creds_perm(client: TestClient, db, user_factory) -> None:
    user_factory()
    oid = _mkorg(client)["id"]
    updater = _make_set(client, oid, "Updater", ["Providers.Read", "Providers.Update"])
    rotator = _make_set(client, oid, "Rotator",
                        ["Providers.Read", "Providers.Update", "Providers.RotateCredentials"])
    sub = _mkuser("rotator")
    sub_id = _me(sub)["id"]
    _invite_and_accept(client, sub, db, oid, [updater])

    prov = client.post(f"{ORG}/{oid}/providers", json={
        "name": "Rot", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert prov.status_code == 201, prov.text
    pid = prov.json()["id"]

    # Update without RotateCredentials: credential rotation is 404, rename works.
    creds = {"credentials": {"base_url": "http://mock", "api_key": "new"}}
    assert sub.patch(f"{ORG}/{oid}/providers/{pid}", json=creds).status_code == 404
    assert sub.patch(f"{ORG}/{oid}/providers/{pid}", json={"name": "Rot2"}).status_code == 200

    # Granting RotateCredentials unlocks rotation.
    grant = client.post(f"{ORG}/{oid}/members/{sub_id}/sets", json={"set_ids": [rotator]})
    assert grant.status_code == 200, grant.text
    assert sub.patch(f"{ORG}/{oid}/providers/{pid}", json=creds).status_code == 200


# --- org keys: full personal field parity ------------------------------------


def _issue_full(client: TestClient, oid: str, assignee: str, **kw) -> dict:
    payload = {
        "assignee_user_id": assignee,
        "name": f"full-{uuid.uuid4().hex[:6]}",
        "description": "ops key",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "policy": {
            "max_budget_usd": "42.50",
            "budget_reset_days": 30,
            "rpm": 100,
            "rph": 1000,
            "rpd": 10000,
            "tpm": 50000,
            "tpd": 500000,
            "daily_spend_limit": "5.00",
            "monthly_spend_limit": "100.00",
        },
        "ip_rules": [
            {"type": "allow", "cidr": "203.0.113.0/24"},
            {"type": "deny", "cidr": "198.51.100.7"},
        ],
        "model_permissions": [
            {"provider_id": None, "model_id": None, "enabled": True},
        ],
        **kw,
    }
    r = client.post(f"{ORG}/{oid}/keys", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_org_key_create_full_fields(client: TestClient, db, user_factory) -> None:
    """Org keys accept the full personal field set: expiry, limits, rate
    limits, spend caps, IP rules and per-model caps."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    r = client.post(f"{ORG}/{oid}/providers/register", json=_reg_payload())
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    from tollms.models.registered_model import AIModel as _AIModel
    mids = [str(m.id) for m in db.scalars(select(_AIModel).where(
        _AIModel.provider_id == uuid.UUID(pid))).all()]
    assert len(mids) == 2

    created = _issue_full(
        client, oid, root_id,
        model_permissions=[
            {"provider_id": pid, "model_id": mids[0], "enabled": True,
             "max_budget": "10.00", "rpm": 60, "tpm": 20000},
        ],
    )
    key = created["key"]
    assert key["org_id"] == oid
    assert key["assignee_user_id"] == root_id
    assert key["expires_at"] is not None
    pol = key["policy"]
    assert Decimal(pol["max_budget_usd"]) == Decimal("42.50")
    assert pol["budget_reset_days"] == 30
    assert pol["rpm"] == 100 and pol["rph"] == 1000 and pol["rpd"] == 10000
    assert pol["tpm"] == 50000 and pol["tpd"] == 500000
    assert Decimal(pol["daily_spend_limit"]) == Decimal("5.00")
    assert Decimal(pol["monthly_spend_limit"]) == Decimal("100.00")
    cidrs = sorted(i["cidr"] for i in key["ip_rules"])
    assert cidrs == ["198.51.100.7/32", "203.0.113.0/24"]
    perms = key["model_permissions"]
    assert len(perms) == 1 and perms[0]["model_id"] == mids[0]
    assert Decimal(perms[0]["max_budget"]) == Decimal("10.00")
    assert perms[0]["rpm"] == 60 and perms[0]["tpm"] == 20000

    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(key["id"])))
    assert stored.expires_at is not None
    assert stored.ip_rules is not None and len(stored.ip_rules) == 2
    assert key_engine.authenticate(db, created["raw_key"]) is not None


def test_org_key_rejects_past_expiry_and_bad_cidr(client: TestClient, db, user_factory) -> None:
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = client.post(f"{ORG}/{oid}/keys", json={
        "assignee_user_id": root_id, "name": "old", "expires_at": past})
    assert r.status_code == 422, r.text

    r = client.post(f"{ORG}/{oid}/keys", json={
        "assignee_user_id": root_id, "name": "badip",
        "ip_rules": [{"type": "allow", "cidr": "not-an-ip"}]})
    assert r.status_code in (400, 422), r.text


def test_org_key_policy_budget_counts_toward_cap(client: TestClient, db, user_factory) -> None:
    """The org max_spend cap applies to policy.max_budget_usd, not only the
    legacy top-level field."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    assert client.patch(f"{ORG}/{oid}/budget", json={"max_spend": "10.00"}).status_code == 200

    created = _issue_full(client, oid, root_id,
                          policy={"max_budget_usd": "6.00", "rpm": 10})
    assert Decimal(created["key"]["policy"]["max_budget_usd"]) == Decimal("6.00")

    r = client.post(f"{ORG}/{oid}/keys", json={
        "assignee_user_id": root_id, "name": "over",
        "policy": {"max_budget_usd": "5.00"}})
    assert r.status_code == 422, r.text

    # Legacy top-level field keeps working and mixes with policy caps.
    got = client.get(f"{ORG}/{oid}/budget").json()
    assert Decimal(got["allocated"]) == Decimal("6.00")
    _issue(client, oid, root_id, max_budget_usd="4.00")
    got = client.get(f"{ORG}/{oid}/budget").json()
    assert Decimal(got["allocated"]) == Decimal("10.00")


def test_org_models_lists_only_org_models(client: TestClient, db, user_factory) -> None:
    """GET /orgs/{id}/models returns live models of that org's providers."""
    from tollms.models.registered_model import AIModel as _AIModel
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]

    personal = client.post("/api/v1/providers", json={
        "name": "Personal", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert personal.status_code == 201, personal.text
    ppid = personal.json()["id"]
    pm = client.post("/api/v1/models", json={
        "provider_id": ppid, "model_id": "p1", "name": "P1",
        "endpoint_type": "chat_completions"})
    assert pm.status_code == 201, pm.text

    r = client.post(f"{ORG}/{oid}/providers/register", json=_reg_payload())
    assert r.status_code == 201, r.text

    listed = client.get(f"{ORG}/{oid}/models")
    assert listed.status_code == 200, listed.text
    got = listed.json()
    assert {m["model_id"] for m in got} == {"m1", "m2"}
    assert all(m["provider_id"] == r.json()["id"] for m in got)

    # Strangers and other orgs see nothing.
    stranger = _mkuser("outsider")
    assert stranger.get(f"{ORG}/{oid}/models").status_code == 404
    other_oid = _mkorg(stranger)["id"]
    assert stranger.get(f"{ORG}/{other_oid}/models").json() == []

    # Removing the provider's models empties the listing (soft-delete path).
    for m in db.scalars(select(_AIModel).where(
            _AIModel.provider_id == uuid.UUID(r.json()["id"]))).all():
        m.is_deleted = True
    db.commit()
    assert client.get(f"{ORG}/{oid}/models").json() == []


# --- org key updates (metadata/policy/IP/models/rotate) ----------------------


def _org_two_models(c: TestClient, db, oid: str, name: str) -> tuple[str, str, str]:
    """Org provider with two chat models; returns (provider_id, m1_id, m2_id)."""
    from tollms.models.registered_model import AIModel

    p = c.post(f"{ORG}/{oid}/providers/register", json={
        "name": name, "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"},
        "models": [
            {"model_id": f"{name}-m1", "name": f"{name} M1",
             "endpoint_type": "chat_completions",
             "input_price": "1", "output_price": "2"},
            {"model_id": f"{name}-m2", "name": f"{name} M2",
             "endpoint_type": "chat_completions",
             "input_price": "1", "output_price": "2"},
        ]})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]
    mids = db.scalars(select(AIModel.id).where(
        AIModel.provider_id == uuid.UUID(pid))).all()
    assert len(mids) == 2
    return pid, str(mids[0]), str(mids[1])


def _chat_body(pid: str, mid: str, kid: str) -> dict:
    return {"provider_id": pid, "model_id": mid, "message": "hi",
            "key_id": kid}


def _run_chat_ok(db, pid: str, mid: str, kid: str, uid: str):
    """Drive the in-app chat plane directly with a mock transport."""
    import asyncio

    from tollms.api.gateway import service as chat_gateway
    from tollms.api.gateway.schemas import ChatRequest

    return asyncio.run(chat_gateway.run_chat(
        db,
        ChatRequest(provider_id=uuid.UUID(pid), model_id=uuid.UUID(mid),
                    message="hi", key_id=uuid.UUID(kid)),
        _mock_transport(), user_id=uuid.UUID(uid),
    ))


def _mock_transport():
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chat/completions"
        body = (
            'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
            'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
            'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, '
            '"completion_tokens": 5, "total_tokens": 15}}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, content=body.encode(),
                              headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler)


def _ext_body(provider_name: str, model_name: str) -> dict:
    return {"model": f"{provider_name}/{model_name}",
            "messages": [{"role": "user", "content": "hi"}]}


def test_org_key_update_metadata_preserves_secret(client: TestClient, db, user_factory) -> None:
    """PATCH edits metadata only: hash/prefix/rotation/created unchanged."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    created = _issue(client, oid, root_id, description="before")
    kid, raw = created["key"]["id"], created["raw_key"]
    before = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    old_hash, old_prefix, old_count, old_created = (
        before.key_hash, before.key_prefix, before.rotation_count, before.created_at)

    r = client.patch(f"{ORG}/{oid}/keys/{kid}", json={
        "name": "renamed", "description": "after", "enabled": True,
        "expires_at": "2030-01-01T00:00:00Z"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "renamed" and body["description"] == "after"
    assert body["key_prefix"] == old_prefix
    assert "key_hash" not in r.text and raw not in r.text

    db.expire_all()
    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    assert stored.key_hash == old_hash
    assert stored.key_prefix == old_prefix
    assert stored.rotation_count == old_count
    assert stored.created_at == old_created
    # Same secret still authenticates.
    assert key_engine.authenticate(db, raw) is not None


def test_org_key_update_requires_keys_update(client: TestClient, db, user_factory) -> None:
    """Strangers, unpermitted members, and foreign orgs all 404."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    member_set = _member_set_id(client, oid)
    sub = _mkuser("noupdate")
    sub_id = _me(sub)["id"]
    _invite_and_accept(client, sub, db, oid, [member_set])
    kid = _issue(client, oid, root_id)["key"]["id"]

    assert sub.patch(f"{ORG}/{oid}/keys/{kid}", json={"name": "x"}).status_code == 404
    assert sub.put(f"{ORG}/{oid}/keys/{kid}/policy", json={}).status_code == 404
    assert sub.post(f"{ORG}/{oid}/keys/{kid}/rotate").status_code == 404
    stranger = _mkuser("stranger")
    assert stranger.patch(f"{ORG}/{oid}/keys/{kid}", json={"name": "x"}).status_code == 404

    other_oid = _mkorg(sub)["id"]
    assert sub.patch(f"{ORG}/{other_oid}/keys/{kid}", json={"name": "x"}).status_code == 404

    # Assignee without Keys.Update can still read their own key.
    assert sub.get(f"{ORG}/{oid}/keys").status_code == 404  # no Keys.Read either
    reader_set = _make_set(client, oid, "Reader", ["Keys.Read"])
    _invite_and_accept(client, _mkuser("reader"), db, oid, [reader_set])


def test_org_key_update_validation_is_atomic(client: TestClient, db, user_factory) -> None:
    """Invalid payloads 422 with nothing persisted."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    kid = _issue(client, oid, root_id, description="keep")["key"]["id"]

    bad = client.patch(f"{ORG}/{oid}/keys/{kid}",
                       json={"expires_at": "2000-01-01T00:00:00Z"})
    assert bad.status_code == 422, bad.text
    bad = client.put(f"{ORG}/{oid}/keys/{kid}/ip-rules",
                     json=[{"type": "deny", "cidr": "not-a-cidr"}])
    assert bad.status_code == 422, bad.text
    bad = client.put(f"{ORG}/{oid}/keys/{kid}/model-permissions",
                     json=[{"provider_id": str(uuid.uuid4()), "model_id": None}])
    assert bad.status_code == 422, bad.text
    bad = client.put(f"{ORG}/{oid}/keys/{kid}/policy",
                     json={"rpm": -1})
    assert bad.status_code == 422, bad.text

    db.expire_all()
    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    assert stored.description == "keep"
    assert stored.expires_at is None
    assert stored.policy is None
    assert stored.ip_rules == []
    assert stored.model_permissions == []


def test_org_key_policy_change_enforced_both_planes(
        client: TestClient, db, user_factory, monkeypatch) -> None:
    """A restrictive PUT policy denies chat AND external calls with same key."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    pid, m1, _m2 = _org_two_models(client, db, oid, "PolProv")
    created = _issue(client, oid, root_id,
                     model_permissions=[{"provider_id": pid, "model_id": m1}])
    kid, raw = created["key"]["id"], created["raw_key"]
    _bind_mock(monkeypatch)

    # Permissive policy: both planes serve.
    ok = client.put(f"{ORG}/{oid}/keys/{kid}/policy",
                    json={"max_budget_usd": "100.00"})
    assert ok.status_code == 200, ok.text
    ext = client.post("/v1/chat/completions", json=_ext_body("PolProv", "PolProv-m1"),
                      headers={"Authorization": f"Bearer {raw}"})
    assert ext.status_code == 200, ext.text
    resp = _run_chat_ok(db, pid, m1, kid, root_id)
    assert resp.content, "chat plane should serve under permissive policy"

    # Restrictive policy: same secret denied on both planes, reason budget.
    denied = client.put(f"{ORG}/{oid}/keys/{kid}/policy",
                        json={"max_budget_usd": "0"})
    assert denied.status_code == 200, denied.text
    ext2 = client.post("/v1/chat/completions", json=_ext_body("PolProv", "PolProv-m1"),
                       headers={"Authorization": f"Bearer {raw}"})
    assert ext2.status_code == 403, ext2.text
    chat2 = client.post("/api/v1/gateway/chat", json=_chat_body(pid, m1, kid))
    assert chat2.status_code == 403, chat2.text
    with pytest.raises(ForbiddenError):
        _run_chat_ok(db, pid, m1, kid, root_id)


def test_org_key_ip_deny_enforced_both_planes(
        client: TestClient, db, user_factory, monkeypatch) -> None:
    """Deny-all IP rules deny chat AND external calls with same key."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    pid, m1, _m2 = _org_two_models(client, db, oid, "IpProv")
    created = _issue(client, oid, root_id,
                     model_permissions=[{"provider_id": pid, "model_id": m1}])
    kid, raw = created["key"]["id"], created["raw_key"]
    _bind_mock(monkeypatch)

    ext = client.post("/v1/chat/completions", json=_ext_body("IpProv", "IpProv-m1"),
                      headers={"Authorization": f"Bearer {raw}"})
    assert ext.status_code == 200, ext.text
    resp = _run_chat_ok(db, pid, m1, kid, root_id)
    assert resp.content, "chat plane should serve before IP restriction"

    r = client.put(f"{ORG}/{oid}/keys/{kid}/ip-rules",
                   json=[{"type": "deny", "cidr": "0.0.0.0/0"}])
    assert r.status_code == 200, r.text
    ext2 = client.post("/v1/chat/completions", json=_ext_body("IpProv", "IpProv-m1"),
                       headers={"Authorization": f"Bearer {raw}"})
    assert ext2.status_code == 403, ext2.text
    chat2 = client.post("/api/v1/gateway/chat", json=_chat_body(pid, m1, kid))
    assert chat2.status_code == 403, chat2.text
    with pytest.raises(ForbiddenError):
        _run_chat_ok(db, pid, m1, kid, root_id)

    # Clearing restores access without touching the secret.
    r = client.put(f"{ORG}/{oid}/keys/{kid}/ip-rules", json=[])
    assert r.status_code == 200, r.text
    ext3 = client.post("/v1/chat/completions", json=_ext_body("IpProv", "IpProv-m1"),
                       headers={"Authorization": f"Bearer {raw}"})
    assert ext3.status_code == 200, ext3.text


def test_org_key_model_permissions_enforced_both_planes(
        client: TestClient, db, user_factory, monkeypatch) -> None:
    """Narrowing the allow-list denies both planes; widening restores."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    pid, m1, m2 = _org_two_models(client, db, oid, "ModProv")
    created = _issue(client, oid, root_id,
                     model_permissions=[{"provider_id": pid, "model_id": m1}])
    kid, raw = created["key"]["id"], created["raw_key"]
    _bind_mock(monkeypatch)

    r = client.put(f"{ORG}/{oid}/keys/{kid}/model-permissions",
                   json=[{"provider_id": pid, "model_id": m2}])
    assert r.status_code == 200, r.text
    ext = client.post("/v1/chat/completions", json=_ext_body("ModProv", "ModProv-m1"),
                      headers={"Authorization": f"Bearer {raw}"})
    assert ext.status_code == 403, ext.text
    assert "model_not_allowed" in ext.json()["error"]["message"]
    chat = client.post("/api/v1/gateway/chat", json=_chat_body(pid, m1, kid))
    assert chat.status_code == 403, chat.text
    with pytest.raises(ForbiddenError):
        _run_chat_ok(db, pid, m1, kid, root_id)

    r = client.put(f"{ORG}/{oid}/keys/{kid}/model-permissions", json=[])
    assert r.status_code == 200, r.text
    ext2 = client.post("/v1/chat/completions", json=_ext_body("ModProv", "ModProv-m1"),
                       headers={"Authorization": f"Bearer {raw}"})
    assert ext2.status_code == 200, ext2.text


def test_org_key_rotate_changes_secret_preserves_history(
        client: TestClient, db, user_factory, monkeypatch) -> None:
    """Rotate swaps hash/prefix (old raw dies, new works); usage history kept."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    pid, m1, _m2 = _org_two_models(client, db, oid, "RotProv")
    created = _issue(client, oid, root_id,
                     model_permissions=[{"provider_id": pid, "model_id": m1}])
    kid, raw = created["key"]["id"], created["raw_key"]
    before = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    old_prefix, old_created = before.key_prefix, before.created_at
    _bind_mock(monkeypatch)

    ok = client.post("/v1/chat/completions", json=_ext_body("RotProv", "RotProv-m1"),
                     headers={"Authorization": f"Bearer {raw}"})
    assert ok.status_code == 200, ok.text

    r = client.post(f"{ORG}/{oid}/keys/{kid}/rotate")
    assert r.status_code == 200, r.text
    new_raw, body = r.json()["raw_key"], r.json()["key"]
    assert new_raw != raw
    assert body["key_prefix"] != old_prefix
    assert body["rotation_count"] == 1
    assert "key_hash" not in r.text and new_raw not in str(body)

    # Old secret dead everywhere; new secret works.
    dead = client.post("/v1/chat/completions", json=_ext_body("RotProv", "RotProv-m1"),
                       headers={"Authorization": f"Bearer {raw}"})
    assert dead.status_code in (401, 404), dead.text
    live = client.post("/v1/chat/completions", json=_ext_body("RotProv", "RotProv-m1"),
                       headers={"Authorization": f"Bearer {new_raw}"})
    assert live.status_code == 200, live.text

    db.expire_all()
    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    assert stored.created_at == old_created
    assert stored.key_hash == key_engine.hash_key(new_raw)
    # Historical usage rows still reference the same logical key.
    rows = db.scalars(select(ApiRequestLog).where(
        ApiRequestLog.api_key_id == uuid.UUID(kid))).all()
    assert len(rows) >= 1


def test_org_key_policy_update_respects_org_cap(
        client: TestClient, db, user_factory) -> None:
    """Raising a key budget past the unallocated org cap is rejected."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    assert client.patch(f"{ORG}/{oid}/budget", json={"max_spend": "10.00"}).status_code == 200
    kid = _issue_full(client, oid, root_id,
                       policy={"max_budget_usd": "6.00"})["key"]["id"]

    r = client.put(f"{ORG}/{oid}/keys/{kid}/policy",
                   json={"max_budget_usd": "11.00"})
    assert r.status_code == 422, r.text
    ok = client.put(f"{ORG}/{oid}/keys/{kid}/policy",
                    json={"max_budget_usd": "4.00", "rpm": 5})
    assert ok.status_code == 200, ok.text
    db.expire_all()
    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))
    assert stored.policy is not None
    assert Decimal(stored.policy.max_budget_usd) == Decimal("4.00")
    assert stored.policy.rpm == 5


def test_org_key_disabled_via_patch_denied_both_planes(
        client: TestClient, db, user_factory, monkeypatch) -> None:
    """PATCH enabled=false blocks chat and external; re-enable restores."""
    user_factory()
    root_id = _me(client)["id"]
    oid = _mkorg(client)["id"]
    pid, m1, _m2 = _org_two_models(client, db, oid, "DisProv")
    created = _issue(client, oid, root_id,
                     model_permissions=[{"provider_id": pid, "model_id": m1}])
    kid, raw = created["key"]["id"], created["raw_key"]
    _bind_mock(monkeypatch)

    assert client.patch(f"{ORG}/{oid}/keys/{kid}",
                        json={"enabled": False}).status_code == 200
    ext = client.post("/v1/chat/completions", json=_ext_body("DisProv", "DisProv-m1"),
                      headers={"Authorization": f"Bearer {raw}"})
    assert ext.status_code == 403, ext.text
    # Chat uses the 404 oracle for disabled keys (no existence leak).
    chat = client.post("/api/v1/gateway/chat", json=_chat_body(pid, m1, kid))
    assert chat.status_code == 404, chat.text
    with pytest.raises(NotFoundError):
        _run_chat_ok(db, pid, m1, kid, root_id)

    assert client.patch(f"{ORG}/{oid}/keys/{kid}",
                        json={"enabled": True}).status_code == 200
    ext2 = client.post("/v1/chat/completions", json=_ext_body("DisProv", "DisProv-m1"),
                       headers={"Authorization": f"Bearer {raw}"})
    assert ext2.status_code == 200, ext2.text
