"""Workspace overhaul acceptance: permission prereqs, conversation paging,
grouped search hygiene, audit titles, guardrail scope oracles."""

import json

ORG = "/api/v1/orgs"
G = "/api/v1/guardrails"


def test_permission_prerequisite_rejected(client, user_factory) -> None:
    """Update-without-Read is a 422 (prerequisite ladder), not silent."""
    user_factory()
    oid = client.post(ORG, json={"name": "Prereq Org"}).json()["id"]
    bad = client.post(f"{ORG}/{oid}/sets",
                      json={"name": "Bad", "permissions": ["Members.Update"]})
    assert bad.status_code == 422, bad.text
    ok = client.post(f"{ORG}/{oid}/sets",
                     json={"name": "Good",
                           "permissions": ["Members.Read", "Members.Update"]})
    assert ok.status_code == 201, ok.text


def test_conversation_pagination_no_dupes(client, user_factory) -> None:
    user_factory()
    for i in range(25):
        r = client.post("/api/v1/conversations", json={"title": f"Paged {i:02d}"})
        assert r.status_code == 201, r.text
    page1 = client.get("/api/v1/conversations", params={"limit": 20})
    assert page1.status_code == 200
    assert len(page1.json()) == 20
    cursor = page1.headers.get("X-Next-Cursor")
    assert cursor, "expected X-Next-Cursor when more rows remain"
    page2 = client.get("/api/v1/conversations",
                       params={"limit": 20, "cursor": cursor})
    assert page2.status_code == 200
    ids1 = {c["id"] for c in page1.json()}
    ids2 = [c["id"] for c in page2.json()]
    assert len(ids2) == 5
    assert not (ids1 & set(ids2)), "pages must not overlap"


def test_search_types_members_teams_no_secrets(client, user_factory) -> None:
    user_factory("searcher@tollma.ai")
    oid = client.post(ORG, json={"name": "Searcher Org"}).json()["id"]
    team = client.post(f"{ORG}/{oid}/teams", json={"name": "Searcher Team"})
    assert team.status_code == 201, team.text
    body = client.get("/api/v1/search",
                      params={"q": "searcher", "types": "members,teams",
                              "org_id": oid}).json()
    groups = body.get("groups", {})
    assert "members" in groups and "teams" in groups
    assert len(groups["members"]) >= 1
    assert len(groups["teams"]) >= 1
    for items in groups.values():
        for item in items:
            assert set(item) <= {"id", "type", "title", "subtitle",
                                 "snippet", "created_at"}, item
    blob = json.dumps(body).lower()
    for needle in ("credential", "raw_key", "raw-key", "secret",
                   "password", "api_key_value", "key_hash"):
        assert needle not in blob, f"leaked {needle!r} in grouped search"


def test_audit_display_title_and_unknown_fallback(client, user_factory) -> None:
    from tollms.api.orgs.common.audit_registry import format_event

    user_factory()
    oid = client.post(ORG, json={"name": "Audit Org"}).json()["id"]
    rows = client.get(f"{ORG}/{oid}/audit").json()
    assert len(rows) >= 1
    for row in rows:
        assert row.get("display_title"), row
    assert format_event("org.created") == "Organization created"
    human = format_event("some.totally_fake-action_xyz")
    assert human != "Unknown event"
    assert human == "Some Totally Fake Action Xyz"


def test_browser_can_read_pagination_cursor() -> None:
    """Browsers can only read X-Next-Cursor if CORS exposes it."""
    from tollms.main import app

    cors = [m for m in app.user_middleware if "CORS" in str(m.cls)]
    assert cors, "CORS middleware must be registered"
    assert "X-Next-Cursor" in cors[0].kwargs.get("expose_headers", [])


def test_search_like_wildcards_literal(client, user_factory) -> None:
    """`%`/`_` in search text must not act as wildcards."""
    user_factory()
    r = client.post("/api/v1/conversations", json={"title": "100% coverage_done"})
    assert r.status_code == 201, r.text
    hit = client.get("/api/v1/conversations", params={"search": "100% coverage"}).json()
    assert len(hit) == 1, hit
    miss = client.get("/api/v1/conversations", params={"search": "100 coverage"}).json()
    assert miss == [], miss


def test_audit_offset_capped(client, user_factory) -> None:
    """Unbounded offsets are clamped, never a deep-scan denial vector."""
    user_factory("cap@tollma.ai")
    oid = client.post(ORG, json={"name": "Cap Org"}).json()["id"]
    rows = client.get(f"{ORG}/{oid}/audit", params={"limit": 100, "cursor": "999999"}).json()
    assert isinstance(rows, list)


def test_guardrail_forged_provider_scope_rejected(
    client, user_factory, provider_factory
) -> None:
    """A provider_id owned by another user is a 404 oracle, never leaked."""
    user_factory("owner@tollma.ai")
    foreign_pid = provider_factory("Mine")["id"]
    client.post("/auth/logout")
    user_factory("intruder@tollma.ai")
    r = client.post(G, json={
        "name": "Forged",
        "assignments": [{"scope_type": "provider",
                         "provider_id": foreign_pid}],
    })
    assert r.status_code == 404, r.text


def test_org_patch_unknown_visibility_field_ignored(client, user_factory) -> None:
    """Removed identifiers stay removed: visibility_mode is unknown to OrgUpdate.

    Pydantic default is ignore (200, silently dropped) but a future
    extra="forbid" would 422 — accept either, but in both cases nothing
    changes and no visibility fields leak into the response.
    """
    user_factory()
    oid = client.post(ORG, json={"name": "No Privacy Org", "description": "keep me"}).json()["id"]
    before = client.get(f"{ORG}/{oid}").json()
    r = client.patch(f"{ORG}/{oid}", json={"visibility_mode": "private"})
    assert r.status_code in (200, 422), r.text
    if r.status_code == 200:
        body = r.json()
        assert "visibility_mode" not in body, body
        assert "personal_sharing_enforced" not in body, body
    after = client.get(f"{ORG}/{oid}").json()
    assert after["description"] == before["description"] == "keep me"
    assert "visibility_mode" not in after
    assert "personal_sharing_enforced" not in after


def test_org_policy_changed_fallback_humanized() -> None:
    """No org.policy_changed registry entry needed — fallback humanizes legacy."""
    from tollms.api.orgs.common.audit_registry import EVENT_REGISTRY, format_event

    assert "org.policy_changed" not in EVENT_REGISTRY
    assert format_event("org.policy_changed") == "Org Policy Changed"


def test_search_like_percent_literal_with_decoy(client, user_factory) -> None:
    """`%` in search text is literal: decoy without `%` must not match."""
    user_factory()
    r1 = client.post("/api/v1/conversations", json={"title": "100% coverage_done"})
    assert r1.status_code == 201, r1.text
    r2 = client.post("/api/v1/conversations", json={"title": "100X coverage_done"})
    assert r2.status_code == 201, r2.text
    hit = client.get("/api/v1/conversations", params={"search": "100% coverage"}).json()
    titles = [c["title"] for c in hit]
    assert "100% coverage_done" in titles, titles
    assert "100X coverage_done" not in titles, titles


def test_search_like_underscore_literal_with_decoy(client, user_factory) -> None:
    """`_` in search text is literal: decoy with a different char must not match."""
    user_factory()
    r1 = client.post("/api/v1/conversations", json={"title": "alpha_beta report"})
    assert r1.status_code == 201, r1.text
    r2 = client.post("/api/v1/conversations", json={"title": "alphaXbeta report"})
    assert r2.status_code == 201, r2.text
    hit = client.get("/api/v1/conversations", params={"search": "alpha_beta"}).json()
    titles = [c["title"] for c in hit]
    assert "alpha_beta report" in titles, titles
    assert "alphaXbeta report" not in titles, titles


def test_teams_search_underscore_literal(client, user_factory) -> None:
    """Org teams ?search= escapes `_` (literal, not single-char wildcard)."""
    user_factory()
    oid = client.post(ORG, json={"name": "Underscore Org"}).json()["id"]
    for name in ("alpha_beta", "alphaXbeta"):
        r = client.post(f"{ORG}/{oid}/teams", json={"name": name})
        assert r.status_code == 201, r.text
    body = client.get(f"{ORG}/{oid}/teams", params={"search": "alpha_beta"}).json()
    names = [t["name"] for t in body] if isinstance(body, list) else [
        t["name"] for t in body.get("teams", body.get("items", []))]
    assert "alpha_beta" in names, names
    assert "alphaXbeta" not in names, names


def test_conversation_offset_capped(client, user_factory) -> None:
    """Huge cursor offset is clamped: 200 with bounded rows, never 500."""
    user_factory()
    r = client.post("/api/v1/conversations", json={"title": "Cap Probe"})
    assert r.status_code == 201, r.text
    resp = client.get("/api/v1/conversations", params={"limit": 20, "cursor": "999999"})
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) <= 20, rows


def test_audit_offset_capped_status_and_bound(client, user_factory) -> None:
    """Huge audit cursor returns 200 with bounded rows."""
    user_factory("cap2@tollma.ai")
    oid = client.post(ORG, json={"name": "Cap Org 2"}).json()["id"]
    resp = client.get(f"{ORG}/{oid}/audit", params={"limit": 100, "cursor": "999999"})
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) <= 100, rows


def test_org_patch_visibility_x_ignored_and_get_clean(client, user_factory) -> None:
    """PATCH {"visibility_mode": "x"} is ignored/rejected; GET leaks nothing."""
    user_factory()
    oid = client.post(ORG, json={"name": "No Privacy Org X"}).json()["id"]
    r = client.patch(f"{ORG}/{oid}", json={"visibility_mode": "x"})
    assert r.status_code in (200, 422), r.text
    if r.status_code == 200:
        assert "visibility_mode" not in r.json()
    body = client.get(f"{ORG}/{oid}").json()
    assert isinstance(body, dict), body
    assert "visibility_mode" not in body, body
    assert "personal_sharing_enforced" not in body, body


def test_org_policy_changed_never_unknown_event() -> None:
    """format_event("org.policy_changed") is a humanized fallback, not Unknown."""
    from tollms.api.orgs.common.audit_registry import format_event

    human = format_event("org.policy_changed")
    assert human != "Unknown event", human
    assert human == "Org Policy Changed", human
