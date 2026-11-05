"""OpenAI Responses function tools: translator -> adapter -> gateway."""

import asyncio

import json

import httpx
from fastapi.testclient import TestClient

from tollms.api.public_gateway import service as gateway_service
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.base import ChatResult, StreamChunk
from tollms.services.gateway.adapters.openai import OpenAIResponsesAdapter

TOOLS = [{"type": "function", "name": "get_weather", "parameters": {"type": "object"}}]

RESP_SSE = (
    'data: {"type": "response.output_item.added", "sequence_number": 0, "output_index": 0, '
    '"item": {"type": "function_call", "id": "fc_1", "call_id": "call_1", '
    '"name": "get_weather", "arguments": ""}}\n\n'
    'data: {"type": "response.function_call_arguments.delta", "sequence_number": 1, '
    '"item_id": "call_1", "output_index": 0, "delta": "{\\"city\\":\\"SF\\"}"}\n\n'
    'data: {"type": "response.function_call_arguments.done", "sequence_number": 2, '
    '"item_id": "call_1", "output_index": 0, "arguments": "{\\"city\\":\\"SF\\"}"}\n\n'
    'data: {"type": "response.completed", "response": {"usage": '
    '{"input_tokens": 8, "output_tokens": 5, "total_tokens": 13}}}\n\n'
)


class _FakeResponsesAdapter:
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
        yield StreamChunk(
            tool_call_delta={"index": 0, "id": "call_1", "name": "get_weather", "arguments_delta": '{"city":"SF"}'}
        )
        yield StreamChunk(finish_reason="tool_calls")
        yield StreamChunk(prompt_tokens=8, completion_tokens=5, total_tokens=13)


def _bind(monkeypatch, calls: list) -> None:
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeResponsesAdapter(calls)
    )


def _make_key(client: TestClient) -> str:
    response = client.post("/api/v1/keys", json={"name": "responses tool key"})
    assert response.status_code == 201, response.text
    return response.json()["raw_key"]


def _auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def test_translator_preserves_function_call_items() -> None:
    unified = translators.from_responses(
        {
            "model": "gpt-5",
            "tools": TOOLS,
            "tool_choice": "auto",
            "input": [
                {"role": "user", "content": "weather?"},
                {"type": "function_call", "call_id": "call_1", "name": "get_weather", "arguments": '{"city":"SF"}'},
                {"type": "function_call_output", "call_id": "call_1", "output": "sunny"},
            ],
        }
    )
    assert unified.tools == TOOLS
    assert unified.tool_choice == "auto"
    assert unified.messages[1].extra["response_item"]["call_id"] == "call_1"
    assert unified.messages[2].role == "tool"
    assert unified.messages[2].extra["response_item"]["output"] == "sunny"


def test_adapter_sends_tools_and_parses_function_calls() -> None:
    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=RESP_SSE.encode())

    adapter = OpenAIResponsesAdapter(
        credentials={"api_key": "x"}, model_id="gpt", transport=httpx.MockTransport(handler)
    )
    unified = translators.from_responses(
        {
            "model": "gpt-5",
            "tools": TOOLS,
            "tool_choice": "auto",
            "input": "weather?",
        }
    )
    result = asyncio.run(
        adapter.chat(unified.as_chat_messages(), tools=unified.tools, tool_choice=unified.tool_choice)
    )
    assert len(captured) == 1
    assert captured[0]["tools"] == [{"type": "function", "name": "get_weather", "description": "", "parameters": TOOLS[0]["parameters"]}]
    assert captured[0]["tool_choice"] == "auto"
    assert result.tool_calls == [
        {"id": "call_1", "name": "get_weather", "arguments": '{"city":"SF"}'}
    ]


def test_responses_function_call_roundtrip(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("RespTool")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)

    response = client.post(
        "/v1/responses",
        json={"model": "RespTool/tool-model", "input": "weather?", "tools": TOOLS},
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["output"][0]["type"] == "message"
    assert body["output"][1] == {
        "type": "function_call",
        "id": "call_1",
        "call_id": "call_1",
        "name": "get_weather",
        "arguments": '{"city":"SF"}',
    }
    assert calls and calls[0]["tools"] == TOOLS


def test_responses_tool_stream_events(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("RespStream")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    _bind(monkeypatch, [])
    raw = _make_key(client)

    with client.stream(
        "POST",
        "/v1/responses",
        json={"model": "RespStream/tool-model", "input": "weather?", "tools": TOOLS, "stream": True},
        headers=_auth(raw),
    ) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert "response.output_item.added" in text
    assert "response.function_call_arguments.delta" in text
    assert "response.function_call_arguments.done" in text
    assert "response.completed" in text
