"""External gateway + guardrails: disabled guardrails never block tool calls.

No policies are configured here, so the pre/post hooks pass everything
through; the test locks that tools flow end to end in that state and that
the pre-check scan text includes tool definitions and arguments.
"""

from fastapi.testclient import TestClient

from tollms.api.public_gateway import service as gateway_service
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.base import ChatResult

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "city weather",
            "parameters": {"type": "object", "properties": {"city": {"type": "string"}}},
        },
    }
]


class _FakeToolAdapter:
    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def chat(self, messages, tools=None, tool_choice=None):
        self._calls.append({"messages": messages, "tools": tools, "tool_choice": tool_choice})
        return ChatResult(text="sunny", prompt_tokens=9, completion_tokens=3, total_tokens=12)

    async def chat_stream(self, messages, tools=None, tool_choice=None):  # pragma: no cover
        raise NotImplementedError


def _make_key(client: TestClient) -> str:
    response = client.post("/api/v1/keys", json={"name": "guardrail tool key"})
    assert response.status_code == 201, response.text
    return response.json()["raw_key"]


def _auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def test_disabled_guardrails_allow_tools(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    """No guardrail policies: tool definitions reach the provider untouched."""
    provider = provider_factory("GuardTool")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    calls: list = []
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeToolAdapter(calls)
    )
    raw = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "GuardTool/tool-model",
            "tools": TOOLS,
            "tool_choice": "auto",
            "messages": [{"role": "user", "content": "weather in SF?"}],
        },
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    assert response.json()["choices"][0]["message"]["content"] == "sunny"
    assert calls and calls[0]["tools"] == TOOLS
    assert calls[0]["tool_choice"] == "auto"


def test_guardrail_pre_text_covers_tools() -> None:
    """Pre-check scan text includes definitions, names, and arguments."""
    unified = translators.from_openai_chat(
        {
            "model": "m",
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
            ],
        }
    )
    text = gateway_service._guardrail_text(unified)
    assert "weather?" in text
    assert "tool:get_weather" in text
    assert "city weather" in text
    assert "tool_call:get_weather" in text
    assert "SF" in text


def test_guardrail_pre_text_covers_anthropic_blocks() -> None:
    unified = translators.from_anthropic_messages(
        {
            "model": "m",
            "max_tokens": 8,
            "tools": [{"name": "get_weather", "input_schema": {"type": "object"}}],
            "messages": [
                {
                    "role": "assistant",
                    "content": [
                        {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "SF"}}
                    ],
                }
            ],
        }
    )
    text = gateway_service._guardrail_text(unified)
    assert "tool:get_weather" in text
    assert "tool_call:get_weather" in text
    assert "SF" in text


def test_plain_requests_unchanged_without_tools(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("GuardPlain")
    model_factory(provider["id"], model_id="plain-model")
    calls: list = []
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeToolAdapter(calls)
    )
    raw = _make_key(client)

    response = client.post(
        "/v1/chat/completions",
        json={"model": "GuardPlain/plain-model", "messages": [{"role": "user", "content": "hi"}]},
        headers=_auth(raw),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["choices"][0]["finish_reason"] == "stop"
    assert body["choices"][0]["message"] == {"role": "assistant", "content": "sunny"}
    assert "tool_calls" not in body["choices"][0]["message"]
    assert calls and calls[0]["tools"] is None


class _FakeNoToolsAdapter:
    """Bedrock/Gemini-shaped: chat declares no tools param (text-only)."""

    async def chat(self, messages):
        return ChatResult(text="sunny", prompt_tokens=9, completion_tokens=3, total_tokens=12)

    async def chat_stream(self, messages):  # pragma: no cover
        raise NotImplementedError


def test_tools_rejected_when_adapter_lacks_tools_param(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    """Tools routed to a text-only adapter are an explicit 403, never silent."""
    provider = provider_factory("NoToolsProv")
    # Model flag passes the capability gate; the adapter shape must still deny.
    model_factory(provider["id"], model_id="no-tools-model", supports_tool_calling=True)
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeNoToolsAdapter()
    )
    raw = _make_key(client)

    denied = client.post(
        "/v1/chat/completions",
        json={
            "model": "NoToolsProv/no-tools-model",
            "tools": TOOLS,
            "tool_choice": "auto",
            "messages": [{"role": "user", "content": "weather in SF?"}],
        },
        headers=_auth(raw),
    )
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.text

    # Tools-less requests keep working through the same adapter.
    ok = client.post(
        "/v1/chat/completions",
        json={
            "model": "NoToolsProv/no-tools-model",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=_auth(raw),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["choices"][0]["message"]["content"] == "sunny"


def test_tools_rejected_when_adapter_lacks_tools_param_streaming(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    """Streaming path returns the same 403 model_not_allowed shape, not a 200."""
    provider = provider_factory("NoToolsStreamProv")
    model_factory(provider["id"], model_id="no-tools-stream-model", supports_tool_calling=True)
    monkeypatch.setattr(
        gateway_service, "build_adapter", lambda *a, **k: _FakeNoToolsAdapter()
    )
    raw = _make_key(client)

    with client.stream(
        "POST",
        "/v1/chat/completions",
        json={
            "model": "NoToolsStreamProv/no-tools-stream-model",
            "tools": TOOLS,
            "tool_choice": "auto",
            "messages": [{"role": "user", "content": "weather in SF?"}],
            "stream": True,
        },
        headers=_auth(raw),
    ) as response:
        assert response.status_code == 403, response.status_code
        body = response.read().decode()
    assert "model_not_allowed" in body
