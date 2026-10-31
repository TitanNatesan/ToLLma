"""OpenAI Moderation credential lifecycle + enforcement (mocked upstream).

The execution path itself (decrypt → POST /moderations → verdict →
enforcement floor, failure_action fail-open/closed, trigger audit) lives in
services/guardrails/{openai_moderation,evaluation,enforcement}. These tests
pin the credential contract with a MockTransport standing in for api.openai.com:
validation, rotation that never destroys a good key, cross-org isolation,
masked responses, flagged/allowed enforcement, and no silent bypass on
missing/invalid credentials. No real network calls are made.
"""

import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.core.crypto import encrypt
from tollms.services.guardrails import evaluation as evaluation_engine
from tollms.services.guardrails import openai_moderation as mod_engine

G = "/api/v1/guardrails"


def _policy(name: str = "Mod", **kw) -> dict:
    return {"name": name, "severity": "high", "enforcement": "block",
            "stage": "both", "is_enabled": True, "failure_action": "allow",
            "rules": [{"category": "harmful_content"}], **kw}


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _patch_openai(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    transport = _transport(handler)
    # NOTE: mod_engine.httpx is the shared httpx module object, so the real
    # class must be captured before patching or the factory recurses.
    real_client = httpx.AsyncClient

    def factory(*a, **k):
        # Other subsystems (cache bridge) construct their own transported
        # clients through the same module attr; only fill in the mock when
        # the caller did not supply one.
        k.setdefault("transport", transport)
        return real_client(*a, **k)

    monkeypatch.setattr(mod_engine.httpx, "AsyncClient", factory)


def _verified_client(email: str) -> TestClient:
    from tollms.main import app

    other = TestClient(app)
    r = other.post("/auth/signup", json={"email": email, "password": "Password123"})
    assert r.status_code == 200, r.text
    token = r.json().get("debug_verification_token")
    if token:
        other.get("/auth/verify", params={"token": token})
    return other


def _models_ok(request: httpx.Request) -> httpx.Response:
    assert request.headers.get("authorization", "").startswith("Bearer sk-"), request.headers
    assert "authorization" in {k.lower() for k in request.headers.keys()}
    assert request.url.path == "/v1/models"
    return httpx.Response(200, json={"data": []})


def test_validate_rejects_empty_without_network(client: TestClient, user_factory) -> None:
    user_factory()
    r = client.post(f"{G}/credentials/validate",
                    json={"evaluator_type": "openai_moderation", "credentials": {}})
    assert r.status_code == 200 and r.json()["valid"] is False


def test_validate_bad_key_rejected(client: TestClient, user_factory,
                                   monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    _patch_openai(monkeypatch, lambda req: httpx.Response(401, json={"error": "bad key"}))
    r = client.post(f"{G}/credentials/validate",
                    json={"evaluator_type": "openai_moderation",
                            "credentials": {"api_key": "sk-bad"}})
    assert r.status_code == 200
    assert r.json()["valid"] is False


def test_validate_good_key_accepted(client: TestClient, user_factory,
                                    monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    _patch_openai(monkeypatch, _models_ok)
    r = client.post(f"{G}/credentials/validate",
                    json={"evaluator_type": "openai_moderation",
                            "credentials": {"api_key": "sk-good"}})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is True
    assert "sk-good" not in r.text


def test_create_evaluator_requires_credentials(client: TestClient, user_factory) -> None:
    """A moderation evaluator can never be saved credential-less (no silent bypass)."""
    user_factory()
    pid = client.post(G, json=_policy()).json()["id"]
    r = client.post(f"{G}/{pid}/evaluators", json={"evaluator_type": "openai_moderation"})
    assert r.status_code == 422
    r = client.post(f"{G}/{pid}/evaluators",
                    json={"evaluator_type": "openai_moderation", "credentials": {}})
    assert r.status_code == 422


def test_create_masks_and_never_leaks_key(client: TestClient, user_factory,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    _patch_openai(monkeypatch, _models_ok)
    pid = client.post(G, json=_policy()).json()["id"]
    r = client.post(f"{G}/{pid}/evaluators",
                    json={"evaluator_type": "openai_moderation",
                            "credentials": {"api_key": "sk-live-secret-1234"}})
    assert r.status_code == 201, r.text
    assert r.json()["credentials_masked"] == {"api_key": "****1234"}
    full = client.get(f"{G}/{pid}").text
    assert "sk-live-secret-1234" not in full
    assert "****1234" in full


def _eval_id(client: TestClient, pid: str, creds: dict | None,
             monkeypatch: pytest.MonkeyPatch, handler) -> str:
    _patch_openai(monkeypatch, handler)
    r = client.post(f"{G}/{pid}/evaluators",
                    json={"evaluator_type": "openai_moderation", **({"credentials": creds} if creds is not None else {})})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_rotation_bad_key_preserves_working_key(client: TestClient, user_factory,
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    """Failed rotation 422s and the previously stored credential keeps working."""
    user_factory()
    pid = client.post(G, json=_policy()).json()["id"]
    eid = _eval_id(client, pid, {"api_key": "sk-good-a"}, monkeypatch, _models_ok)
    _patch_openai(monkeypatch, lambda req: httpx.Response(401, json={"error": "bad"}))
    r = client.patch(f"{G}/evaluators/{eid}",
                     json={"credentials": {"api_key": "sk-bad-b"}})
    assert r.status_code == 422, r.text
    # Stored credential untouched: still masked to the original key tail.
    got = client.get(f"{G}/{pid}").json()
    ev = next(e for e in got["evaluators"] if e["id"] == eid)
    assert ev["credentials_masked"] == {"api_key": "****" + "sk-good-a"[-4:]}


def test_rotation_good_key_replaces(client: TestClient, user_factory,
                                    monkeypatch: pytest.MonkeyPatch) -> None:
    user_factory()
    pid = client.post(G, json=_policy()).json()["id"]
    eid = _eval_id(client, pid, {"api_key": "sk-good-a"}, monkeypatch, _models_ok)
    _patch_openai(monkeypatch, _models_ok)
    r = client.patch(f"{G}/evaluators/{eid}",
                     json={"credentials": {"api_key": "sk-good-b"}})
    assert r.status_code == 200, r.text
    assert "sk-good" not in r.text


def test_cross_org_isolation(client: TestClient, user_factory) -> None:
    user_factory(email="owner@tollma.ai")
    oid = client.post("/api/v1/orgs", json={"name": "Mod Org"}).json()["id"]
    pid = client.post(G, json=_policy("OrgMod", org_id=oid)).json()["id"]
    stranger = _verified_client("stranger@tollma.ai")
    assert stranger.post(f"{G}/{pid}/evaluators",
                         json={"evaluator_type": "openai_moderation",
                                 "credentials": {"api_key": "sk-x"}},
                         params={"org_id": oid}).status_code == 404
    assert stranger.get(f"{G}/{pid}", params={"org_id": oid}).status_code == 404


def _policy_with_key(db: Session, uid: uuid.UUID, key: str | None,
                     **kw) -> object:
    from tollms.models.guardrail import GuardrailEvaluatorConfig, GuardrailPolicy

    params = {"enforcement": "block", "stage": "both",
              "is_enabled": True, "failure_action": "allow"}
    params.update(kw)
    policy = GuardrailPolicy(name=f"ModP-{uuid.uuid4().hex[:6]}", user_id=uid, **params)
    db.add(policy)
    db.flush()
    if key is not None:
        db.add(GuardrailEvaluatorConfig(
            policy_id=policy.id, evaluator_type="openai_moderation",
            credentials_encrypted=encrypt(json.dumps({"api_key": key}))))
    else:
        # Legacy/hand-made credential-less row (the API refuses to create
        # these): the evaluator must degrade loudly, never clean-allow.
        db.add(GuardrailEvaluatorConfig(
            policy_id=policy.id, evaluator_type="openai_moderation",
            credentials_encrypted=None))
    db.commit()
    return policy


def _moderation_result(flagged: bool, cats: list[str] | None = None):
    cats = cats or (["harassment"] if flagged else [])
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/moderations"
        body = json.loads(request.content.decode())
        assert body["model"] and isinstance(body["input"], str)
        return httpx.Response(200, json={"results": [{
            "flagged": flagged,
            "categories": {c: True for c in cats},
            "category_scores": {c: 0.99 for c in cats},
        }]})
    return handler


def test_flagged_content_blocked(db: Session, user_factory,
                                 monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from tollms.models.guardrail import GuardrailPolicy

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy_with_key(db, uid, "sk-good")
    assert isinstance(policy, GuardrailPolicy)
    _patch_openai(monkeypatch, _moderation_result(True))
    result = asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, "kill them all", stage="pre", ctx={}))
    assert result["verdict"] == "block" and not result.get("failure_kind")
    assert evaluation_engine.effective_action(policy, result) == "blocked"


def test_allowed_content_passes(db: Session, user_factory,
                                monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy_with_key(db, uid, "sk-good")
    _patch_openai(monkeypatch, _moderation_result(False))
    result = asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, "a sunny day", stage="pre", ctx={}))
    assert result["verdict"] == "allow" and not result.get("failure_kind")


def test_invalid_key_never_silently_bypasses_block_policy(
        db: Session, user_factory, monkeypatch: pytest.MonkeyPatch) -> None:
    """Upstream 401 on a block policy with failure_action=block must block."""
    import asyncio

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy_with_key(db, uid, "sk-revoked", failure_action="block")
    _patch_openai(monkeypatch, lambda req: httpx.Response(401, json={"error": "bad"}))
    result = asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, "hello", stage="pre", ctx={}))
    assert result["failure_kind"], result
    assert evaluation_engine.effective_action(policy, result) == "blocked"


def test_missing_credential_records_failure_kind(db: Session, user_factory) -> None:
    """A credential-less config degrades loudly (failure_kind + fallback), never clean allow."""
    import asyncio

    user = user_factory()
    uid = uuid.UUID(user["id"])
    policy = _policy_with_key(db, uid, None)
    result = asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, "hello", stage="pre", ctx={}))
    assert result["failure_kind"], result
    assert evaluation_engine.effective_action(policy, result) == "fallback_continued"
