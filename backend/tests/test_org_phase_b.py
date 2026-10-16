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

    # Personal management endpoints cannot touch org keys (404 oracle).
    assert client.get(f"/api/v1/keys/{kid}").status_code == 404
    assert client.delete(f"/api/v1/keys/{kid}").status_code == 404
    assert client.post(f"/api/v1/keys/{kid}/rotate").status_code == 404

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

    # V1 list shows personal + org providers for members; raw secrets never leak.
    mine = {p["id"]: p for p in client.get("/api/v1/providers").json()}
    assert personal.json()["id"] in mine and org_pid in mine
    theirs = {p["id"]: p for p in sub.get("/api/v1/providers").json()}
    assert org_pid in theirs and personal.json()["id"] not in theirs
    assert "s3cr3t" not in sub.get("/api/v1/providers").text

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

    prov = client.post(f"{ORG}/{oid}/providers", json={
        "name": "OrgGW", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert prov.status_code == 201, prov.text
    model = client.post("/api/v1/models", json={
        "provider_id": prov.json()["id"], "model_id": "org-model",
        "name": "Org Model", "endpoint_type": "chat_completions",
        "input_price": "1", "output_price": "2"})
    assert model.status_code == 201, model.text

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


def _org_provider_with_model(c: TestClient, oid: str, name: str) -> tuple[str, str]:
    p = c.post(f"{ORG}/{oid}/providers", json={
        "name": name, "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]
    m = c.post("/api/v1/models", json={
        "provider_id": pid, "model_id": f"{name}-model", "name": f"{name} Model",
        "endpoint_type": "chat_completions", "input_price": "1", "output_price": "2"})
    assert m.status_code == 201, m.text
    return pid, m.json()["id"]


def test_org_key_rejects_cross_org_models(client: TestClient, db, user_factory) -> None:
    """A granter in two orgs cannot stamp org B's model onto an org A key."""
    user_factory()
    org_a = _mkorg(client, "ScopeA")["id"]
    org_b = _mkorg(client, "ScopeB")["id"]
    _, model_b = _org_provider_with_model(client, org_b, "ProvB")
    _, model_a = _org_provider_with_model(client, org_a, "ProvA")
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
    _, model_o = _org_provider_with_model(client, org, "OrgOnly")
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

    models = client.get("/api/v1/models", params={"provider_id": pid}).json()
    assert sorted(m["model_id"] for m in models) == ["m1", "m2"]

    audit = _audit_row(db, oid, "provider.created")
    assert audit is not None
    assert audit.target["provider_id"] == pid and audit.target["models_created"] == 2

    # Org-scoped uniqueness: same name rejected, nothing extra persisted.
    dup = client.post(f"{ORG}/{oid}/providers/register", json=_reg_payload())
    assert dup.status_code == 422, dup.text
    assert len(client.get(f"{ORG}/{oid}/providers").json()) == 1
    assert len(client.get("/api/v1/models", params={"provider_id": pid}).json()) == 2


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
    user_factory()
    oid = _mkorg(client)["id"]
    full = _make_set(client, oid, "ProvFull",
                     ["Providers.Create", "Providers.Read", "Providers.Update", "Providers.Delete"])
    bare = _mkuser("baremodel")
    empowered = _mkuser("fullmodel")
    _invite_and_accept(client, bare, db, oid, [_member_set_id(client, oid)])
    _invite_and_accept(client, empowered, db, oid, [full])

    prov = client.post(f"{ORG}/{oid}/providers", json={
        "name": "Gated", "provider_type": "CUSTOM",
        "credentials": {"base_url": "http://mock"}})
    assert prov.status_code == 201, prov.text
    pid = prov.json()["id"]

    seed = client.post("/api/v1/models", json={
        "provider_id": pid, "model_id": "seed", "name": "Seed",
        "endpoint_type": "chat_completions"})
    assert seed.status_code == 201, seed.text
    mid = seed.json()["id"]

    payload = {"provider_id": pid, "model_id": "x", "name": "X",
               "endpoint_type": "chat_completions"}
    # Visible but perm-less: all three ops are 404.
    assert bare.post("/api/v1/models", json=payload).status_code == 404
    assert bare.patch(f"/api/v1/models/{mid}", json={"name": "Nope"}).status_code == 404
    assert bare.delete(f"/api/v1/models/{mid}").status_code == 404
    assert client.get(f"/api/v1/models/{mid}").status_code == 200

    # Perm-holding member: all three ops succeed.
    created = empowered.post("/api/v1/models", json=payload)
    assert created.status_code == 201, created.text
    assert empowered.patch(f"/api/v1/models/{mid}", json={"name": "Renamed"}).status_code == 200
    assert empowered.delete(f"/api/v1/models/{created.json()['id']}").status_code == 204

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
