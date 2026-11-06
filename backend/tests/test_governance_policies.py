"""Governance: provider-policy registry seed, CRUD perms, stale query."""

import uuid
from datetime import date

import tollms.models.governance  # noqa: F401  (register tables; Wave 3 wires models/__init__)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.main import app
from tollms.api.governance.router import router as _gov_router

if not any(
    getattr(r, "path", None) == "/api/v1/governance/provider-policies"
    for r in app.routes
):
    # Wave 3 (orchestrator) wires main.py; tests register the router directly.
    app.include_router(_gov_router)

G = "/api/v1/governance/provider-policies"


def _other_client(email: str) -> TestClient:
    other = TestClient(app)
    r = other.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        v = other.get("/auth/verify", params={"token": token})
        assert v.status_code == 200, v.text
    return other


def _promote(db: Session, user_id: str) -> None:
    from tollms.models.user import PlatformRole, User

    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def test_seed_and_list_global(client: TestClient, user_factory) -> None:
    user_factory()
    rows = client.get(G).json()
    assert len(rows) == 6, [r["provider_key"] for r in rows]
    assert {r["provider_key"] for r in rows} == {
        "OPENAI", "ANTHROPIC_MESSAGES", "GEMINI",
        "VERTEX_AI", "BEDROCK_CONVERSE", "CUSTOM",
    }
    # Fresh seed is never reviewed -> stale everywhere, no fabricated URLs.
    assert all(r["stale"] for r in rows)
    assert all(r["terms_url"] is None and r["aup_url"] is None for r in rows)
    assert all(r["source_notes"] == "unverified - hand seed, curator review required"
              for r in rows)


def test_global_write_requires_admin(client: TestClient, db: Session, user_factory) -> None:
    me = user_factory()
    assert len(client.get(G).json()) == 6  # seed first (tables truncate between tests)
    body = {"provider_key": "OPENAI", "display_name": "Dup",
            "scope": "global", "training_on_inputs": "unknown"}
    assert client.post(G, json=body).status_code == 403
    _promote(db, me["id"])
    assert client.post(G, json=body).status_code == 409  # seed row exists
    r = client.post(G, json={**body, "training_on_inputs": "maybe"})
    assert r.status_code == 422, r.text
    r = client.post(G, json={"provider_key": "X", "display_name": "X",
                             "scope": "organization"})
    assert r.status_code == 422, r.text  # org scope needs org_id


def test_update_marks_fresh_and_delete(client: TestClient, db: Session, user_factory) -> None:
    me = user_factory()
    _promote(db, me["id"])
    pid = next(r["id"] for r in client.get(G).json() if r["provider_key"] == "GEMINI")
    r = client.patch(f"{G}/{pid}", json={"last_reviewed_at": date.today().isoformat(),
                                         "terms_url": "https://example.invalid/terms"})
    assert r.status_code == 200, r.text
    assert r.json()["stale"] is False
    assert client.delete(f"{G}/{pid}").status_code == 204
    assert client.get(f"{G}/{pid}").status_code == 404


def test_org_row_member_read_stranger_404(
    client: TestClient, db: Session, user_factory
) -> None:
    me = user_factory(email="owner@tollma.ai")
    _promote(db, me["id"])
    oid = client.post("/api/v1/orgs", json={"name": "Gov Org"}).json()["id"]
    r = client.post(G, json={"provider_key": "OPENAI", "display_name": "Org OpenAI",
                             "scope": "organization", "org_id": oid})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert any(p["id"] == pid for p in client.get(G).json())
    assert client.get(f"{G}/{pid}").status_code == 200

    other = _other_client("stranger@tollma.ai")
    assert all(p["id"] != pid for p in other.get(G).json())
    assert other.get(f"{G}/{pid}").status_code == 404


def test_stale_query(client: TestClient, db: Session, user_factory) -> None:
    me = user_factory()
    _promote(db, me["id"])
    assert len(client.get(f"{G}/stale").json()) == 6
    pid = client.get(G).json()[0]["id"]
    client.patch(f"{G}/{pid}", json={"last_reviewed_at": date.today().isoformat()})
    stale = client.get(f"{G}/stale").json()
    assert len(stale) == 5
    assert all(r["id"] != pid for r in stale)
