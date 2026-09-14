"""Gateway tests: routing, streaming, usage/cost persistence via a mock provider."""

import asyncio
import json
import uuid

import httpx
from sqlalchemy.orm import Session

from tollms.api.conversations.service import list_messages, usage_totals
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.gateway.service import run_chat, run_stream

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


def _transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chat/completions"
        return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler)


def _request(provider_id: str, model_id: str) -> ChatRequest:
    return ChatRequest(provider_id=uuid.UUID(provider_id), model_id=uuid.UUID(model_id), message="hi")


def test_chat_persists_messages_usage_cost(db: Session, provider_factory, model_factory) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    result = asyncio.run(run_chat(db, _request(p["id"], m["id"]), _transport()))
    assert result.content == "Hello world"
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (10, 5, 15)
    assert result.usage_estimated is False
    # input 2.5/1M * 10 = 0.000025 ; output 10/1M * 5 = 0.00005
    assert result.total_cost == result.input_cost + result.output_cost
    assert abs(float(result.total_cost) - 0.000075) < 1e-9

    messages = list_messages(db, result.conversation_id)
    assert [msg.role.value for msg in messages] == ["user", "assistant"]
    assert messages[1].content == "Hello world"
    assert messages[1].total_tokens == 15

    totals = usage_totals(db, result.conversation_id)
    assert totals.total_tokens == 15
    assert abs(float(totals.total_cost) - 0.000075) < 1e-9


def test_stream_emits_deltas_then_done(db: Session, provider_factory, model_factory) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    async def collect() -> list[dict]:
        events = []
        async for raw in run_stream(db, _request(p["id"], m["id"]), _transport()):
            assert raw.startswith("data: ")
            events.append(json.loads(raw[6:]))
        return events

    events = asyncio.run(collect())
    deltas = "".join(e.get("delta", "") for e in events)
    assert deltas == "Hello world"
    final = events[-1]
    assert final["done"] is True
    assert final["usage"] == {
        "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15,
        "cache_read_tokens": 0, "cache_write_tokens": 0, "reasoning_tokens": 0,
    }
    messages = list_messages(db, uuid.UUID(events[0]["conversation_id"]))
    assert len(messages) == 2


def test_chat_request_accepts_composer_fields(db: Session, provider_factory, model_factory) -> None:
    """Capability-aware composer payload: reasoning/attachments validate and send cleanly."""
    p = provider_factory("Mock")
    m = model_factory(p["id"])

    req = ChatRequest(
        provider_id=uuid.UUID(p["id"]),
        model_id=uuid.UUID(m["id"]),
        message="hi",
        reasoning_level="high",
        attachments=[{"name": "a.png", "size": 12, "mime": "image/png", "kind": "image"}],
    )
    assert req.reasoning_level == "high"
    assert req.attachments[0]["kind"] == "image"

    result = asyncio.run(run_chat(db, req, _transport()))
    assert result.content == "Hello world"

    # Old clients sending neither field still validate (backward compatible).
    assert _request(p["id"], m["id"]).attachments == []
