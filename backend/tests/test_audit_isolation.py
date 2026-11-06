"""Independent security audit (Agent H): tenant isolation, legal, consent, exports, OpenAPI.

Read-only vs production source: HTTP + service-level probes only.
Uses the main-app `client` fixture for the get_db override; extra users get
fresh TestClient(app) instances sharing that override.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.main import app

import tollms.models.conversation  # noqa: F401 — register tables
import tollms.models.legal  # noqa: F401
import tollms.models.privacy  # noqa: F401


def _mkuser(tag: str) -> TestClient:
    c = TestClient(app)
    email = f"audit-{tag}-{uuid.uuid4().hex[:8]}@tollma.ai"
    r = c.post(
        "/auth/signup",
        json={"email": email, "password": "Password123", "age_confirmed": True},
    )
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = c.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return c


def _provider(c: TestClient, name: str) -> dict:
    r = c.post(
        "/api/v1/providers",
        json={"name": name, "provider_type": "CUSTOM",
              "credentials": {"base_url": "http://mock"}},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _conv(c: TestClient, title: str) -> dict:
    r = c.post("/api/v1/conversations", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()


def _key(c: TestClient, name: str) -> dict:
    r = c.post("/api/v1/keys", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


# --- 1. tenant isolation: 404-oracle (never 403/leak) --------------------------


def test_provider_cross_user_404(client: TestClient, db: Session) -> None:
    a, b = _mkuser("iso-pa"), _mkuser("iso-pb")
    p = _provider(a, "A-Prov")
    pid = p["id"]
    assert b.get(f"/api/v1/providers/{pid}").status_code == 404
    assert b.patch(f"/api/v1/providers/{pid}", json={"name": "hijack"}).status_code == 404
    assert b.delete(f"/api/v1/providers/{pid}").status_code == 404
    ids = [x["id"] for x in b.get("/api/v1/providers").json()]
    assert pid not in ids


def test_conversation_cross_user_404(client: TestClient, db: Session) -> None:
    a, b = _mkuser("iso-ca"), _mkuser("iso-cb")
    conv = _conv(a, "A secret plan")
    cid = conv["id"]
    assert b.get(f"/api/v1/conversations/{cid}").status_code == 404
    assert b.patch(f"/api/v1/conversations/{cid}", json={"title": "x"}).status_code == 404
    assert b.delete(f"/api/v1/conversations/{cid}").status_code == 404
    assert b.get(f"/api/v1/conversations/{cid}/messages").status_code == 404
    titles = [x["title"] for x in b.get("/api/v1/conversations").json()]
    assert "A secret plan" not in titles


def test_apikey_cross_user_404(client: TestClient, db: Session) -> None:
    a, b = _mkuser("iso-ka"), _mkuser("iso-kb")
    k = _key(a, "A-Key")
    kid = k["key"]["id"]
    assert b.get(f"/api/v1/keys/{kid}").status_code == 404
    assert b.post(f"/api/v1/keys/{kid}/rotate").status_code == 404
    assert b.delete(f"/api/v1/keys/{kid}").status_code == 404
    names = [x["name"] for x in b.get("/api/v1/keys").json()]
    assert "A-Key" not in names


def test_privacy_cross_user_isolation(client: TestClient, db: Session) -> None:
    a, b = _mkuser("iso-va"), _mkuser("iso-vb")
    assert a.put("/api/v1/privacy/consents",
                 json={"category": "analytics", "granted": True}).status_code == 200
    d = a.post("/api/v1/privacy/dsr", json={"type": "access"}).json()
    assert b.get("/api/v1/privacy/consents").json() == []
    assert b.get("/api/v1/privacy/dsr").json() == []
    assert b.get(f"/api/v1/privacy/dsr/{d['id']}").status_code == 404
    assert b.patch(f"/api/v1/privacy/dsr/{d['id']}",
                   json={"to_status": "under_review"}).status_code == 404


def test_org_retention_stranger_404(client: TestClient, db: Session) -> None:
    a, b = _mkuser("iso-oa"), _mkuser("iso-ob")
    r = a.post("/api/v1/orgs", json={"name": "Audit Org"})
    assert r.status_code == 201, r.text
    oid = r.json()["id"]
    s = a.put("/api/v1/privacy/retention",
              json={"data_category": "prompt_logs", "retention_days": 30,
                    "org_id": oid})
    assert s.status_code == 200, s.text
    # Stranger to the org: 404, never 403 (no existence oracle).
    assert b.get("/api/v1/privacy/retention", params={"org_id": oid}).status_code == 404


# --- 13. export isolation ------------------------------------------------------


def test_export_endpoints_reject_other_users_conversations(
    client: TestClient, db: Session
) -> None:
    a, b = _mkuser("iso-ea"), _mkuser("iso-eb")
    conv = _conv(a, "A export secret")
    cid = conv["id"]
    assert b.post("/api/v1/exports/conversations",
                  json={"conversation_ids": [cid]}).status_code == 404
    assert b.get(f"/api/v1/exports/conversations/{cid}").status_code == 404


def test_full_account_export_excludes_other_users(
    client: TestClient, db: Session
) -> None:
    a, b = _mkuser("iso-fa"), _mkuser("iso-fb")
    conv = _conv(a, "A private export marker")
    bundle = b.get("/api/v1/privacy/export").json()
    assert bundle["conversations"] == []
    own = a.get("/api/v1/privacy/export").json()
    assert any(c["id"] == conv["id"] for c in own["conversations"])


# --- 4. legal: immutability, idempotency, reaccept, no UPDATE/DELETE -----------


def test_legal_published_immutable_idempotent_reaccept(
    client: TestClient, db: Session
) -> None:
    from tollms.api.legal import service as legal_service
    from tollms.core.exceptions import ConflictError

    u = _mkuser("iso-legal")
    legal_service.upsert_document(
        db, slug="audit-terms", version="1.0.0", title="Audit Terms",
        locale="en-IN", body="# Terms\nv1", requires_reaccept=True,
        effective_at=None, publish=True,
    )
    first = u.post("/api/v1/legal/acceptances", json={"slug": "audit-terms"})
    assert first.status_code == 200, first.text
    again = u.post("/api/v1/legal/acceptances", json={"slug": "audit-terms"})
    assert again.json()["id"] == first.json()["id"]  # idempotent on hash
    # Published version immutable.
    try:
        legal_service.upsert_document(
            db, slug="audit-terms", version="1.0.0", title="X",
            locale="en-IN", body="# Terms\nchanged", requires_reaccept=True,
            effective_at=None, publish=False,
        )
    except ConflictError:
        pass
    else:
        raise AssertionError("published version must be immutable")
    # MAJOR bump with reaccept flag surfaces in reaccept-required, then clears.
    legal_service.upsert_document(
        db, slug="audit-terms", version="2.0.0", title="Audit Terms v2",
        locale="en-IN", body="# Terms\nv2", requires_reaccept=True,
        effective_at=None, publish=True,
    )
    pending = u.get("/api/v1/legal/reaccept-required").json()
    assert any(d["slug"] == "audit-terms" and d["version"] == "2.0.0"
               for d in pending)
    assert u.post("/api/v1/legal/acceptances",
                  json={"slug": "audit-terms"}).status_code == 200
    pending2 = u.get("/api/v1/legal/reaccept-required").json()
    assert not [d for d in pending2 if d["slug"] == "audit-terms"]


def test_legal_router_has_no_update_delete_paths() -> None:
    from tollms.api.legal.router import router

    methods = {(r.path, m) for r in router.routes for m in (r.methods or set())}
    assert methods, "legal router has no routes?"
    for path, method in methods:
        assert method in {"GET", "POST"}, f"unexpected legal route {method} {path}"


# --- 12. consent ---------------------------------------------------------------


def test_consent_functional_withdraw_422_optional_withdraw_ok(
    client: TestClient, db: Session
) -> None:
    u = _mkuser("iso-consent")
    r = u.put("/api/v1/privacy/consents",
              json={"category": "functional", "granted": False})
    assert r.status_code == 422, r.text
    w = u.put("/api/v1/privacy/consents",
              json={"category": "analytics", "granted": False})
    assert w.status_code == 200, w.text
    assert w.json()["status"] == "withdrawn"
    assert w.json()["withdrawn_at"] is not None


# --- 15. OpenAPI contract ------------------------------------------------------


def test_openapi_no_duplicate_routes_and_trust_routers_present() -> None:
    spec = app.openapi()
    seen: set[tuple[str, str]] = set()
    dupes: list[tuple[str, str]] = []
    for path, methods in spec["paths"].items():
        for method in methods:
            key = (path, method.upper())
            if key in seen:
                dupes.append(key)
            seen.add(key)
    assert dupes == [], f"duplicate (path, method): {dupes}"
    for prefix in ("/api/v1/legal/", "/api/v1/privacy/", "/api/v1/security/",
                   "/api/v1/governance/", "/api/v1/incidents/reports/",
                   "/api/admin/compliance/", "/api/v1/subprocessors"):
        assert any(p.startswith(prefix) for p in spec["paths"]), prefix
