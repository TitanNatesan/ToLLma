"""Bedrock Converse tool support: toolConfig, toolUse/toolResult, streaming deltas.

Fake boto3 client only (no network, no creds): monkeypatches boto3.client so
BedrockAdapter._stream_events captures the exact converse_stream payload and
replays canned stream events.
"""

import asyncio
import json

import pytest

from tollms.services.gateway.adapters.base import ChatMessage
from tollms.services.gateway.adapters.bedrock import BedrockAdapter, _tool_config

CREDS = {"access_key": "k", "secret_key": "s", "region": "us-east-1"}
MODEL = "anthropic.claude-haiku-4-5-20251001-v1:0"
RESOLVED = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

# Mixed shapes, as forwarded by the gateway (Anthropic- and OpenAI-shaped).
TOOLS = [
    {"name": "get_weather", "description": "city forecast", "input_schema": {"type": "object"}},
    {"type": "function", "function": {"name": "get_time", "description": "now", "parameters": {"type": "object"}}},
]

TOOL_CONFIG = {
    "tools": [
        {"toolSpec": {
            "name": "get_weather",
            "description": "city forecast",
            "inputSchema": {"json": {"type": "object"}},
        }},
        {"toolSpec": {
            "name": "get_time",
            "description": "now",
            "inputSchema": {"json": {"type": "object"}},
        }},
    ],
}

TOOL_USE_EVENTS = [
    {"contentBlockDelta": {"delta": {"text": "checking "}, "contentBlockIndex": 0}},
    {"contentBlockStart": {
        "start": {"toolUse": {"toolUseId": "tu_1", "name": "get_weather"}},
        "contentBlockIndex": 1,
    }},
    {"contentBlockDelta": {"delta": {"toolUse": {"input": '{"city":'}}, "contentBlockIndex": 1}},
    {"contentBlockDelta": {"delta": {"toolUse": {"input": '"SF"}'}}, "contentBlockIndex": 1}},
    {"messageStop": {"stopReason": "tool_use"}},
    {"metadata": {"usage": {"inputTokens": 8, "outputTokens": 12, "totalTokens": 20}}},
]


class _FakeClient:
    """Records converse_stream payloads; replays canned stream events."""

    def __init__(self, events):
        self.events = events
        self.payloads: list[dict] = []

    def converse_stream(self, **kwargs):
        self.payloads.append(kwargs)
        return {"stream": list(self.events)}


def _adapter_with_stream(monkeypatch: pytest.MonkeyPatch, events) -> tuple[BedrockAdapter, _FakeClient]:
    import boto3

    fake = _FakeClient(events)
    monkeypatch.setattr(boto3, "client", lambda *a, **k: fake)
    return BedrockAdapter(credentials=dict(CREDS), model_id=MODEL), fake


def _collect(adapter, messages, **kwargs) -> list:
    async def _main():
        return [chunk async for chunk in adapter.chat_stream(messages, **kwargs)]

    return asyncio.run(_main())


def test_tool_use_request_and_response(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, fake = _adapter_with_stream(monkeypatch, TOOL_USE_EVENTS)
    result = asyncio.run(
        adapter.chat([ChatMessage(role="user", content="weather?")], tools=TOOLS, tool_choice="auto")
    )

    payload = fake.payloads[0]
    assert payload["modelId"] == RESOLVED
    assert payload["toolConfig"] == {**TOOL_CONFIG, "toolChoice": {"auto": {}}}
    assert result.tool_calls == [{"id": "tu_1", "name": "get_weather", "arguments": '{"city":"SF"}'}]
    assert json.loads(result.tool_calls[0]["arguments"]) == {"city": "SF"}
    assert result.finish_reason == "tool_use"
    assert result.text == "checking "
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (8, 12, 20)


def test_tool_choice_mapping() -> None:
    assert _tool_config(TOOLS, "auto") == {**TOOL_CONFIG, "toolChoice": {"auto": {}}}
    assert _tool_config(TOOLS, "required") == {**TOOL_CONFIG, "toolChoice": {"any": {}}}
    assert _tool_config(TOOLS, {"type": "any"}) == {**TOOL_CONFIG, "toolChoice": {"any": {}}}
    assert _tool_config(TOOLS, {"type": "tool", "name": "get_time"}) == {
        **TOOL_CONFIG, "toolChoice": {"tool": {"name": "get_time"}}
    }
    assert _tool_config(TOOLS, {"type": "function", "function": {"name": "get_weather"}}) == {
        **TOOL_CONFIG, "toolChoice": {"tool": {"name": "get_weather"}}
    }
    assert _tool_config(TOOLS, "get_weather") == {
        **TOOL_CONFIG, "toolChoice": {"tool": {"name": "get_weather"}}
    }
    # Converse has no "none" toolChoice: omit toolConfig entirely.
    assert _tool_config(TOOLS, "none") is None
    # No tools (or nameless entries) -> no toolConfig, whatever the choice.
    assert _tool_config(None, None) is None
    assert _tool_config(None, "auto") is None
    assert _tool_config([{"description": "nameless"}], "auto") is None
    # Tools without a choice default to the provider's auto behavior.
    assert _tool_config(TOOLS, None) == TOOL_CONFIG


def test_none_choice_omits_tool_config(monkeypatch: pytest.MonkeyPatch) -> None:
    events = [
        {"contentBlockDelta": {"delta": {"text": "hi"}, "contentBlockIndex": 0}},
        {"messageStop": {"stopReason": "end_turn"}},
    ]
    adapter, fake = _adapter_with_stream(monkeypatch, events)
    result = asyncio.run(adapter.chat([ChatMessage(role="user", content="hi")], tools=TOOLS, tool_choice="none"))
    assert "toolConfig" not in fake.payloads[0]
    assert result.text == "hi"


def test_tool_result_follow_up(monkeypatch: pytest.MonkeyPatch) -> None:
    events = [
        {"contentBlockDelta": {"delta": {"text": "72F"}, "contentBlockIndex": 0}},
        {"messageStop": {"stopReason": "end_turn"}},
    ]
    adapter, fake = _adapter_with_stream(monkeypatch, events)
    messages = [
        ChatMessage(role="user", content="weather?"),
        ChatMessage(role="assistant", content="", extra={"tool_calls": [
            {"id": "tu_1", "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}
        ]}),
        ChatMessage(role="tool", content='{"temp": 72}', extra={"tool_call_id": "tu_1"}),
        ChatMessage(role="assistant", content="checking", extra={"blocks": [
            {"type": "tool_use", "id": "tu_2", "name": "get_time", "input": {}}
        ]}),
    ]
    result = asyncio.run(adapter.chat(messages, tools=TOOLS))

    assert fake.payloads[0]["messages"] == [
        {"role": "user", "content": [{"text": "weather?"}]},
        {"role": "assistant", "content": [{"toolUse": {
            "toolUseId": "tu_1", "name": "get_weather", "input": {"city": "SF"},
        }}]},
        {"role": "user", "content": [{"toolResult": {
            "toolUseId": "tu_1", "status": "success", "content": [{"text": '{"temp": 72}'}],
        }}]},
        {"role": "assistant", "content": [
            {"text": "checking"},
            {"toolUse": {"toolUseId": "tu_2", "name": "get_time", "input": {}}},
        ]},
    ]
    assert result.text == "72F"
    assert result.tool_calls == []


def test_streaming_tool_deltas_accumulate(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, _ = _adapter_with_stream(monkeypatch, TOOL_USE_EVENTS)
    chunks = _collect(adapter, [ChatMessage(role="user", content="weather?")], tools=TOOLS)

    deltas = [c.tool_call_delta for c in chunks if c.tool_call_delta]
    assert deltas[0] == {"index": 1, "id": "tu_1", "name": "get_weather", "arguments_delta": ""}
    assert json.loads("".join(d["arguments_delta"] for d in deltas[1:])) == {"city": "SF"}
    assert [c.finish_reason for c in chunks if c.finish_reason] == ["tool_use"]
    # Transient fragment-matching keys never leak into the normalized calls.
    result = asyncio.run(adapter.chat([ChatMessage(role="user", content="weather?")], tools=TOOLS))
    assert all("index" not in call for call in result.tool_calls)


def test_plain_text_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    events = [
        {"contentBlockDelta": {"delta": {"text": "hi"}, "contentBlockIndex": 0}},
        {"messageStop": {"stopReason": "end_turn"}},
        {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}}},
    ]
    adapter, fake = _adapter_with_stream(monkeypatch, events)
    messages = [
        ChatMessage(role="system", content="be brief"),
        ChatMessage(role="user", content="hi"),
    ]
    result = asyncio.run(adapter.chat(messages))

    assert fake.payloads[0] == {
        "modelId": RESOLVED,
        "messages": [{"role": "user", "content": [{"text": "hi"}]}],
        "system": [{"text": "be brief"}],
    }
    assert result.text == "hi"
    assert result.tool_calls == []
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (1, 1, 2)


def test_history_fallback_redeclares_observed_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    """Follow-up without tools param but with toolUse history still sends toolConfig.

    Converse rejects tool-carrying history without toolConfig, so the observed
    tool names are redeclared with a permissive schema (deduped, first-seen).
    """
    events = [
        {"contentBlockDelta": {"delta": {"text": "done"}, "contentBlockIndex": 0}},
        {"messageStop": {"stopReason": "end_turn"}},
    ]
    adapter, fake = _adapter_with_stream(monkeypatch, events)
    messages = [
        ChatMessage(role="user", content="weather?"),
        ChatMessage(role="assistant", content="", extra={
            "tool_calls": [
                {"id": "tu_1", "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}},
            ],
            "blocks": [
                {"type": "tool_use", "id": "tu_9", "name": "get_weather", "input": {}},
                {"type": "tool_use", "id": "tu_2", "name": "get_time", "input": {}},
            ],
        }),
        ChatMessage(role="tool", content='{"temp": 72}', extra={"tool_call_id": "tu_1"}),
    ]
    result = asyncio.run(adapter.chat(messages))  # no tools= param

    assert fake.payloads[0]["toolConfig"] == {"tools": [
        {"toolSpec": {"name": "get_weather", "inputSchema": {"json": {"type": "object"}}}},
        {"toolSpec": {"name": "get_time", "inputSchema": {"json": {"type": "object"}}}},
    ]}, fake.payloads[0]
    assert result.text == "done"


def test_tool_result_message_drops_text_echo(monkeypatch: pytest.MonkeyPatch) -> None:
    """A tool-result user message maps to pure [toolResult], no leading text block."""
    events = [
        {"contentBlockDelta": {"delta": {"text": "ok"}, "contentBlockIndex": 0}},
        {"messageStop": {"stopReason": "end_turn"}},
    ]
    adapter, fake = _adapter_with_stream(monkeypatch, events)
    messages = [
        ChatMessage(role="assistant", content="", extra={"blocks": [
            {"type": "tool_use", "id": "tu_1", "name": "get_weather", "input": {"city": "SF"}}
        ]}),
        ChatMessage(role="user", content="stale echo", extra={"blocks": [
            {"type": "tool_result", "tool_use_id": "tu_1", "content": '{"temp": 72}'}
        ]}),
    ]
    asyncio.run(adapter.chat(messages))

    assert fake.payloads[0]["messages"][-1] == {"role": "user", "content": [{"toolResult": {
        "toolUseId": "tu_1", "status": "success", "content": [{"text": '{"temp": 72}'}],
    }}]}, fake.payloads[0]["messages"]


def test_bedrock_messages_cache_point_skips_tool_messages() -> None:
    """cachePoint lands on text-only last messages, never on tool carriers."""
    from tollms.services.gateway.caching import CachingPlan, bedrock_messages

    plan = CachingPlan(enabled=True, strategy="bedrock", reason="test")
    tool_msgs = [
        {"role": "user", "content": [{"text": "weather?"}]},
        {"role": "assistant", "content": [
            {"toolUse": {"toolUseId": "tu_1", "name": "get_weather", "input": {}}}]},
    ]
    out = bedrock_messages(plan, tool_msgs)
    assert all("cachePoint" not in b for b in out[-1]["content"]), out
    assert out[-1]["content"] == [
        {"toolUse": {"toolUseId": "tu_1", "name": "get_weather", "input": {}}}]

    text_msgs = [{"role": "user", "content": [{"text": "hi"}]}]
    out = bedrock_messages(plan, text_msgs)
    assert out[0]["content"][-1] == {"cachePoint": {"type": "default"}}, out
