"""Cross-cutting reasoning x provider matrix (Subagent B scope).

Scenarios S4 (reasoning-None + compaction), S5 (reasoning x streaming),
S7 (public /v1 reasoning) and the §1.4 provider matrix, all with mocked
transports ONLY — no network, no live calls.

Ownership: api/gateway/service.py (validated/adapter reasoning level),
services/gateway/adapters/*, services/gateway/translators.py, public
gateway reasoning propagation. Compaction/shares/usage/conversation
services are exercised read-only through their public seams (injected
summarizer fake); never edited here.
"""

import asyncio
import json
import uuid

import httpx
import pytest

from tollms.api.conversations import compaction
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import (
    active_path,
    add_message,
    create_conversation,
    list_messages,
)
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.public_gateway import service as pg_service
from tollms.models.message import MessageStatus, Role
from tollms.models.provider import ProviderType
from tollms.services import generation as generation_engine
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    ChatMessage,
    ChatResult,
    StreamChunk,
)
from tollms.services.gateway.adapters.bedrock import (
    BedrockAdapter,
    bedrock_thinking_fields,
    resolve_bedrock_model_id,
)
from tollms.services.gateway.adapters.gemini import GeminiAdapter, VertexAdapter
from tollms.services.gateway.adapters.openai import CustomAdapter, OpenAIChatAdapter, OpenAIResponsesAdapter
from tollms.services.gateway.factory import adapter_class, build_adapter
from tollms.services.gateway import translators


def _run(coro):
    return asyncio.run(coro)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _sse(*lines: str) -> httpx.Response:
    return httpx.Response(200, content="\n".join(lines).encode())


ANTHROPIC_THINKING = [
    'data: {"type": "message_start", "message": {"usage": {"input_tokens": 12}}}',
    'data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}}',
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Considering "}}',
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "it."}}',
    'data: {"type": "content_block_stop", "index": 0}',
    'data: {"type": "content_block_start", "index": 1, "content_block": {"type": "text"}}',
    'data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Answer."}}',
    'data: {"type": "message_delta", "usage": {"output_tokens": 9}}',
    'data: {"type": "message_stop"}',
]

ANTHROPIC_TEXT = [
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}}',
    'data: {"type": "message_stop"}',
]


def _stream_text(adapter) -> str:
    async def _main() -> str:
        parts = []
        async for chunk in adapter.chat_stream([ChatMessage(role="user", content="hi")]):
            parts.append(chunk.delta)
        return "".join(parts)

    return _run(_main())


@pytest.fixture(autouse=True)
def _reset_summarizer():
    compaction.reset_summarizer()
    yield
    compaction.reset_summarizer()


def _set_catalog(db, model_id: str, options) -> None:
    """Per-model reasoning prefs via metadata (no source edits)."""
    from tollms.models.registered_model import AIModel

    row = db.get(AIModel, uuid.UUID(model_id))
    meta = dict(row.metadata_ or {})
    meta["reasoning_options"] = options
    row.metadata_ = meta
    db.commit()


# --- S4: reasoning-None + compaction -------------------------------------------


def _long_conversation(db, provider: dict, model: dict, chars: int = 450, count: int = 30):
    conv = create_conversation(
        db,
        ConversationCreate(
            title="Long",
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        None,
    )
    for i in range(count):
        role = Role.USER if i % 2 == 0 else Role.ASSISTANT
        add_message(
            db, conv.id, role, f"turn {i} " + ("word " * (chars // 5)),
            provider_id=uuid.UUID(provider["id"]), model_id=uuid.UUID(model["id"]),
            user_id=None,
        )
    db.commit()
    return conv


def _two_step_anthropic(bodies: list):
    """First POST (summarizer) -> summary text; later POSTs -> answer text."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/messages"
        body = json.loads(request.content)
        bodies.append(body)
        text = "Canned summary." if len(bodies) == 1 else "Hi"
        return _sse(
            'data: {"type": "content_block_delta", "index": 0, '
            f'"delta": {{"type": "text_delta", "text": "{text}"}}}}',
            'data: {"type": "message_stop"}',
        )

    return handler


def test_s4_none_auto_compact_omits_thinking_on_both_calls(db, provider_factory, model_factory) -> None:
    """None set on a long convo: summary + main generation both omit the
    thinking field; the summary substitutes into context."""
    p = provider_factory("S4None", ptype="ANTHROPIC_MESSAGES", creds={"api_key": "k"})
    m = model_factory(
        p["id"], supports_reasoning=True, context_window=4200, max_output_tokens=64000,
    )
    conv = _long_conversation(db, p, m)
    bodies: list = []
    req = ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        conversation_id=conv.id, message="follow-up " + ("word " * 90),
        reasoning_level="none",
    )
    resp = _run(gateway_service.run_chat(db, req, _transport(_two_step_anthropic(bodies))))
    assert resp.content == "Hi"
    assert len(bodies) == 2, f"expected summary + main calls, got {len(bodies)}"
    assert all("thinking" not in body for body in bodies)
    assert "Canned summary" in (bodies[1].get("system") or "")
    summaries = [msg for msg in list_messages(db, conv.id) if msg.role == Role.SUMMARY]
    assert len(summaries) == 1


def test_s4_low_auto_compact_requests_thinking_without_mutation(db, provider_factory, model_factory) -> None:
    """Switch none -> low: the MAIN generation carries the budget; the
    summary call never buys thinking (forced off, adapter untouched)."""
    p = provider_factory("S4Low", ptype="ANTHROPIC_MESSAGES", creds={"api_key": "k"})
    m = model_factory(
        p["id"], supports_reasoning=True, context_window=4200, max_output_tokens=64000,
    )
    conv = _long_conversation(db, p, m)
    bodies: list = []
    req = ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        conversation_id=conv.id, message="follow-up " + ("word " * 90),
        reasoning_level="low",
    )
    resp = _run(gateway_service.run_chat(db, req, _transport(_two_step_anthropic(bodies))))
    assert resp.content == "Hi"
    assert len(bodies) == 2
    assert "thinking" not in bodies[0]  # summary: never thinks
    assert bodies[1].get("thinking") == {"type": "enabled", "budget_tokens": 1024}


def test_s4_summarizer_never_overwrites_user_setting() -> None:
    """The summary call runs through the adapter with thinking forced off
    and without mutating its configured reasoning level."""
    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return _sse(
            'data: {"type": "content_block_delta", "index": 0, '
            '"delta": {"type": "text_delta", "text": "Brief."}}',
            'data: {"type": "message_stop"}',
        )

    adapter = AnthropicAdapter(
        credentials={"api_key": "k"}, model_id="claude-x",
        reasoning_level="high", max_output_tokens=64000,
        transport=_transport(handler),
    )
    text = _run(compaction._default_summarizer(adapter, "instruct", "transcript"))
    assert text == "Brief."
    assert adapter.reasoning_level == "high"  # untouched by the summary call
    assert "thinking" not in seen[-1]  # summary request buys no thinking


def test_s4_high_auto_compact_summary_omits_thinking(db, provider_factory, model_factory) -> None:
    """User level high: the summary request carries no thinking fields (no
    waste, no image+thinking 400 risk); the main generation keeps the high
    budget. User-level behavior for normal generations is unchanged."""
    p = provider_factory("S4High", ptype="ANTHROPIC_MESSAGES", creds={"api_key": "k"})
    m = model_factory(
        p["id"], supports_reasoning=True, context_window=4200, max_output_tokens=64000,
    )
    conv = _long_conversation(db, p, m)
    bodies: list = []
    req = ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        conversation_id=conv.id, message="follow-up " + ("word " * 90),
        reasoning_level="high",
    )
    resp = _run(gateway_service.run_chat(db, req, _transport(_two_step_anthropic(bodies))))
    assert resp.content == "Hi"
    assert len(bodies) == 2, f"expected summary + main calls, got {len(bodies)}"
    assert "thinking" not in bodies[0]
    assert bodies[1].get("thinking") == {"type": "enabled", "budget_tokens": 10000}


def test_s4_per_model_prefs_and_unsupported_omission(db, provider_factory, model_factory) -> None:
    """Catalog prefs gate per model: effort [low] collapses high -> None on
    both planes; Gemini rows without supports_reasoning omit thinkingConfig."""
    from types import SimpleNamespace

    assert gateway_service.validated_reasoning_level(
        SimpleNamespace(metadata_={"reasoning_options": [{"type": "effort", "values": ["low"]}]}), "high"
    ) is None
    assert gateway_service.validated_reasoning_level(
        SimpleNamespace(metadata_={"reasoning_options": [{"type": "effort", "values": ["low", "high"]}]}), "high"
    ) == "high"

    p = provider_factory("S4Prefs", ptype="GEMINI", creds={"api_key": "k"})
    narrow = model_factory(p["id"], supports_reasoning=True, model_id="narrow", name="N")
    _set_catalog(db, narrow["id"], [{"type": "effort", "values": ["low"]}])
    bodies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _sse('data: {"candidates": [{"content": {"parts": [{"text": "Hi"}]}}]}')

    req = ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(narrow["id"]),
        message="hi", reasoning_level="high",
    )
    resp = _run(gateway_service.run_chat(db, req, _transport(handler)))
    assert resp.content == "Hi"
    assert "generationConfig" not in bodies[-1]  # collapsed to off, nothing sent

    # Gemini row without supports_reasoning: high is forced off, never 400s.
    plain = model_factory(p["id"], model_id="plain-g", name="P")
    bodies.clear()
    req2 = ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(plain["id"]),
        message="hi", reasoning_level="high",
    )
    resp2 = _run(gateway_service.run_chat(db, req2, _transport(handler)))
    assert resp2.content == "Hi"
    assert "generationConfig" not in bodies[-1]


# --- S5: reasoning x streaming --------------------------------------------------


class _CaptureAdapter(OpenAIChatAdapter):
    """Mocked-wire adapter: records the level, replays fixed text + usage."""

    instances: list = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        _CaptureAdapter.instances.append(self)

    async def chat_stream(self, messages):
        yield StreamChunk(delta="Hello")
        yield StreamChunk(
            delta=" world", prompt_tokens=10, completion_tokens=5, total_tokens=15,
            reasoning_tokens=7,
        )


async def _await_task(generation_id):
    """Terminal SSE is emitted before the driver pops the registry: await the
    task so is_active()/locks read settled state (no stale 409s)."""
    active = generation_engine.manager.get(generation_id)
    if active is not None and active.task is not None:
        await active.task


def _start_and_drain(db, req):
    """Start + drain inside one loop: the background task only lives while
    its loop runs (a second asyncio.run would cancel it on exit)."""

    async def _main():
        started = await gateway_service.start_generation(db, req)
        events = []
        async for raw in gateway_service.stream_events(db, started.generation_id, None):
            assert raw.startswith("data: ")
            events.append(json.loads(raw[6:]))
        await _await_task(started.generation_id)
        return started, events

    return _run(_main())


@pytest.mark.parametrize("level", ["none", "low", "medium", "high"])
def test_s5_streaming_levels_preserved_end_to_end(db, provider_factory, model_factory, monkeypatch, level) -> None:
    """Config preserved start -> adapter -> persistence; usage exact, one log."""
    from tollms.models.request_log import RequestLog
    from sqlalchemy import select

    _CaptureAdapter.instances.clear()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _CaptureAdapter(
        credentials={"api_key": "k"}, model_id="m"))
    p = provider_factory(f"S5-{level}")
    m = model_factory(p["id"])
    started, events = _start_and_drain(db, ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        message="hi", reasoning_level=level,
    ))
    assert events[-1]["done"] is True
    assert events[-1]["status"] == "completed"
    assert _CaptureAdapter.instances[-1].reasoning_level == level
    row = gateway_service.get_message(db, started.generation_id, None)
    assert row.content == "Hello world"
    assert (row.prompt_tokens, row.completion_tokens, row.total_tokens) == (10, 5, 15)
    assert row.reasoning_tokens == 7
    logs = list(db.scalars(select(RequestLog).where(RequestLog.message_id == row.id)))
    assert len(logs) == 1 and logs[0].status == "success"


def test_s5_model_switch_stream_uses_new_prefs(db, provider_factory, model_factory, monkeypatch) -> None:
    """Regeneration on another model: the new model's prefs apply, no stale state."""
    _CaptureAdapter.instances.clear()
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _CaptureAdapter(
        credentials={"api_key": "k"}, model_id="m"))
    p = provider_factory("S5Switch")
    m1 = model_factory(p["id"], model_id="m-one", name="One")
    m2 = model_factory(p["id"], model_id="m-two", name="Two", max_output_tokens=64000)
    async def _main():
        first = await gateway_service.start_generation(
            db, ChatRequest(
                provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m1["id"]),
                message="hi", reasoning_level="none",
            ))
        async for _ in gateway_service.stream_events(db, first.generation_id, None):
            pass
        await _await_task(first.generation_id)
        assert _CaptureAdapter.instances[-1].reasoning_level == "none"
        regen = await gateway_service.start_regeneration(
            db, first.generation_id, model_id=uuid.UUID(m2["id"]), reasoning_level="high")
        async for _ in gateway_service.stream_events(db, regen.generation_id, None):
            pass
        await _await_task(regen.generation_id)
        return regen

    _run(_main())
    assert _CaptureAdapter.instances[-1].reasoning_level == "high"
    assert _CaptureAdapter.instances[-1].max_output_tokens == 64000


def test_s5_failed_stream_single_log_no_double_count(db, provider_factory, model_factory, monkeypatch) -> None:
    """Provider failure mid-stream: FAILED row, exactly one failed log, usage zeroed."""
    from tollms.models.request_log import RequestLog
    from sqlalchemy import select

    class _Failing(OpenAIChatAdapter):
        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial", prompt_tokens=4)
            raise RuntimeError("provider error 500: boom")

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _Failing(
        credentials={"api_key": "k"}, model_id="m"))
    p = provider_factory("S5Fail")
    m = model_factory(p["id"])
    started, events = _start_and_drain(db, ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        message="hi", reasoning_level="medium",
    ))
    assert events[-1]["status"] == "failed"
    row = gateway_service.get_message(db, started.generation_id, None)
    assert row.status.value == "failed"
    assert row.content == "partial"
    logs = list(db.scalars(select(RequestLog).where(RequestLog.message_id == row.id)))
    assert len(logs) == 1 and logs[0].status == "failed"


def test_s5_cancelled_stream_keeps_partial_no_stale_state(db, provider_factory, model_factory, monkeypatch) -> None:
    """Cancel mid-think: CANCELLED, partial text kept, thinking_ms set, one log."""
    from tollms.models.request_log import RequestLog
    from sqlalchemy import select

    class _Thinking(OpenAIChatAdapter):
        async def chat_stream(self, messages):
            yield StreamChunk(delta=THINK_OPEN)
            await asyncio.sleep(10)  # cancelled while thinking
            yield StreamChunk(delta=THINK_CLOSE)

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _Thinking(
        credentials={"api_key": "k"}, model_id="m"))
    p = provider_factory("S5Cancel")
    m = model_factory(p["id"])
    async def _cancel():
        started = await gateway_service.start_generation(
            db, ChatRequest(
                provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                message="hi", reasoning_level="high",
            ))
        await asyncio.sleep(0.2)
        await gateway_service.cancel_generation(db, started.generation_id, None)
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = _run(_cancel())
    row = gateway_service.get_message(db, started.generation_id, None)
    assert row.status.value == "cancelled"
    assert row.content == THINK_OPEN
    assert row.thinking_ms is not None and row.thinking_ms >= 100
    logs = list(db.scalars(select(RequestLog).where(RequestLog.message_id == row.id)))
    assert len(logs) == 1 and logs[0].status == "cancelled"


# --- S7: public /v1 reasoning ----------------------------------------------------


def _pg_key(client) -> tuple[str, str]:
    r = client.post("/api/v1/keys", json={"name": "S7 key"})
    assert r.status_code == 201, r.text
    body = r.json()
    return body["raw_key"], body["key"]["id"]


def _pg_bind(monkeypatch, seen: dict) -> None:
    class _Recording:
        reasoning_level = "unset"

        async def chat(self, messages):
            return ChatResult(text="Hello world", prompt_tokens=10,
                              completion_tokens=5, total_tokens=15)

        async def chat_stream(self, messages):
            yield StreamChunk(delta="Hello world", prompt_tokens=10,
                              completion_tokens=5, total_tokens=15)

    fake = _Recording()
    seen["fake"] = fake
    monkeypatch.setattr(pg_service, "build_adapter", lambda *a, **k: fake)


def test_s7_public_levels_translation_and_usage(client, db, provider_factory, model_factory, monkeypatch) -> None:
    """Authorized key: all levels translate on all chat endpoints; usage logged."""
    from tollms.models.api_key import ApiRequestLog
    from sqlalchemy import select

    seen: dict = {}
    _pg_bind(monkeypatch, seen)
    provider_factory("S7Pub")
    p = {"name": "S7Pub"}
    # Re-resolve the created provider id via the registry listing.
    providers = client.get("/api/v1/providers").json()
    pid = next(x["id"] for x in providers if x["name"] == "S7Pub")
    think = model_factory(pid, model_id="thinker", name="T", supports_reasoning=True)
    _ = think
    raw, _kid = _pg_key(client)
    headers = {"Authorization": f"Bearer {raw}"}
    ref = "S7Pub/thinker"

    for endpoint, body in [
        ("/v1/chat/completions", {"model": ref, "messages": [{"role": "user", "content": "hi"}]}),
        ("/v1/responses", {"model": ref, "input": "hi"}),
        ("/v1/messages", {"model": ref, "max_tokens": 16, "messages": [{"role": "user", "content": "hi"}]}),
    ]:
        for req_level, want in [("none", "none"), ("low", "low"), ("medium", "medium"), ("high", "high")]:
            payload = dict(body, reasoning_level=req_level)
            r = client.post(endpoint, json=payload, headers=headers)
            assert r.status_code == 200, (endpoint, req_level, r.text)
            assert seen["fake"].reasoning_level == want, (endpoint, req_level)

    rows = list(db.scalars(select(ApiRequestLog)))
    assert rows and all(row.status == "success" for row in rows)
    assert any((row.input_tokens or 0) > 0 for row in rows)


def test_s7_public_streaming_unsupported_and_unauthorized(client, provider_factory, model_factory, monkeypatch) -> None:
    """Streaming carries reasoning; unsupported combos 403 safely; no key 401s."""
    seen: dict = {}
    _pg_bind(monkeypatch, seen)
    provider_factory("S7Gate")
    providers = client.get("/api/v1/providers").json()
    pid = next(x["id"] for x in providers if x["name"] == "S7Gate")
    model_factory(pid, model_id="plain", name="P")
    model_factory(pid, model_id="thinker", name="T", supports_reasoning=True)
    raw, _kid = _pg_key(client)
    headers = {"Authorization": f"Bearer {raw}"}

    with client.stream(
        "POST", "/v1/chat/completions",
        json={"model": "S7Gate/thinker", "messages": [{"role": "user", "content": "hi"}],
              "stream": True, "reasoning_level": "low"},
        headers=headers,
    ) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert seen["fake"].reasoning_level == "low"
    assert "Hello world" in text and "data: [DONE]" in text

    denied = client.post(
        "/v1/chat/completions",
        json={"model": "S7Gate/plain", "messages": [{"role": "user", "content": "hi"}],
              "reasoning_level": "high"},
        headers=headers,
    )
    assert denied.status_code == 403, denied.text
    assert "supports_reasoning" in denied.text

    assert client.post(
        "/v1/chat/completions",
        json={"model": "S7Gate/thinker", "messages": [{"role": "user", "content": "hi"}]},
    ).status_code == 401
    bad = client.post(
        "/v1/chat/completions",
        json={"model": "S7Gate/thinker", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": "Bearer tma_sk_live_nope"},
    )
    assert bad.status_code == 401, bad.text


def test_s7_public_catalog_collapse_matches_internal(client, db, provider_factory, model_factory, monkeypatch) -> None:
    """Regression: the public plane applies the same catalog gate as internal —
    a level the model does not offer collapses to off instead of enabling."""
    seen: dict = {}
    _pg_bind(monkeypatch, seen)
    provider_factory("S7Cat")
    providers = client.get("/api/v1/providers").json()
    pid = next(x["id"] for x in providers if x["name"] == "S7Cat")
    narrow = model_factory(pid, model_id="narrow", name="N", supports_reasoning=True)
    _set_catalog(db, narrow["id"], [{"type": "effort", "values": ["low"]}])
    raw, _kid = _pg_key(client)
    headers = {"Authorization": f"Bearer {raw}"}

    ok = client.post(
        "/v1/chat/completions",
        json={"model": "S7Cat/narrow", "messages": [{"role": "user", "content": "hi"}],
              "reasoning_level": "high"},
        headers=headers,
    )
    assert ok.status_code == 200, ok.text
    assert seen["fake"].reasoning_level is None

    ok = client.post(
        "/v1/chat/completions",
        json={"model": "S7Cat/narrow", "messages": [{"role": "user", "content": "hi"}],
              "reasoning_level": "low"},
        headers=headers,
    )
    assert ok.status_code == 200, ok.text
    assert seen["fake"].reasoning_level == "low"


# --- §1.4 provider matrix (mocked transports only) -------------------------------


def test_matrix_openai_chat_serialization_tools_reasoning_usage_error() -> None:
    bodies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        bodies.append(json.loads(request.content))
        content = (
            'data: {"choices": [{"delta": {"reasoning_content": "R", "tool_calls": '
            '[{"index": 0, "id": "call_1", "function": {"name": "get_weather", "arguments": "{}"}}]}}]}\n\n'
            'data: {"choices": [{"delta": {"content": "Sunny"}}]}\n\n'
            'data: {"choices": [{"delta": {}, "finish_reason": "tool_calls"}], '
            '"usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28, '
            '"completion_tokens_details": {"reasoning_tokens": 6}, '
            '"prompt_tokens_details": {"cached_tokens": 5}}}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, content=content.encode())

    adapter = OpenAIChatAdapter(
        credentials={"api_key": "k"}, model_id="gpt-x",
        reasoning_level="high", max_output_tokens=64000,
        transport=_transport(handler),
    )
    messages = [
        ChatMessage(role="system", content="sys"),
        ChatMessage(role="user", content="weather?"),
        ChatMessage(role="assistant", content="",
                    extra={"tool_calls": [{"id": "call_1", "function": {"name": "get_weather", "arguments": "{}"}}]}),
        ChatMessage(role="tool", content='{"temp": 21}', extra={"tool_call_id": "call_1"}),
    ]
    result = _run(adapter.chat(messages))

    body = bodies[-1]
    assert [m["role"] for m in body["messages"]] == ["system", "user", "assistant", "tool"]  # order kept
    assert body["messages"][0]["content"] == "sys"  # system stays inline
    assert body["reasoning_effort"] == "high"
    assert body["messages"][2]["tool_calls"][0]["id"] == "call_1"  # pairing kept
    assert body["messages"][3]["tool_call_id"] == "call_1"
    assert result.text == f"{THINK_OPEN}R{THINK_CLOSE}Sunny"
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (20, 8, 28)
    assert result.cache_read_tokens == 5 and result.reasoning_tokens == 6
    assert result.tool_calls and result.tool_calls[0]["name"] == "get_weather"
    assert result.finish_reason == "tool_calls"

    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "bad request"}})

    bad = OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="gpt-x", transport=_transport(failing))
    with pytest.raises(RuntimeError, match="provider error 400"):
        _stream_text(bad)


def test_matrix_openai_chat_none_omits_reasoning() -> None:
    bodies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    for level in (None, "none", "default"):
        OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="m",
                          reasoning_level=level, transport=_transport(handler))
        _stream_text(OpenAIChatAdapter(
            credentials={"api_key": "k"}, model_id="m",
            reasoning_level=level, transport=_transport(handler)))
    assert all("reasoning_effort" not in body for body in bodies)


def test_matrix_openai_responses_input_reasoning_usage() -> None:
    bodies: list = []
    lines = [
        'data: {"type": "response.reasoning_summary_text.delta", "delta": "Checking"}',
        'data: {"type": "response.output_text.delta", "delta": "Done."}',
        'data: {"type": "response.completed", "response": {"usage": '
        '{"input_tokens": 11, "output_tokens": 4, "total_tokens": 15, '
        '"output_tokens_details": {"reasoning_tokens": 3}}}}',
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        bodies.append(json.loads(request.content))
        return _sse(*lines)

    adapter = OpenAIResponsesAdapter(
        credentials={"api_key": "k"}, model_id="o4",
        reasoning_level="medium", transport=_transport(handler),
    )
    text = _stream_text(adapter)
    assert text == f"{THINK_OPEN}Checking{THINK_CLOSE}Done."
    body = bodies[-1]
    assert body["reasoning"] == {"effort": "medium", "summary": "auto"}
    assert body["input"][0]["role"] == "user"  # recent order kept
    # usage parsed through the non-streaming collector over the same SSE
    collected = _run(_collect(adapter))
    assert (collected.prompt_tokens, collected.completion_tokens, collected.reasoning_tokens) == (11, 4, 3)


async def _collect(adapter) -> ChatResult:
    return await adapter.chat([ChatMessage(role="user", content="hi")])


def test_matrix_anthropic_system_thinking_tools_usage_limits() -> None:
    bodies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _sse(*ANTHROPIC_THINKING)

    adapter = AnthropicAdapter(
        credentials={"api_key": "k"}, model_id="claude-x",
        reasoning_level="medium", max_output_tokens=64000,
        transport=_transport(handler),
    )
    messages = [
        ChatMessage(role="system", content="sys"),
        ChatMessage(role="user", content="hi"),
        ChatMessage(role="assistant", content="",
                    extra={"tool_calls": [{"id": "t1", "function": {"name": "f", "arguments": "{}"}}]}),
        ChatMessage(role="tool", content="42", extra={"tool_call_id": "t1"}),
    ]
    text = _run(_collect_messages(adapter, messages))
    assert text == f"{THINK_OPEN}Considering it.{THINK_CLOSE}Answer."
    body = bodies[-1]
    assert body["system"] == "sys"  # system extracted, not in messages
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 4096}
    assert body["max_tokens"] == 64000  # budget < max_tokens, no clamp-down
    tool_use = body["messages"][1]["content"][-1]
    assert tool_use["type"] == "tool_use" and tool_use["name"] == "f"
    tool_result = body["messages"][2]["content"][0]
    assert tool_result["type"] == "tool_result" and tool_result["tool_use_id"] == "t1"

    # context-limit clamp: ultra budget exceeds a small window -> clamped, then disabled
    from tollms.services.gateway.adapters.base import thinking_params

    assert thinking_params("ultra", 64000) == (32000, 64000)
    assert thinking_params("ultra", 2048) is None or thinking_params("ultra", 2048)[0] <= 2048


async def _collect_messages(adapter, messages):
    parts = []
    async for chunk in adapter.chat_stream(messages):
        parts.append(chunk.delta)
    return "".join(parts)


def test_matrix_gemini_vertex_wire_and_omission() -> None:
    bodies: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert "generativelanguage" in request.url.host
        bodies.append(json.loads(request.content))
        return _sse('data: {"candidates": [{"content": {"parts": [{"thought": true, "text": "Hmm"}, {"text": "Yes"}]}}], '
                    '"usageMetadata": {"promptTokenCount": 6, "candidatesTokenCount": 3, '
                    '"totalTokenCount": 9, "thoughtsTokenCount": 2}}')

    adapter = GeminiAdapter(credentials={"api_key": "k"}, model_id="gemini-x",
                            reasoning_level="low", transport=_transport(handler))
    assert _stream_text(adapter) == f"{THINK_OPEN}Hmm{THINK_CLOSE}Yes"
    body = bodies[-1]
    assert body["contents"][0] == {"role": "user", "parts": [{"text": "hi"}]}  # system folds to user
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 1024}

    collected = _run(_collect(adapter))
    assert (collected.prompt_tokens, collected.completion_tokens, collected.reasoning_tokens) == (6, 3, 2)

    for off in (None, "none", "default"):
        bodies.clear()
        plain = GeminiAdapter(credentials={"api_key": "k"}, model_id="gemini-x",
                              reasoning_level=off, image_output=False, transport=_transport(handler))
        _stream_text(plain)
        assert "generationConfig" not in bodies[-1]

    # image output never combines with thinking, even at high
    bodies.clear()
    img = GeminiAdapter(credentials={"api_key": "k"}, model_id="gemini-img",
                        reasoning_level="high", image_output=True, transport=_transport(handler))
    _stream_text(img)
    assert bodies[-1]["generationConfig"] == {"responseModalities": ["TEXT", "IMAGE"]}

    # vertex shares the wire; auth + path asserted
    seen: list = []

    def vhandler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return _sse('data: {"candidates": [{"content": {"parts": [{"text": "V"}]}}]}')

    vertex = VertexAdapter(
        credentials={"project_id": "p", "location": "us-central1", "credentials_json": "{}"},
        model_id="gemini-x", reasoning_level="high", transport=_transport(vhandler))
    vertex._access_token = lambda: "tok"  # type: ignore[method-assign]
    assert _stream_text(vertex) == "V"
    assert "us-central1-aiplatform.googleapis.com" in seen[-1]


def test_matrix_bedrock_converse_resolution_thinking_tools_usage() -> None:
    assert resolve_bedrock_model_id("bedrock/minimax.minimax-m2.5", "us-east-1") == "minimax.minimax-m2.5"
    assert resolve_bedrock_model_id("anthropic.claude-x", "eu-west-1") == "eu.anthropic.claude-x"
    assert resolve_bedrock_model_id("us.anthropic.claude-x", "eu-west-1") == "us.anthropic.claude-x"
    # adaptive-only generation routes to effort shape
    fields, _ = bedrock_thinking_fields("global.anthropic.claude-sonnet-5", "ultra", 64000)
    assert fields == {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}}
    # non-Claude families never get thinking fields (they 400 on them)
    assert bedrock_thinking_fields("us.deepseek.r1-v1:0", "high", 4096) is None

    captured: dict = {}
    events = [
        {"contentBlockDelta": {"delta": {"reasoningContent": {"text": "Plan "}}}},
        {"contentBlockStop": {}},
        {"contentBlockDelta": {"delta": {"text": "Result"}}},
        {"metadata": {"usage": {"inputTokens": 9, "outputTokens": 4, "totalTokens": 13}}},
    ]
    adapter = BedrockAdapter(
        credentials={"access_key": "a", "secret_key": "s", "region": "us-east-1"},
        model_id="anthropic.claude-haiku-4-5-20251001-v1:0",
        reasoning_level="medium", max_output_tokens=64000,
    )

    def fake_stream(payload):
        captured.update(payload)
        return iter(events)

    adapter._stream_events = fake_stream  # type: ignore[method-assign]
    messages = [
        ChatMessage(role="system", content="sys"),
        ChatMessage(role="user", content="hi"),
        ChatMessage(role="assistant", content="",
                    extra={"tool_calls": [{"id": "c1", "function": {"name": "calc", "arguments": '{"x":1}'}}]}),
        ChatMessage(role="tool", content="1", extra={"tool_call_id": "c1"}),
    ]
    text = _run(_collect_messages(adapter, messages))
    assert text == f"{THINK_OPEN}Plan {THINK_CLOSE}Result"
    assert captured["modelId"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert captured["system"] == [{"text": "sys"}]
    assert [m["role"] for m in captured["messages"]] == ["user", "assistant", "user"]
    assert captured["additionalModelRequestFields"] == {"thinking": {"type": "enabled", "budget_tokens": 4096}}
    assistant_blocks = captured["messages"][1]["content"]
    use = next(block for block in assistant_blocks if "toolUse" in block)
    assert use["toolUse"]["name"] == "calc" and use["toolUse"]["input"] == {"x": 1}
    result_block = captured["messages"][2]["content"][0]
    assert result_block["toolResult"]["status"] == "success"
    assert captured["toolConfig"]["tools"][0]["toolSpec"]["name"] == "calc"


def test_matrix_custom_openwebui_compat_path() -> None:
    """Custom OpenAI-compat gateways (incl. OpenWebUI-style base_url + extra
    headers): routing, auth, reasoning params, omission, errors."""
    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert str(request.url).startswith("http://openwebui.local:8080/api/v1/chat/completions")
        assert request.headers["Authorization"] == "Bearer ow-key"
        assert request.headers["x-openwebui-user"] == "tester"
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    adapter = CustomAdapter(
        credentials={"api_key": "ow-key", "base_url": "http://openwebui.local:8080/api/v1",
                     "extra_headers": {"x-openwebui-user": "tester"}},
        model_id="llama", reasoning_level="medium", transport=_transport(handler),
    )
    _stream_text(adapter)
    assert json.loads(seen[-1].content)["reasoning_effort"] == "medium"
    assert adapter_class(
        __import__("types").SimpleNamespace(provider_type=ProviderType.CUSTOM), "chat_completions"
    ) is CustomAdapter

    def err(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "slow down"})

    limited = CustomAdapter(
        credentials={"base_url": "http://mock"}, model_id="m", transport=_transport(err))
    with pytest.raises(RuntimeError, match="provider error 429"):
        _stream_text(limited)


def test_matrix_translators_tool_pairing_and_system_summary() -> None:
    unified = translators.from_openai_chat({
        "model": "p/m",
        "messages": [
            {"role": "system", "content": "be nice"},
            {"role": "user", "content": [{"type": "text", "text": "q"},
                                         {"type": "image_url", "image_url": {"url": "data:image/png;base64,aGk="}}]},
            {"role": "assistant", "content": "",
             "tool_calls": [{"id": "c9", "type": "function",
                             "function": {"name": "lookup", "arguments": "{}"}}]},
            {"role": "tool", "content": "found", "tool_call_id": "c9"},
        ],
        "reasoning_level": "low",
    })
    assert unified.reasoning_level == "low"
    assert unified.as_chat_messages()[0].role == "system"
    assert unified.messages[1].media and unified.messages[1].content == "q"
    assert unified.messages[2].extra["tool_calls"][0]["id"] == "c9"
    assert unified.messages[3].extra["tool_call_id"] == "c9"

    anthropic = translators.from_anthropic_messages({
        "model": "p/m", "max_tokens": 8,
        "system": [{"type": "text", "text": "sys-block"}],
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "look"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "aGk="}},
            {"type": "tool_use", "id": "t1", "name": "f", "input": {"a": 1}},
        ]}],
        "reasoning_level": "medium",
    })
    assert anthropic.system == "sys-block"
    assert anthropic.messages[0].media and anthropic.reasoning_level == "medium"
    assert anthropic.messages[0].extra["blocks"][0]["name"] == "f"

    responses = translators.from_responses(
        {"model": "p/m", "input": "hi", "instructions": "brief", "reasoning_level": "high"})
    assert responses.system == "brief" and responses.reasoning_level == "high"
