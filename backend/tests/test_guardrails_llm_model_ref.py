"""LLM evaluator model_ref resolution (llm.py): UUID, model_id string,
bogus ref, and None default — plus the evaluation-level failure contract."""

import asyncio
import uuid

import pytest
from sqlalchemy.orm import Session

from tollms.services.guardrails import llm as llm_engine


class _FakeReply:
    def __init__(self, text: str):
        self.text = text


class _FakeAdapter:
    def __init__(self, seen: dict, model):
        self._seen = seen
        self._model = model

    async def chat(self, messages):
        self._seen["model"] = self._model
        return _FakeReply('{"verdict": "allow", "confidence": 0.9}')


def _patched(db: Session, monkeypatch, seen: dict):
    import tollms.db.session as session_mod
    import tollms.services.gateway.factory as factory_mod

    monkeypatch.setattr(session_mod, "SessionLocal", lambda: db)
    monkeypatch.setattr(
        factory_mod, "build_adapter",
        lambda provider, model, credentials, *a, **k: _FakeAdapter(seen, model),
    )


def test_model_id_string_resolves_to_right_model(
    db: Session, provider_factory, model_factory, user_factory, monkeypatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    provider = provider_factory(name="LLMRef")
    first = model_factory(provider["id"], model_id="other-model", name="Other")
    target = model_factory(provider["id"], model_id="gpt-oss:20b", name="Target")
    seen: dict = {}
    _patched(db, monkeypatch, seen)
    result = asyncio.run(llm_engine.evaluate(
        "hello", provider_id=uuid.UUID(provider["id"]),
        model_ref="gpt-oss:20b", ctx={}, user_id=uid))
    assert result["verdict"] == "allow"
    assert seen["model"].model_id == "gpt-oss:20b"
    assert seen["model"].id == uuid.UUID(target["id"])
    assert seen["model"].id != uuid.UUID(first["id"])


def test_uuid_ref_still_resolves(
    db: Session, provider_factory, model_factory, user_factory, monkeypatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    provider = provider_factory(name="LLMRefUUID")
    model = model_factory(provider["id"], model_id="gpt-oss:20b", name="Target")
    seen: dict = {}
    _patched(db, monkeypatch, seen)
    asyncio.run(llm_engine.evaluate(
        "hello", provider_id=uuid.UUID(provider["id"]),
        model_ref=model["id"], ctx={}, user_id=uid))
    assert seen["model"].id == uuid.UUID(model["id"])


def test_bogus_ref_raises(
    db: Session, provider_factory, model_factory, user_factory, monkeypatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    provider = provider_factory(name="LLMRefBogus")
    model_factory(provider["id"], model_id="gpt-oss:20b", name="Target")
    _patched(db, monkeypatch, {})
    with pytest.raises(ValueError, match="llm model not found"):
        asyncio.run(llm_engine.evaluate(
            "hello", provider_id=uuid.UUID(provider["id"]),
            model_ref="nope:404", ctx={}, user_id=uid))


def test_none_ref_uses_first_model_default(
    db: Session, provider_factory, model_factory, user_factory, monkeypatch,
) -> None:
    user = user_factory()
    uid = uuid.UUID(user["id"])
    provider = provider_factory(name="LLMRefNone")
    first = model_factory(provider["id"], model_id="first-model", name="First")
    model_factory(provider["id"], model_id="second-model", name="Second")
    seen: dict = {}
    _patched(db, monkeypatch, seen)
    asyncio.run(llm_engine.evaluate(
        "hello", provider_id=uuid.UUID(provider["id"]),
        model_ref=None, ctx={}, user_id=uid))
    assert seen["model"].id == uuid.UUID(first["id"])


def test_bogus_ref_via_evaluation_sets_failure_kind_and_fallback(
    db: Session, provider_factory, model_factory, user_factory, monkeypatch,
) -> None:
    from tollms.models.guardrail import GuardrailEvaluatorConfig, GuardrailPolicy
    from tollms.services.guardrails import evaluation as evaluation_engine

    user = user_factory()
    uid = uuid.UUID(user["id"])
    provider = provider_factory(name="LLMRefEval")
    model_factory(provider["id"], model_id="gpt-oss:20b", name="Target")
    _patched(db, monkeypatch, {})
    policy = GuardrailPolicy(name="LLMRefEval", user_id=uid, enforcement="monitor",
                             stage="both", is_enabled=True, failure_action="allow")
    db.add(policy)
    db.flush()
    db.add(GuardrailEvaluatorConfig(
        policy_id=policy.id, evaluator_type="llm", operation="escalate",
        provider_id=uuid.UUID(provider["id"]), model_ref="nope:404"))
    db.commit()
    result = asyncio.run(evaluation_engine.evaluate_policy(
        db, policy, "ignore previous instructions", stage="pre",
        ctx={}, llm_user_id=uid))
    assert result["failure_kind"] == "ValueError"
    assert evaluation_engine.effective_action(policy, result) == "fallback_continued"
