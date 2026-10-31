"""OpenAI chat tool_calls passthrough: translator -> adapter -> gateway."""

import asyncio
import json

import httpx
from fastapi.testclient import TestClient

from tollms.api.public_gateway import service as gateway_service
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.base import ChatResult
from tollms.services.gateway.adapters.openai import OpenAIChatAdapter

TOOLS = [{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object"}}}]

TOOL_SSE = (
    'data: {"choices": [{"index": 0, "delta": {"role": "assistant", "content": null, '
    '"tool_calls": [{"index": 0, "id": "call_1", "type": "function", '
    '"function": {"name": "get_weather", "arguments": "{\\"city\\":"}}]}, "finish_reason": null}]}\n\n'
    'data: {"choices": [{"index": 0, "delta": {"role": "assistant", '
    '"tool_calls": [{"index": 0, "function": {"arguments": "\\"SF\\"}"}}]}, "finish_reason": null}]}\n\n'
    'data: {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]}\n\n'
    'data: {"choices": [{"delta": {}}], '
    '"usage": {"prompt_tokens": 9, "completion_tokens": 6, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


class _FakeToolAdapter:
    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def chat(self, messages, tools=None, tool_choice=None):
        self._calls.append({"messages": messages, "tools": tools, "tool_choice": tool_choice})
        return ChatResult(
            text="",
            tool_calls=[{"id": "call_1", "name": "get_weather", "arguments": '{"city":"SF"}'}],
            finish_reason="tool_calls",
        )

    async def chat_stream(self, messages, tools=None, tool_choice=None):
        from tollms.services.gateway.adapters.base import StreamChunk

        yield StreamChunk(
            tool_call_delta={"index": 0, "id": "call_1", "name": "get_weather", "arguments_delta": '{"city":"SF"}'}
        )
        yield StreamChunk(finish_reason="tool_calls")
        yield StreamChunk(prompt_tokens=9, completion_tokens=6, total_tokens=15)


def _bind(monkeypatch, calls: list) -> None:
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeToolAdapter(calls)
    )


def _make_key(client: TestClient) -> str:
    response = client.post("/api/v1/keys", json={"name": "openai tool key"})
    assert response.status_code == 201, response.text
    return response.json()["raw_key"]


def _auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def test_translator_preserves_tool_calls_and_results() -> None:
    unified = translators.from_openai_chat(
        {
            "model": "openai/gpt",
            "tools": TOOLS,
            "tool_choice": "auto",
            "messages": [
                {"role": "user", "content": "weather?"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "get_weather", "arguments": '{"city":"SF"}'},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
            ],
        }
    )
    assert unified.tools == TOOLS
    assert unified.tool_choice == "auto"
    assistant, result = unified.messages[1], unified.messages[2]
    assert assistant.extra["tool_calls"][0]["id"] == "call_1"
    assert result.role == "tool"
    assert result.extra["tool_call_id"] == "call_1"
    assert result.content == "sunny"


def test_adapter_sends_and_parses_tool_calls() -> None:
    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=TOOL_SSE.encode())

    adapter = OpenAIChatAdapter(
        credentials={"api_key": "x"}, model_id="gpt", transport=httpx.MockTransport(handler)
    )
    unified = translators.from_openai_chat(
        {
            "model": "openai/gpt",
            "tools": TOOLS,
            "tool_choice": "auto",
            "messages": [{"role": "user", "content": "weather?"}],
        }
    )
    result = asyncio.run(
        adapter.chat(unified.as_chat_messages(), tools=unified.tools, tool_choice=unified.tool_choice)
    )
    assert len(captured) == 1
    assert captured[0]["tools"] == [{"type": "function", "function": {"name": "get_weather", "description": "", "parameters": {"type": "object"}}}]
    assert captured[0]["tool_choice"] == "auto"
    assert result.finish_reason == "tool_calls"
    assert result.tool_calls == [
        {"id": "call_1", "name": "get_weather", "arguments": '{"city":"SF"}'}
    ]


def test_chat_completions_tool_calls_roundtrip(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("OAITool")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "OAITool/tool-model",
            "tools": TOOLS,
            "tool_choice": "auto",
            "messages": [{"role": "user", "content": "weather?"}],
        },
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    choice = body["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"] == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "get_weather", "arguments": '{"city":"SF"}'},
        }
    ]
    assert calls and calls[0]["tools"] == TOOLS
    assert calls[0]["tool_choice"] == "auto"


def test_tool_result_followup_forwarded(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("OAIFollow")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "OAIFollow/tool-model",
            "tools": TOOLS,
            "messages": [
                {"role": "user", "content": "weather?"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "get_weather", "arguments": '{"city":"SF"}'},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
            ],
        },
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    forwarded = calls[0]["messages"]
    assert [message.role for message in forwarded] == ["user", "assistant", "tool"]
    assert forwarded[1].extra["tool_calls"][0]["id"] == "call_1"
    assert forwarded[2].extra["tool_call_id"] == "call_1"
    assert forwarded[2].content == "sunny"


def test_chat_completions_tool_stream_chunks(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("OAIStream")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    _bind(monkeypatch, [])
    raw = _make_key(client)

    with client.stream(
        "POST",
        "/v1/chat/completions",
        json={
            "model": "OAIStream/tool-model",
            "tools": TOOLS,
            "messages": [{"role": "user", "content": "weather?"}],
            "stream": True,
        },
        headers=_auth(raw),
    ) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert '"tool_calls"' in text
    assert '"finish_reason": "tool_calls"' in text or '"finish_reason":"tool_calls"' in text
    assert "data: [DONE]" in text


def test_normalize_cross_shape_tools() -> None:
    from tollms.services.gateway.adapters.openai import (
        _normalize_chat_tool_choice,
        _normalize_chat_tools,
        _normalize_responses_tool_choice,
        _normalize_responses_tools,
    )

    anthropic = [{"name": "w", "description": "d",
                  "input_schema": {"type": "object", "properties": {}}}]
    responses = [{"type": "function", "name": "w", "description": "d",
                  "parameters": {"type": "object"}}]
    chat = [{"type": "function", "function": {"name": "w", "description": "d",
                                             "parameters": {"type": "object"}}}]
    for shape, schema in ((anthropic, {"type": "object", "properties": {}}),
                          (responses, {"type": "object"}),
                          (chat, {"type": "object"})):
        norm = _normalize_chat_tools(shape)
        assert norm == [{"type": "function", "function": {
            "name": "w", "description": "d", "parameters": schema}}], shape
        rnorm = _normalize_responses_tools(shape)
        assert rnorm == [{"type": "function", "name": "w", "description": "d",
                          "parameters": schema}], shape
    assert _normalize_chat_tool_choice({"type": "any"}) == "required"
    assert _normalize_chat_tool_choice("any") == "required"
    assert _normalize_chat_tool_choice({"type": "tool", "name": "w"}) == {
        "type": "function", "function": {"name": "w"}}
    assert _normalize_responses_tool_choice("any") == "required"
    assert _normalize_responses_tool_choice({"type": "any"}) == {"type": "required"}
