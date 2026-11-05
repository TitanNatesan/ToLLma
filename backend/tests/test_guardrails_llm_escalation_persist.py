"""LLM escalation persistence: the wizard toggle survives save (no data loss).

Regression: `buildEvaluatorConfigs` used to drop `needsLlmEscalation` for
every non-llm primary, so a configured LLM judge was silently lost on save.
The fixed client persists it as a second `llm` evaluator row
(`operation="escalate"`) beside the primary via
POST /guardrails/{id}/evaluators. This pins the server side of that
contract: the API accepts/stores/returns the row, and evaluation escalates
through it. The judge is faked — no network, no provider spend.
"""

import asyncio
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.services.guardrails import evaluation as evaluation_engine

G = "/api/v1/guardrails"
PII_TEXT = "mail me at a@b.co"


async def _fake_llm_block_pii(text: str, **kw) -> dict:
    return {"verdict": "block", "confidence": 0.9,
            "matched_categories": ["pii"], "reason": "llm pii signal"}


def test_escalation_row_persists_and_evaluates(
    client: TestClient, db: Session, user_factory,
    provider_factory, model_factory, monkeypatch,
) -> None:
    user_factory()
    provider = provider_factory(name="EscPersist")
    model_factory(provider["id"], model_id="esc-model", name="Esc")

    r = client.post(G, json={
        "name": "Esc persist", "severity": "high", "enforcement": "block",
        "stage": "both",
        "rules": [{"category": "pii", "severity": "high", "config": {}}],
        "assignments": [{"scope_type": "global"}],
    })
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    # Exactly what the fixed wizard posts for deterministic + escalation.
    r = client.post(f"{G}/{pid}/evaluators", json={
        "evaluator_type": "llm", "provider_id": provider["id"],
        "model_ref": "esc-model", "operation": "escalate",
    })
    assert r.status_code == 201, r.text

    body = client.get(f"{G}/{pid}").json()
    assert [e["evaluator_type"] for e in body["evaluators"]] == ["llm"]
    llm = body["evaluators"][0]
    assert llm["provider_id"] == provider["id"]
    assert llm["model_ref"] == "esc-model"
    assert llm["operation"] == "escalate"

    from tollms.models.guardrail import GuardrailPolicy

    policy = db.get(GuardrailPolicy, uuid.UUID(pid))
    monkeypatch.setattr(
        "tollms.services.guardrails.llm.evaluate", _fake_llm_block_pii)
    result = asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, PII_TEXT, stage="pre", ctx={}))
    assert result["verdict"] == "block", result
    assert result["categories"] == ["pii"], result
    assert result["evaluator_type"] == "llm", result
    assert evaluation_engine.effective_action(policy, result) == "blocked"


def test_llm_evaluator_requires_provider(
    client: TestClient, user_factory,
) -> None:
    user_factory()
    pid = client.post(G, json={"name": "Esc guard"}).json()["id"]
    r = client.post(f"{G}/{pid}/evaluators", json={"evaluator_type": "llm"})
    assert r.status_code == 422, r.text
