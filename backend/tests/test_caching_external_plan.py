"""External-plane prompt-cache plan: public_gateway._prepare wiring.

Regression: the public (/v1) gateway attaches the same caching engine plan
as internal chat — Bedrock Claude ids get cachePoints when the model
declares support, OpenAI gets a stable per-(provider,model) key, and
unsupported/CUSTOM models stay byte-identical. Mocks/fakes only, no live I/O.
"""

import asyncio
import json
import re
import uuid
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest

from tollms.api.gateway import service as chat_service
from tollms.api.public_gateway import service as pg_service
from tollms.models.provider import ProviderType
from tollms.services.gateway import caching
from tollms.services.gateway.adapters.base import ChatMessage
from tollms.services.gateway.adapters.openai import OpenAIChatAdapter
from tollms.services.gateway.unified import UnifiedRequest

_KEY_RE = re.compile(r"^tollma:oai:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$")

CLAUDE_MODEL_ID = "anthropic.claude-sonnet-4-5-20250929-v1:0"


def _unified() -> UnifiedRequest:
    return UnifiedRequest(
        endpoint="chat_completions",
        model_identifier="mock/mock-model",
        messages=[ChatMessage(role="user", content="hi")],
    )


def _provider(ptype: ProviderType, uid: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        provider_type=ptype,
        org_id=None,
        user_id=uid,
        name="Mock",
    )


def _model(model_id: str, provider_id: uuid.UUID, supported: bool) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        provider_id=provider_id,
        model_id=model_id,
        metadata_={"supports_prompt_caching": True} if supported else {},
        primary_endpoint="converse",
        endpoint_type="converse",
        supports_text=True,
        supports_streaming=True,
        supports_tool_calling=False,
        supports_vision=False,
        supports_reasoning=False,
        max_output_tokens=4096,
    )


def _ctx(uid: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        key_id=uuid.uuid4(),
        user_id=uid,
        org_id=None,
        key_prefix="tma_test",
        model_allowed=lambda pid, mid: True,
    )


def _bind_prepare(
    monkeypatch: pytest.MonkeyPatch,
    provider: SimpleNamespace,
    model: SimpleNamespace,
    ctx: SimpleNamespace,
    supported: bool,
) -> SimpleNamespace:
    """Stub every _prepare dependency except the real caching engine plan."""
    monkeypatch.setattr(
        pg_service, "resolve_model",
        lambda db, ident, uid, org_ids=None: SimpleNamespace(provider=provider, model=model),
    )
    monkeypatch.setattr(pg_service, "decrypted_credentials", lambda p: {})
    fake_adapter = SimpleNamespace(prompt_cache=None, max_output_tokens=None)
    monkeypatch.setattr(pg_service, "build_adapter", lambda p, m, creds: fake_adapter)
    monkeypatch.setattr(pg_service, "_guardrail_pre", lambda *a, **k: None)
    monkeypatch.setattr(pg_service, "_org_cap_usd", lambda db, c: None)
    monkeypatch.setattr(pg_service, "_estimated_cost", lambda db, p, m, u: Decimal(0))
    monkeypatch.setattr(
        pg_service.key_policy_engine, "postgres_deny", lambda db, c, cost: None
    )
    monkeypatch.setattr(
        pg_service, "check_request",
        lambda c, **kw: SimpleNamespace(allowed=True, reason=None, status_code=200, retry_after=None),
    )
    monkeypatch.setattr(
        chat_service, "find_for_model",
        lambda db, ptype, mid: SimpleNamespace(supports_prompt_caching=supported),
    )
    return fake_adapter


def test_prepare_attaches_enabled_plan_for_bedrock_claude(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uid = uuid.uuid4()
    provider = _provider(ProviderType.BEDROCK_CONVERSE, uid)
    model = _model(CLAUDE_MODEL_ID, provider.id, supported=True)
    ctx = _ctx(uid)
    fake_adapter = _bind_prepare(monkeypatch, provider, model, ctx, supported=True)

    prepared = pg_service._prepare(
        object(), ctx, _unified(),
        pg_service.ClientMeta(request_id=f"req-{uuid.uuid4().hex[:8]}"),
    )

    assert prepared.adapter is fake_adapter
    plan = fake_adapter.prompt_cache
    assert plan is not None
    assert plan.enabled is True
    assert plan.strategy == "bedrock"


def test_prepare_attaches_disabled_plan_for_unsupported_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uid = uuid.uuid4()
    provider = _provider(ProviderType.BEDROCK_CONVERSE, uid)
    model = _model("meta.llama-4-maverick", provider.id, supported=False)
    ctx = _ctx(uid)
    fake_adapter = _bind_prepare(monkeypatch, provider, model, ctx, supported=False)

    prepared = pg_service._prepare(
        object(), ctx, _unified(),
        pg_service.ClientMeta(request_id=f"req-{uuid.uuid4().hex[:8]}"),
    )

    assert prepared.adapter is fake_adapter
    plan = fake_adapter.prompt_cache
    assert plan is not None
    assert plan.enabled is False
    assert plan.strategy == "none"
    assert caching.openai_params(plan) == {}


def test_openai_external_key_format_stable_no_conversation() -> None:
    provider_id, model_row_id = uuid.uuid4(), uuid.uuid4()
    plan = caching.plan(
        "OPENAI", supported=True, conversation_id="conv-123",
        provider_id=provider_id, model_row_id=model_row_id,
    )
    assert plan.enabled and plan.strategy == "openai"
    assert plan.cache_key is not None
    assert _KEY_RE.match(plan.cache_key), plan.cache_key
    assert plan.cache_key == f"tollma:oai:{provider_id}:{model_row_id}"
    # No conversation id leaks into the key.
    assert "conv-123" not in plan.cache_key
    assert "conv" not in plan.cache_key
    # Same (provider, model) across conversations shares one route.
    other = caching.plan(
        "OPENAI", supported=True, conversation_id="conv-456",
        provider_id=provider_id, model_row_id=model_row_id,
    )
    assert other.cache_key == plan.cache_key
    assert caching.openai_params(plan) == {"prompt_cache_key": plan.cache_key}


def test_openai_external_key_differs_across_providers_and_models() -> None:
    provider_a, model_a = uuid.uuid4(), uuid.uuid4()
    base = caching.plan(
        "OPENAI", supported=True, provider_id=provider_a, model_row_id=model_a
    ).cache_key
    other_provider = caching.plan(
        "OPENAI", supported=True, provider_id=uuid.uuid4(), model_row_id=model_a
    ).cache_key
    other_model = caching.plan(
        "OPENAI", supported=True, provider_id=provider_a, model_row_id=uuid.uuid4()
    ).cache_key
    assert base != other_provider
    assert base != other_model


def test_custom_unsupported_plan_disabled_body_unchanged() -> None:
    plan = caching.plan("CUSTOM", supported=False, conversation_id="c1")
    assert plan.enabled is False and plan.strategy == "none"
    assert caching.openai_params(plan) == {}
    assert caching.openai_params(None) == {}

    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        body = 'data: {"choices": [{"delta": {"content": "ok"}}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    async def run(cache) -> None:
        adapter = OpenAIChatAdapter(
            credentials={"api_key": "k"},
            model_id="external-model",
            transport=httpx.MockTransport(handler),
        )
        adapter.prompt_cache = cache
        await adapter.chat([ChatMessage(role="user", content="hello")])

    asyncio.run(run(None))
    asyncio.run(run(plan))
    assert "prompt_cache_key" not in seen[0]
    assert "prompt_cache_key" not in seen[1]
    assert seen[0] == seen[1]
