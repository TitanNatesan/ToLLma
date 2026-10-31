"""Anthropic tool-use streaming: tool events survive the SSE translation."""

import asyncio
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from tollms.api.public_gateway import service
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.base import StreamChunk

TOOLS = [{"name": "get_weather", "input_schema": {"type": "object"}}]


class _FakeStreamAdapter:
    """Replays one assistant turn with a tool call."""

    async def chat_stream(self, messages, tools=None, tool_choice=None):
        assert tools == TOOLS
        yield StreamChunk(delta="checking ")
        yield StreamChunk(
            tool_call_delta={"index": 0, "id": "toolu_1", "name": "get_weather", "arguments_delta": ""}
        )
        yield StreamChunk(
            tool_call_delta={"index": 0, "id": "toolu_1", "arguments_delta": '{"city":"SF"}'}
        )
        yield StreamChunk(finish_reason="tool_use")
        yield StreamChunk(prompt_tokens=8, completion_tokens=12, total_tokens=20)


def _prepared(response_format: str = "anthropic"):
    provider = SimpleNamespace(
        id=uuid.uuid4(),
        name="Mock",
        provider_type=SimpleNamespace(value="custom"),
        user_id=uuid.uuid4(),
    )
    model = SimpleNamespace(
        id=uuid.uuid4(),
        model_id="mock-model",
        provider_id=provider.id,
        input_price=Decimal("1"),
        output_price=Decimal("2"),
        cache_read_price=Decimal("0"),
        cache_write_price=Decimal("0"),
    )
    ctx = SimpleNamespace(key_id=uuid.uuid4(), user_id=provider.user_id, key_prefix="tma_x")
    unified = translators.from_anthropic_messages(
        {
            "model": "mock",
            "max_tokens": 64,
            "tools": TOOLS,
            "messages": [{"role": "user", "content": "weather?"}],
            "stream": True,
        }
    )
    unified.response_format = response_format
    return service._Prepared(
        ctx=ctx,
        meta=service.ClientMeta(request_id="req-1"),
        unified=unified,
        provider=provider,
        model=model,
        adapter=_FakeStreamAdapter(),
        messages=[],
        history_text="weather?",
        started=0.0,
    )


def _frames(prepared) -> list:
    async def _collect():
        return [frame async for frame in service._stream_chat(prepared, db=None)]

    with (
        patch.object(service, "find_for_model", return_value=None),
        patch.object(service, "record_usage", lambda *a, **k: None),
        patch.object(service, "log_request", lambda db, entry: None),
    ):
        return asyncio.run(_collect())


def _events(frames):
    out = []
    for frame in frames:
        event = data = None
        for line in frame.splitlines():
            if line.startswith("event: "):
                event = line[7:]
            if line.startswith("data: "):
                data = line[6:]
        if data is not None:
            out.append((event, json.loads(data)))
    return out


def test_anthropic_tool_streaming_frames() -> None:
    events = _events(_frames(_prepared()))
    kinds = [kind for kind, _ in events]
    assert kinds == [
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
    ]
    start = events[4][1]
    assert start["index"] == 1
    assert start["content_block"] == {"type": "tool_use", "id": "toolu_1", "name": "get_weather"}
    assert events[5][1]["delta"] == {"type": "input_json_delta", "partial_json": '{"city":"SF"}'}
    delta = events[7][1]
    assert delta["delta"]["stop_reason"] == "tool_use"


def test_text_only_stream_shape_unchanged() -> None:
    class _TextOnly:
        async def chat_stream(self, messages, tools=None, tool_choice=None):
            yield StreamChunk(delta="hi", prompt_tokens=1, completion_tokens=1, total_tokens=2)

    prepared = _prepared()
    prepared.adapter = _TextOnly()
    events = _events(_frames(prepared))
    assert [kind for kind, _ in events] == [
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
    ]
    assert events[4][1]["delta"]["stop_reason"] == "end_turn"


def test_messages_tool_stream_end_to_end(
    client: TestClient, provider_factory, model_factory, monkeypatch
) -> None:
    provider = provider_factory("AnthStream")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    monkeypatch.setattr(
        service, "build_adapter", lambda *a, **k: _FakeStreamAdapter()
    )
    raw = client.post("/api/v1/keys", json={"name": "k"}).json()["raw_key"]

    with client.stream(
        "POST",
        "/v1/messages",
        json={
            "model": "AnthStream/tool-model",
            "max_tokens": 64,
            "tools": TOOLS,
            "messages": [{"role": "user", "content": "weather?"}],
            "stream": True,
        },
        headers={"Authorization": f"Bearer {raw}", "anthropic-version": "2023-06-01"},
    ) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert '"type": "tool_use"' in text or '"type":"tool_use"' in text
    assert "input_json_delta" in text
    assert "tool_use" in text
