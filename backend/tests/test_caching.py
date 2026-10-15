"""Prompt caching framework: provider-aware plans + adapter body wiring."""

import asyncio
import json
from decimal import Decimal

import httpx
import pytest
from tollms.services.gateway import caching
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import ChatMessage
from tollms.services.gateway.adapters.openai import OpenAIChatAdapter


class _Model:
    def __init__(self, metadata: dict | None = None) -> None:
        self.metadata_ = metadata or {}


class _Repo:
    def __init__(self, supported: bool) -> None:
        self.supports_prompt_caching = supported


def test_unsupported_model_disables_caching_gracefully() -> None:
    plan = caching.plan("OPENAI", supported=False, conversation_id="c1")
    assert plan.enabled is False and plan.strategy == "none"
    assert caching.openai_params(plan) == {}
    assert caching.anthropic_system(plan, "system prompt") == "system prompt"
    assert caching.bedrock_system(plan, [{"text": "system prompt"}]) == [{"text": "system prompt"}]


def test_openai_plan_uses_conversation_cache_key() -> None:
    plan = caching.plan("OPENAI", supported=True, conversation_id="conv-123")
    assert plan.enabled and plan.strategy == "openai"
    assert caching.openai_params(plan) == {"prompt_cache_key": "tollma:conv-123"}
    # No conversation id -> enabled, no request change beyond the empty key.
    assert caching.openai_params(caching.plan("OPENAI", supported=True)) == {}


def test_anthropic_plan_marks_system_ephemeral() -> None:
    plan = caching.plan("ANTHROPIC_MESSAGES", supported=True)
    assert plan.strategy == "anthropic"
    system = caching.anthropic_system(plan, "long stable instructions")
    assert isinstance(system, list)
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert system[0]["text"] == "long stable instructions"
    # Empty system stays empty (nothing to cache).
    assert caching.anthropic_system(plan, "") == ""


def test_anthropic_plan_caches_conversation_prefix() -> None:
    plan = caching.plan("ANTHROPIC_MESSAGES", supported=True)
    messages = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "follow up"},
    ]
    marked = caching.anthropic_messages(plan, messages)
    assert marked[-1]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert marked[-1]["content"][-1]["text"] == "follow up"
    assert marked[0]["content"] == "first"
    # Multi-part last message: the breakpoint lands on the final block.
    multi = [{"role": "user", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}]
    assert caching.anthropic_messages(plan, multi)[-1]["content"][-1]["cache_control"] == {
        "type": "ephemeral"
    }
    # Unsupported/absent plan: byte-identical messages.
    untouched = [{"role": "user", "content": "hi"}]
    assert caching.anthropic_messages(None, untouched) == [{"role": "user", "content": "hi"}]


def test_bedrock_only_claude_gets_cache_point() -> None:
    claude = caching.plan("BEDROCK_CONVERSE", supported=True, model_id="anthropic.claude-sonnet-4")
    assert claude.strategy == "bedrock"
    blocks = caching.bedrock_system(claude, [{"text": "system"}])
    assert blocks[-1] == {"cachePoint": {"type": "default"}}
    other = caching.plan("BEDROCK_CONVERSE", supported=True, model_id="meta.llama-4")
    assert other.strategy == "implicit"
    assert caching.bedrock_system(other, [{"text": "system"}]) == [{"text": "system"}]


def test_implicit_families_and_custom_gateways_never_change_requests() -> None:
    for provider in ("GEMINI", "VERTEX_AI", "CUSTOM"):
        plan = caching.plan(provider, supported=True, conversation_id="c1")
        assert plan.enabled and plan.strategy == "implicit"
        assert caching.openai_params(plan) == {}


def test_supports_prompt_caching_reads_metadata_then_repository() -> None:
    assert caching.supports_prompt_caching(_Model({"supports_prompt_caching": True})) is True
    assert caching.supports_prompt_caching(_Model(), _Repo(True)) is True
    assert caching.supports_prompt_caching(_Model(), _Repo(False)) is False
    assert caching.supports_prompt_caching(_Model()) is False


def test_openai_adapter_sends_cache_key_only_when_planned() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        body = 'data: {"choices": [{"delta": {"content": "ok"}}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    async def run(with_cache: bool) -> None:
        adapter = OpenAIChatAdapter(
            credentials={"api_key": "k"},
            model_id="gpt-4.1",
            transport=httpx.MockTransport(handler),
        )
        if with_cache:
            adapter.prompt_cache = caching.plan("OPENAI", supported=True, conversation_id="conv-9")
        await adapter.chat([ChatMessage(role="user", content="hello")])

    asyncio.run(run(True))
    assert seen[0]["prompt_cache_key"] == "tollma:conv-9"
    asyncio.run(run(False))
    assert "prompt_cache_key" not in seen[1]


def test_anthropic_adapter_system_block_when_planned() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        body = 'data: {"type": "message_start", "message": {"usage": {"input_tokens": 5}}}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    async def run(with_cache: bool) -> None:
        adapter = AnthropicAdapter(
            credentials={"api_key": "k"},
            model_id="claude-sonnet-4",
            transport=httpx.MockTransport(handler),
        )
        if with_cache:
            adapter.prompt_cache = caching.plan("ANTHROPIC_MESSAGES", supported=True)
        await adapter.chat(
            [
                ChatMessage(role="system", content="stable instructions"),
                ChatMessage(role="user", content="hello"),
            ]
        )

    asyncio.run(run(True))
    assert seen[0]["system"] == [
        {"type": "text", "text": "stable instructions", "cache_control": {"type": "ephemeral"}}
    ]
    # The conversation prefix gets its own breakpoint (final message block).
    assert seen[0]["messages"][-1]["content"] == [
        {"type": "text", "text": "hello", "cache_control": {"type": "ephemeral"}}
    ]
    asyncio.run(run(False))
    assert seen[1]["system"] == "stable instructions"
    assert seen[1]["messages"][-1]["content"] == "hello"


@pytest.mark.parametrize("provider", ["OPENAI", "ANTHROPIC_MESSAGES", "BEDROCK_CONVERSE", "GEMINI", "VERTEX_AI", "CUSTOM"])
def test_every_provider_family_returns_a_plan(provider: str) -> None:
    plan = caching.plan(provider, supported=True, model_id="anthropic.claude-sonnet-4")
    assert plan.enabled is True
    assert plan.strategy in ("openai", "anthropic", "bedrock", "implicit")


def test_bedrock_usage_extras_reads_camelcase_counters() -> None:
    from tollms.services.gateway.adapters.base import usage_extras

    out = usage_extras({"cacheReadInputTokens": 500, "cacheWriteInputTokens": 100})
    assert out["cache_read_tokens"] == 500
    assert out["cache_write_tokens"] == 100


def test_bedrock_messages_marks_final_message_cache_point() -> None:
    from tollms.services.gateway.caching import bedrock_messages, plan

    p = plan("BEDROCK_CONVERSE", supported=True, conversation_id="c", model_id="anthropic.claude-x")
    msgs = [
        {"role": "user", "content": [{"text": "hi"}]},
        {"role": "assistant", "content": [{"text": "hello"}]},
    ]
    out = bedrock_messages(p, msgs)
    assert out[-1]["content"][-1] == {"cachePoint": {"type": "default"}}
    assert out[0]["content"] == [{"text": "hi"}]  # only the final message marked


def test_bedrock_messages_noop_without_plan() -> None:
    from tollms.services.gateway.caching import bedrock_messages

    msgs = [{"role": "user", "content": [{"text": "hi"}]}]
    assert bedrock_messages(None, msgs) == msgs


def test_calculate_bills_input_net_of_cached_tokens() -> None:
    from tollms.services.gateway.costing import PriceSet, UsageTokens, calculate

    out = calculate(
        UsageTokens(prompt=1000, completion=500, cache_read=800, cache_write=100),
        PriceSet(input=Decimal(2), output=Decimal(10), cache_read=Decimal("0.5"), cache_write=Decimal("1")),
    )
    # input bills the 100 uncached tokens only; cache lines bill separately.
    assert out.input_cost == Decimal(100) * Decimal(2) / Decimal(1_000_000)
    assert out.cache_read_cost == Decimal(800) * Decimal("0.5") / Decimal(1_000_000)
    assert out.cache_write_cost == Decimal(100) * Decimal(1) / Decimal(1_000_000)
    assert out.total_cost == out.input_cost + out.output_cost + out.cache_read_cost + out.cache_write_cost


def test_request_logs_persist_cache_tokens(
    db, provider_factory, model_factory
) -> None:
    """request_logs carries cache/reasoning detail like messages (audit parity)."""
    import asyncio
    import uuid as uuid_mod

    import httpx as httpx_mod

    from tollms.api.gateway.schemas import ChatRequest
    from tollms.api.gateway.service import run_chat
    from tollms.models.request_log import RequestLog

    p = provider_factory("CacheLedger", ptype="OPENAI", creds={"api_key": "k"})
    m = model_factory(p["id"], model_id="cache-model")
    body = (
        'data: {"choices": [{"delta": {"content": "Hi"}}]}\n\n'
        'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5,'
        ' "total_tokens": 15, "prompt_tokens_details": {"cached_tokens": 4}}}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx_mod.Request) -> httpx_mod.Response:
        return httpx_mod.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    result = asyncio.run(
        run_chat(
            db,
            ChatRequest(provider_id=uuid_mod.UUID(p["id"]), model_id=uuid_mod.UUID(m["id"]), message="hi"),
            httpx_mod.MockTransport(handler),
        )
    )
    row = db.query(RequestLog).filter(RequestLog.message_id == result.message_id).one()
    assert row.cache_read_tokens == 4
    assert row.prompt_tokens == 10
