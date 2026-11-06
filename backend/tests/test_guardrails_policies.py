"""Guardrails API: CRUD, tenant isolation, templates, effective, triggers."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.main import app

G = "/api/v1/guardrails"


def _policy(name: str = "PII Guard", **kw) -> dict:
    body = {"name": name, "severity": "medium", "enforcement": "warn",
            "stage": "both", **kw}
    return body


def test_crud_personal(client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post(G, json=_policy())
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["is_enabled"] is False

    assert client.get(f"{G}/{pid}").status_code == 200
    r = client.patch(f"{G}/{pid}", json={"description": "d", "is_enabled": True})
    assert r.status_code == 200 and r.json()["is_enabled"] is True

    assert client.get(G).status_code == 200
    assert any(p["id"] == pid for p in client.get(G).json())

    assert client.delete(f"{G}/{pid}").status_code == 204
    assert client.get(f"{G}/{pid}").status_code == 404


def _verified_client(email: str) -> TestClient:
    other = TestClient(app)
    r = other.post("/auth/signup", json={"email": email, "password": "Password123", "age_confirmed": True})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        other.get("/auth/verify", params={"token": token})
    return other


def test_personal_isolation(client: TestClient, db: Session, user_factory) -> None:
    user_factory(email="a@tollma.ai")
    pid = client.post(G, json=_policy("Mine")).json()["id"]
    other = _verified_client("b@tollma.ai")
    assert other.get(f"{G}/{pid}").status_code == 404
    assert other.get(G).json() == []


def test_name_conflict(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.post(G, json=_policy("Dup")).status_code == 201
    assert client.post(G, json=_policy("Dup")).status_code == 409


def test_buffer_requires_post_stage(client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post(G, json=_policy("Buf", delivery_mode="buffer_then_inspect", stage="pre"))
    assert r.status_code == 422, r.text
    r = client.post(G, json=_policy("Buf2", delivery_mode="buffer_then_inspect", stage="post"))
    assert r.status_code == 201, r.text


def test_clone_enable_disable(client: TestClient, user_factory) -> None:
    user_factory()
    pid = client.post(G, json=_policy("Orig", rules=[{"category": "pii"}])).json()["id"]
    r = client.post(f"{G}/{pid}/clone")
    assert r.status_code == 201 and r.json()["name"].startswith("Orig (copy")
    assert client.post(f"{G}/{pid}/enable").json()["is_enabled"] is True
    assert client.post(f"{G}/{pid}/disable").json()["is_enabled"] is False


def test_templates_and_from_template(client: TestClient, user_factory) -> None:
    user_factory()
    rows = client.get(f"{G}/templates").json()
    assert len(rows) == 8, [t["key"] for t in rows]
    keys = {t["key"] for t in rows}
    assert {"content-safety", "prompt-injection", "secret-leakage", "pii",
            "unsafe-output", "structured-validation", "tool-safety",
            "org-boundary"} <= keys
    r = client.post(f"{G}/from-template/pii")
    assert r.status_code == 201, r.text
    assert r.json()["is_template"] is False
    assert client.post(f"{G}/from-template/nope").status_code == 404


def test_test_endpoint_dry_run_no_creds(client: TestClient, user_factory) -> None:
    user_factory()
    pid = client.post(G, json=_policy("Dry")).json()["id"]
    r = client.post(f"{G}/{pid}/test", json={"content": "hello world", "stage": "pre"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "allow" and body["action"] == "allowed"
    r = client.post(f"{G}/{pid}/test",
                    json={"content": "my email is a@tollma.ai", "stage": "pre"})
    assert r.json()["action"] == "warned"


def test_credentials_validate_stateless(client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post(f"{G}/credentials/validate",
                    json={"evaluator_type": "openai_moderation", "credentials": {}})
    assert r.status_code == 200 and r.json()["valid"] is False
    r = client.post(f"{G}/credentials/validate",
                    json={"evaluator_type": "deterministic"})
    assert r.json()["valid"] is True
    assert client.post(f"{G}/credentials/validate",
                       json={"evaluator_type": "nope"}).status_code == 422


def test_effective_and_org_isolation(client: TestClient, user_factory) -> None:
    user_factory(email="owner@tollma.ai")
    org = client.post("/api/v1/orgs", json={"name": "Guard Org"}).json()
    oid = org["id"]
    # Personal policy with no assignments = workspace-global.
    pid = client.post(G, json=_policy("Personal", is_enabled=True)).json()["id"]
    client.post(f"{G}/{pid}/enable")
    body = client.get(f"{G}/effective").json()
    assert any(p["id"] == pid for p in body["policies"])
    # Org policy invisible without membership-scoped query for strangers.
    other = _verified_client("stranger@tollma.ai")
    assert other.get(f"{G}/effective", params={"org_id": oid}).status_code == 404
    # Owner creates an org policy with the perm.
    r = client.post(G, json=_policy("OrgP", org_id=oid, enforcement="block",
                              rules=[{"category": "pii"}]))
    assert r.status_code == 201, r.text
    assert r.json()["org_id"] == oid


def test_triggers_filters(client: TestClient, user_factory) -> None:
    user_factory()
    assert client.get(f"{G}/triggers").json() == []
    assert client.get(f"{G}/triggers/{uuid.uuid4()}").status_code == 404


def test_block_enforcement_requires_rules(client: TestClient, user_factory) -> None:
    """Block + empty rules is 422 (never silent match-all); warn stays legal."""
    user_factory()
    # Create: block without rules rejected, with a rule accepted.
    r = client.post(G, json=_policy("NoRules", enforcement="block"))
    assert r.status_code == 422, r.text
    r = client.post(G, json=_policy("WarnEmpty", enforcement="warn"))
    assert r.status_code == 201, r.text
    pid = client.post(G, json=_policy("HasRules", enforcement="block",
                                      rules=[{"category": "pii"}])).json()["id"]
    # Update: clearing rules on a block policy 422s.
    r = client.patch(f"{G}/{pid}", json={"rules": []})
    assert r.status_code == 422, r.text
    # Update: flipping a rule-less warn policy to block 422s.
    wid = client.post(G, json=_policy("WarnFlip", enforcement="warn")).json()["id"]
    r = client.patch(f"{G}/{wid}", json={"enforcement": "block"})
    assert r.status_code == 422, r.text
    # Update: unrelated field touch on a ruled block policy stays 200.
    r = client.patch(f"{G}/{pid}", json={"description": "keeps rules"})
    assert r.status_code == 200, r.text
