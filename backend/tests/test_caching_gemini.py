"""Gemini implicit caching: request stability + usage extraction."""

import asyncio
import json

import httpx
from tollms.services.gateway import caching
from tollms.services.gateway.adapters.base import ChatMessage, usage_extras
from tollms.services.gateway.adapters.gemini import (
    GeminiAdapter,
    VertexAdapter,
    _gemini_body,
)


def _gemini_sse(*items: dict) -> bytes:
    return "".join(f"data: {json.dumps(item)}\n\n" for item in items).encode()


def _text_item(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def _usage_item(text: str = "", **usage) -> dict:
    item = _text_item(text) if text else {"candidates": [{"content": {"parts": []}}]}
    item["usageMetadata"] = usage
    return item


def test_usage_extras_reads_gemini_counters() -> None:
    out = usage_extras({"cachedContentTokenCount": 1009, "thoughtsTokenCount": 42})
    assert out["cache_read_tokens"] == 1009
    assert out["reasoning_tokens"] == 42
    assert out["cache_write_tokens"] is None


def test_usage_extras_absent_counters_are_none() -> None:
    out = usage_extras({"promptTokenCount": 10})
    assert out["cache_read_tokens"] is None
    assert out["reasoning_tokens"] is None


def _run(coro):
    return asyncio.run(coro)


def _adapter_with(handler) -> GeminiAdapter:
    return GeminiAdapter(
        credentials={"api_key": "k"},
        model_id="gemini-2.5-flash",
        transport=httpx.MockTransport(handler),
    )


def test_gemini_stream_captures_cached_and_thought_tokens() -> None:
    body = _gemini_sse(
        _text_item("Hello"),
        _usage_item(
            "",
            promptTokenCount=1552,
            candidatesTokenCount=40,
            totalTokenCount=1592,
            cachedContentTokenCount=1009,
            thoughtsTokenCount=12,
        ),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    result = _run(_adapter_with(handler).chat([ChatMessage(role="user", content="hi")]))
    assert result.text == "Hello"
    assert result.prompt_tokens == 1552
    assert result.completion_tokens == 40
    assert result.total_tokens == 1592
    assert result.cache_read_tokens == 1009
    assert result.reasoning_tokens == 12


def test_gemini_stream_without_cached_count_leaves_zero() -> None:
    body = _gemini_sse(
        _text_item("Hi"),
        _usage_item(
            "", promptTokenCount=10, candidatesTokenCount=5, totalTokenCount=15
        ),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    result = _run(_adapter_with(handler).chat([ChatMessage(role="user", content="hi")]))
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (
        10,
        5,
        15,
    )
    assert result.cache_read_tokens == 0
    assert result.reasoning_tokens == 0


def test_gemini_streaming_chunk_shape_only_final_carries_usage() -> None:
    body = _gemini_sse(
        _text_item("Hel"),
        _text_item("lo"),
        _usage_item(
            "",
            promptTokenCount=100,
            candidatesTokenCount=8,
            totalTokenCount=108,
            cachedContentTokenCount=60,
        ),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    result = _run(_adapter_with(handler).chat([ChatMessage(role="user", content="hi")]))
    assert result.text == "Hello"
    assert result.cache_read_tokens == 60


def test_gemini_body_byte_stable_across_identical_calls() -> None:
    messages = [
        ChatMessage(role="user", content="hi"),
        ChatMessage(role="user", content="repeat this"),
    ]
    first = json.dumps(_gemini_body(messages), sort_keys=True).encode()
    second = json.dumps(_gemini_body(messages), sort_keys=True).encode()
    assert first == second
    assert b"cachedContent" not in first
    assert b"cache" not in first.lower()


def test_gemini_wire_bytes_identical_for_same_conversation_turn() -> None:
    seen: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.content)
        return httpx.Response(200, content=_gemini_sse(_text_item("ok")))

    async def two() -> None:
        adapter = _adapter_with(handler)
        await adapter.chat(
            [ChatMessage(role="user", content="stable prefix plus follow-up")]
        )
        await adapter.chat(
            [ChatMessage(role="user", content="stable prefix plus follow-up")]
        )

    _run(two())
    assert len(seen) == 2
    assert seen[0] == seen[1]


def test_gemini_implicit_plan_never_changes_request() -> None:
    plan = caching.plan("GEMINI", supported=True, conversation_id="conv-1")
    assert plan.enabled and plan.strategy == "implicit"
    assert plan.request_change is False
    assert caching.openai_params(plan) == {}
    messages = [ChatMessage(role="user", content="hi")]
    plain = json.dumps(_gemini_body(messages), sort_keys=True)
    assert "prompt_cache_key" not in plain


def test_gemini_generation_config_stable_for_same_reasoning_level() -> None:
    messages = [ChatMessage(role="user", content="hi")]
    low_a = json.dumps(_gemini_body(messages, reasoning_level="low"), sort_keys=True)
    low_b = json.dumps(_gemini_body(messages, reasoning_level="low"), sort_keys=True)
    assert low_a == low_b
    assert "thinkingConfig" in low_a
    off = json.dumps(_gemini_body(messages, reasoning_level=None), sort_keys=True)
    assert "thinkingConfig" not in off
    vertex_off = json.dumps(_gemini_body(messages), sort_keys=True)
    assert "thinkingConfig" not in vertex_off
    assert VertexAdapter is not None
