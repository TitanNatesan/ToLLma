"""Streaming terminal usage: provider usage reaches SSE clients, ledger stays exactly-once."""

import asyncio
import json
import time
import uuid

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.public_gateway import service as pg_service
from tollms.models.api_key import ApiRequestLog
from tollms.models.message import Message
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services.api_keys import keys as key_engine
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.base import ChatMessage, StreamChunk

OPENAI_CACHE_SSE = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 100, "completion_tokens": 20,'
    ' "total_tokens": 120, "prompt_tokens_details": {"cached_tokens": 60}}}\n\n'
    "data: [DONE]\n\n"
)


def _transport(body: str) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode())

    return httpx.MockTransport(handler)


def _request(provider_id: str, model_id: str) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(provider_id), model_id=uuid.UUID(model_id), message="hi"
    )


def _run(coro):
    return asyncio.run(coro)


def _sse_data(frame: str):
    for line in frame.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload and payload != "[DONE]":
                return json.loads(payload)
    return None


class _CacheAdapter:
    """Upstream double replaying terminal cache/reasoning tokens."""

    async def chat_stream(self, messages):
        yield StreamChunk(delta="Hello")
        yield StreamChunk(
            delta=" world",
            prompt_tokens=100,
            completion_tokens=20,
            total_tokens=120,
            cache_read_tokens=60,
            cache_write_tokens=10,
            reasoning_tokens=7,
        )


def _prepared(db: Session, raw: str, provider_id: str, unified):
    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None
    provider = db.get(Provider, uuid.UUID(provider_id))
    model = db.scalar(
        select(AIModel).where(AIModel.provider_id == uuid.UUID(provider_id))
    )
    assert provider is not None and model is not None
    meta = pg_service.ClientMeta(request_id=f"usage-{uuid.uuid4().hex[:8]}")
    return pg_service._Prepared(
        ctx=ctx,
        meta=meta,
        unified=unified,
        provider=provider,
        model=model,
        adapter=_CacheAdapter(),
        messages=[ChatMessage(role="user", content="hi")],
        history_text="hi",
        started=time.monotonic(),
    )


def _make_key(client: TestClient) -> tuple[str, str]:
    r = client.post("/api/v1/keys", json={"name": "Stream usage key"})
    assert r.status_code == 201, r.text
    return r.json()["raw_key"], r.json()["key"]["id"]


def test_internal_terminal_row_carries_cache_usage(
    db: Session, provider_factory, model_factory
) -> None:
    p = provider_factory("TermCacheP")
    m = model_factory(p["id"])
    result = _run(
        gateway_service.run_chat(
            db, _request(p["id"], m["id"]), _transport(OPENAI_CACHE_SSE)
        )
    )
    assert result.cache_read_tokens == 60
    terminal = gateway_service._terminal_from_row(
        db, db.get(Message, result.message_id)
    )
    assert terminal["done"] is True
    assert terminal["usage"]["cache_read_tokens"] == 60
    assert terminal["usage"]["prompt_tokens"] == 100
    assert terminal["cost"]["total_cost"] != "0"


def test_internal_reattach_terminal_carries_usage(
    db: Session, provider_factory, model_factory
) -> None:
    p = provider_factory("ReattachP")
    m = model_factory(p["id"])
    result = _run(
        gateway_service.run_chat(
            db, _request(p["id"], m["id"]), _transport(OPENAI_CACHE_SSE)
        )
    )

    async def collect():
        return [
            json.loads(raw[6:])
            async for raw in gateway_service.stream_events(db, result.message_id)
        ]

    events = _run(collect())
    assert events[0]["status"] == "completed"
    terminal = events[-1]
    assert terminal["done"] is True
    assert terminal["usage"]["prompt_tokens"] == 100
    assert terminal["usage"]["cache_read_tokens"] == 60


def test_internal_live_stream_terminal_carries_usage(
    db: Session, provider_factory, model_factory
) -> None:
    p = provider_factory("LiveP")
    m = model_factory(p["id"])

    async def collect():
        return [
            json.loads(raw[6:])
            async for raw in gateway_service.run_stream(
                db, _request(p["id"], m["id"]), _transport(OPENAI_CACHE_SSE)
            )
        ]

    events = _run(collect())
    terminal = events[-1]
    assert terminal["done"] is True
    assert terminal["usage"] == {
        "prompt_tokens": 100,
        "completion_tokens": 20,
        "total_tokens": 120,
        "cache_read_tokens": 60,
        "cache_write_tokens": 0,
        "reasoning_tokens": 0,
    }
    logs = db.scalars(
        select(RequestLog).where(RequestLog.message_id == terminal["message_id"])
    ).all()
    assert len(logs) == 1
    assert logs[0].cache_read_tokens == 60


def test_public_openai_stream_terminal_includes_cache_and_reasoning(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    p = provider_factory("PubOpenaiU")
    model_factory(p["id"])
    raw, _ = _make_key(client)
    unified = translators.from_openai_chat(
        {"model": "m", "messages": [{"role": "user", "content": "hi"}], "stream": True}
    )
    prepared = _prepared(db, raw, p["id"], unified)
    frames = _run(_collect_all(prepared, db))
    terminal = next(d for d in (_sse_data(f) for f in frames) if d and d.get("usage"))
    assert terminal["usage"]["prompt_tokens_details"] == {"cached_tokens": 60}
    assert terminal["usage"]["completion_tokens_details"] == {"reasoning_tokens": 7}


def test_public_anthropic_stream_terminal_includes_cache_tokens(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    p = provider_factory("PubAnthU")
    model_factory(p["id"])
    raw, _ = _make_key(client)
    unified = translators.from_anthropic_messages(
        {
            "model": "m",
            "max_tokens": 64,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
        }
    )
    prepared = _prepared(db, raw, p["id"], unified)
    frames = _run(_collect_all(prepared, db))
    delta = next(
        d
        for d in (_sse_data(f) for f in frames)
        if d and d.get("type") == "message_delta"
    )
    assert delta["usage"]["cache_read_input_tokens"] == 60
    assert delta["usage"]["cache_creation_input_tokens"] == 10


def test_public_responses_stream_terminal_includes_cache_and_reasoning(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    p = provider_factory("PubRespU")
    model_factory(p["id"])
    raw, _ = _make_key(client)
    unified = translators.from_responses(
        {"model": "m", "input": "hello", "stream": True}
    )
    prepared = _prepared(db, raw, p["id"], unified)
    frames = _run(_collect_all(prepared, db))
    done = next(
        d
        for d in (_sse_data(f) for f in frames)
        if d and d.get("type") == "response.completed"
    )
    assert done["response"]["usage"]["input_tokens_details"] == {"cached_tokens": 60}
    assert done["response"]["usage"]["output_tokens_details"] == {"reasoning_tokens": 7}


def test_public_stream_persists_exactly_one_success_row(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    p = provider_factory("PubOnceU")
    model_factory(p["id"])
    raw, _ = _make_key(client)
    unified = translators.from_openai_chat(
        {"model": "m", "messages": [{"role": "user", "content": "hi"}], "stream": True}
    )
    prepared = _prepared(db, raw, p["id"], unified)
    _run(_collect_all(prepared, db))
    rows = list(
        db.scalars(
            select(ApiRequestLog).where(
                ApiRequestLog.request_id == prepared.meta.request_id
            )
        )
    )
    assert len(rows) == 1
    assert rows[0].status == "success"
    assert rows[0].cache_read_tokens == 60
    assert rows[0].is_streaming is True


def test_public_stream_disconnect_logs_single_cancelled(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    p = provider_factory("PubDiscU")
    model_factory(p["id"])
    raw, _ = _make_key(client)
    unified = translators.from_openai_chat(
        {"model": "m", "messages": [{"role": "user", "content": "hi"}], "stream": True}
    )

    class _Slow:
        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            import asyncio as _aio

            await _aio.sleep(30)

    prepared = _prepared(db, raw, p["id"], unified)
    prepared.adapter = _Slow()

    async def abandon():
        gen = pg_service._stream_chat(prepared, db)
        first = await gen.__anext__()
        assert "partial" in first
        await gen.aclose()

    _run(abandon())
    db.expire_all()
    rows = list(
        db.scalars(
            select(ApiRequestLog).where(
                ApiRequestLog.request_id == prepared.meta.request_id
            )
        )
    )
    assert len(rows) == 1
    assert rows[0].status == "cancelled"


async def _collect_all(prepared, db):
    return [frame async for frame in pg_service._stream_chat(prepared, db)]
