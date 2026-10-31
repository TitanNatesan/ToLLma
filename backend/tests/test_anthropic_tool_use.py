"""Anthropic tool-use passthrough: translator -> adapter -> gateway.

Fake transports and fake adapters only: no provider network, no secrets.
"""

import json

import httpx
from fastapi.testclient import TestClient

from tollms.api.public_gateway import service as gateway_service
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import ChatResult

TOOLS = [
    {
        "name": "get_weather",
        "description": "city weather",
        "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
    }
]

TOOL_SSE = (
    'data: {"type": "message_start", "message": {"usage": {"input_tokens": 8}}}\n\n'
    'data: {"type": "content_block_start", "index": 1, '
    '"content_block": {"type": "tool_use", "id": "toolu_1", "name": "get_weather"}}\n\n'
    'data: {"type": "content_block_delta", "index": 1, '
    '"delta": {"type": "input_json_delta", "partial_json": "{\\"city\\":"}}\n\n'
    'data: {"type": "content_block_delta", "index": 1, '
    '"delta": {"type": "input_json_delta", "partial_json": "\\"SF\\"}"}}\n\n'
    'data: {"type": "content_block_stop", "index": 1}\n\n'
    'data: {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, '
    '"usage": {"output_tokens": 12}}\n\n'
)


class _FakeToolAdapter:
    """Gateway upstream double: records calls, replays a tool-use result."""

    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def chat(self, messages, tools=None, tool_choice=None):
        self._calls.append({"messages": messages, "tools": tools, "tool_choice": tool_choice})
        return ChatResult(
            text="",
            tool_calls=[{"id": "toolu_1", "name": "get_weather", "arguments": '{"city":"SF"}'}],
            finish_reason="tool_use",
        )

    async def chat_stream(self, messages, tools=None, tool_choice=None):  # pragma: no cover
        raise NotImplementedError


def _bind(monkeypatch, calls: list) -> None:
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeToolAdapter(calls)
    )


def _make_key(client: TestClient) -> str:
    response = client.post("/api/v1/keys", json={"name": "anthropic tool key"})
    assert response.status_code == 201, response.text
    return response.json()["raw_key"]


def _auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}", "anthropic-version": "2023-06-01"}


def test_translator_preserves_tool_use_blocks() -> None:
    unified = translators.from_anthropic_messages(
        {
            "model": "anthropic/claude",
            "max_tokens": 64,
            "tools": TOOLS,
            "tool_choice": {"type": "auto"},
            "messages": [
                {"role": "user", "content": "weather?"},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "checking"},
                        {
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "get_weather",
                            "input": {"city": "SF"},
                        },
                    ],
                },
            ],
        }
    )
    assert unified.tools == TOOLS
    assert unified.tool_choice == {"type": "auto"}
    assistant = unified.messages[1]
    assert assistant.content == "checking"
    assert assistant.extra["blocks"] == [
        {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "SF"}}
    ]


def test_translator_tool_result_followup_accepted() -> None:
    unified = translators.from_anthropic_messages(
        {
            "model": "anthropic/claude",
            "max_tokens": 64,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "toolu_1",
                            "content": [{"type": "text", "text": "sunny"}],
                        }
                    ],
                }
            ],
        }
    )
    followup = unified.messages[0]
    assert followup.content == "sunny"
    assert followup.extra["blocks"] == [
        {
            "type": "tool_result",
            "tool_use_id": "toolu_1",
            "content": [{"type": "text", "text": "sunny"}],
        }
    ]


def test_adapter_sends_tools_and_blocks() -> None:
    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append({"path": request.url.path, "body": json.loads(request.content)})
        return httpx.Response(200, content=TOOL_SSE.encode())

    adapter = AnthropicAdapter(
        credentials={"api_key": "x"}, model_id="claude", transport=httpx.MockTransport(handler)
    )
    unified = translators.from_anthropic_messages(
        {
            "model": "anthropic/claude",
            "max_tokens": 64,
            "tools": TOOLS,
            "tool_choice": {"type": "auto"},
            "messages": [
                {"role": "user", "content": "weather?"},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "toolu_1",
                            "content": "sunny",
                        }
                    ],
                },
            ],
        }
    )
    import asyncio

    result = asyncio.run(adapter.chat(unified.as_chat_messages(), tools=unified.tools, tool_choice=unified.tool_choice))

    assert len(captured) == 1
    body = captured[0]["body"]
    assert body["tools"] == TOOLS
    assert body["tool_choice"] == {"type": "auto"}
    assert {
        "type": "tool_result",
        "tool_use_id": "toolu_1",
        "content": "sunny",
    } in body["messages"][-1]["content"]
    assert result.finish_reason == "tool_use"
    assert result.tool_calls == [
        {"id": "toolu_1", "name": "get_weather", "arguments": '{"city":"SF"}'}
    ]


def test_messages_endpoint_tool_use_roundtrip(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("AnthTool")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)

    response = client.post(
        "/v1/messages",
        json={
            "model": "AnthTool/tool-model",
            "max_tokens": 64,
            "tools": TOOLS,
            "messages": [{"role": "user", "content": "weather?"}],
        },
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stop_reason"] == "tool_use"
    assert {
        "type": "tool_use",
        "id": "toolu_1",
        "name": "get_weather",
        "input": {"city": "SF"},
    } in body["content"]
    assert calls and calls[0]["tools"] == TOOLS


def test_no_tools_request_omits_tool_body(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("AnthPlain")
    model_factory(provider["id"], model_id="plain-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)

    response = client.post(
        "/v1/messages",
        json={
            "model": "AnthPlain/plain-model",
            "max_tokens": 64,
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    assert calls and calls[0]["tools"] is None
    assert calls[0]["tool_choice"] is None
