"""Cross-cutting tool-calling integration: pairing, compact, races, tool auth.

Contract under test (public plane owns tools; the backend never executes them):

- Tool definitions ride ``UnifiedRequest.tools`` -> adapter wire bodies; the
  model emits tool calls; the CLIENT executes them and returns ``tool_result``
  follow-ups. The backend forwards and serializes but never runs tools.
- The public plane persists no conversations/messages for tool traffic: one
  ``api_request_logs`` row per request (success/failed/cancelled) only.
- In-app chat sends no tool definitions (``ChatRequest`` has no tools surface)
  and history carries no invocation envelopes, so compaction only ever
  substitutes text + a summary. Synthetic tool pairs must still survive
  ``assemble_context`` substitution with pairing intact (no orphans, no broken
  ids, valid ordering per provider serialization).
- Unauthorized tool use is rejected at the backend (403/401/404), not just UI.

Fake transports/adapters only: no provider network. Serial, isolated DB.
"""

import asyncio
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.api.conversations import compaction
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import add_message, create_conversation
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.public_gateway import service as gateway_service
from tollms.core.exceptions import ConflictError
from tollms.models.api_key import ApiRequestLog
from tollms.models.message import Message, MessageStatus, Role
from tollms.services.gateway import translators
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import (
    ChatMessage,
    ChatResult,
    StreamChunk,
    _accumulate_tool_call,
)
from tollms.services.gateway.adapters.openai import OpenAIChatAdapter

WINDOW = 2000  # manual compact edge at 20% = 400 tokens

OAI_TOOLS = [
    {"type": "function", "function": {"name": "get_weather", "description": "city weather",
                                      "parameters": {"type": "object"}}},
    {"type": "function", "function": {"name": "get_time", "description": "current time",
                                      "parameters": {"type": "object"}}},
]

ANTH_TOOLS = [
    {"name": "get_weather", "description": "city weather",
     "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}}},
    {"name": "get_time", "description": "current time",
     "input_schema": {"type": "object"}},
]


@pytest.fixture(autouse=True)
def _reset_summarizer() -> Any:
    compaction.reset_summarizer()
    yield
    compaction.reset_summarizer()


def _fake_summarizer(text: str = "Canned summary of the covered history.") -> Any:
    async def _fn(adapter: Any, instruction: str, transcript: str) -> str:
        return text

    return _fn


def _user_id(client: TestClient) -> uuid.UUID:
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _owned(db: Any, client: TestClient, user_factory: Any, provider_factory: Any,
           model_factory: Any, email: str = "u@tollma.ai", **mkw: Any) -> tuple:
    user_factory(email=email)
    provider = provider_factory()
    model = model_factory(provider["id"], **mkw)
    return _user_id(client), provider, model


def _conv(db: Any, user_id: uuid.UUID, provider: dict, model: dict,
          title: str = "Tool compact") -> Any:
    return create_conversation(
        db,
        ConversationCreate(title=title, provider_id=uuid.UUID(provider["id"]),
                           model_id=uuid.UUID(model["id"])),
        user_id,
    )


def _fill(db: Any, conv_id: uuid.UUID, user_id: uuid.UUID,
          n_exchanges: int = 3, size: int = 620) -> None:
    for i in range(n_exchanges):
        add_message(db, conv_id, Role.USER, f"question {i} " + "q" * size, user_id=user_id)
        add_message(db, conv_id, Role.ASSISTANT, f"answer {i} " + "a" * size, user_id=user_id)


def _make_key(client: TestClient, name: str = "tool key") -> str:
    response = client.post("/api/v1/keys", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["raw_key"]


def _auth(raw: str) -> dict:
    return {"Authorization": f"Bearer {raw}"}


def assert_valid_tool_sequence(messages: list) -> tuple:
    """No orphans, no broken ids, valid ordering across tool shapes.

    Every tool result must reference a call emitted by an EARLIER assistant
    message. Trailing calls with no result yet are the pending-execution state
    and are allowed only in the last assistant message.
    """
    calls: dict = {}
    results: list = []
    last_assistant_index: int | None = None
    for index, message in enumerate(messages):
        extra = message.extra or {}
        if message.role == "assistant":
            last_assistant_index = index
        for call in extra.get("tool_calls") or []:
            function = call.get("function") or {}
            call_id, name = call.get("id"), function.get("name")
            assert isinstance(call_id, str) and call_id.strip(), f"broken call id: {call!r}"
            assert isinstance(name, str) and name.strip(), f"broken call name: {call!r}"
            assert call_id not in calls, f"duplicate call id: {call_id}"
            calls[call_id] = index
        for block in extra.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                call_id, name = block.get("id"), block.get("name")
                assert isinstance(call_id, str) and call_id.strip(), f"broken tool_use id: {block!r}"
                assert isinstance(name, str) and name.strip(), f"broken tool_use name: {block!r}"
                assert call_id not in calls, f"duplicate tool_use id: {call_id}"
                calls[call_id] = index
            elif block.get("type") == "tool_result":
                results.append((index, block.get("tool_use_id")))
        item = extra.get("response_item") or {}
        if isinstance(item, dict) and item.get("type") == "function_call":
            call_id = item.get("call_id") or item.get("id")
            assert isinstance(call_id, str) and call_id.strip(), f"broken function_call id: {item!r}"
            calls[call_id] = index
        if message.role == "tool":
            ref = extra.get("tool_call_id") or extra.get("call_id")
            output = item.get("output") if isinstance(item, dict) else None
            if output is not None:
                ref = item.get("call_id")
            assert isinstance(ref, str) and ref.strip(), "broken tool result id"
            results.append((index, ref))
    assert calls, "expected at least one tool call in the sequence"
    for result_index, ref in results:
        assert ref in calls, f"orphan tool result: {ref!r}"
        assert calls[ref] < result_index, f"result before its call: {ref!r}"
    pending = [cid for cid, at in calls.items()
               if not any(ref == cid for _, ref in results)]
    if pending:
        assert last_assistant_index is not None
        assert all(calls[cid] == last_assistant_index for cid in pending), \
            f"unresolved calls outside the pending turn: {pending!r}"
    return calls, results


# --- OpenAI Chat shape: definition -> call -> result -> continue -------------


def test_openai_tool_call_result_pairing() -> None:
    unified = translators.from_openai_chat({
        "model": "openai/gpt", "tools": OAI_TOOLS[:1], "tool_choice": "auto",
        "messages": [
            {"role": "user", "content": "weather in SF?"},
            {"role": "assistant", "content": None, "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny, 21C"},
        ],
    })
    calls, results = assert_valid_tool_sequence(unified.messages)
    assert set(calls) == {"call_1"} and len(results) == 1


def test_openai_multi_tool_pairing_ordered() -> None:
    unified = translators.from_openai_chat({
        "model": "openai/gpt", "tools": OAI_TOOLS, "tool_choice": "auto",
        "messages": [
            {"role": "user", "content": "weather and time?"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function",
                 "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}},
                {"id": "call_2", "type": "function",
                 "function": {"name": "get_time", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
            {"role": "tool", "tool_call_id": "call_2", "content": "noon"},
            {"role": "assistant", "content": "Sunny, and it is noon."},
        ],
    })
    calls, results = assert_valid_tool_sequence(unified.messages)
    assert list(calls) == ["call_1", "call_2"]
    assert [ref for _, ref in results] == ["call_1", "call_2"]


def _openai_tool_sse(calls: list) -> str:
    frames: list = []
    for pos, (call_id, name, args) in enumerate(calls):
        first, rest = args[:8], args[8:]
        frames.append({"choices": [{"index": 0,
                                     "delta": {"tool_calls": [
                                         {"index": pos, "id": call_id, "type": "function",
                                          "function": {"name": name, "arguments": first}}]},
                                     "finish_reason": None}]})
        frames.append({"choices": [{"index": 0,
                                     "delta": {"tool_calls": [
                                         {"index": pos, "function": {"arguments": rest}}]},
                                     "finish_reason": None}]})
    frames.append({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})
    frames.append({"choices": [{"delta": {}}],
                   "usage": {"prompt_tokens": 9, "completion_tokens": 6, "total_tokens": 15}})
    return "".join(f"data: {json.dumps(f)}\n\n" for f in frames) + "data: [DONE]\n\n"


def test_openai_adapter_receives_valid_sequence() -> None:
    captured: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=_openai_tool_sse(
            [("call_1", "get_weather", '{"city":"SF"}'),
             ("call_2", "get_time", "{}")]).encode())

    adapter = OpenAIChatAdapter(credentials={"api_key": "x"}, model_id="gpt",
                                transport=httpx.MockTransport(handler))
    unified = translators.from_openai_chat({
        "model": "openai/gpt", "tools": OAI_TOOLS, "tool_choice": "auto",
        "messages": [
            {"role": "user", "content": "weather and time?"},
            {"role": "assistant", "content": None, "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
        ],
    })
    result = asyncio.run(adapter.chat(unified.as_chat_messages(),
                                      tools=unified.tools, tool_choice=unified.tool_choice))
    assert len(captured) == 1
    body = captured[0]
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "tool"]
    assert body["messages"][1]["tool_calls"][0]["id"] == "call_1"
    assert body["messages"][2]["tool_call_id"] == "call_1"
    assert result.finish_reason == "tool_calls"
    assert result.tool_calls == [
        {"id": "call_1", "name": "get_weather", "arguments": '{"city":"SF"}'},
        {"id": "call_2", "name": "get_time", "arguments": "{}"},
    ]
    assert all("index" not in call for call in result.tool_calls)


def test_openai_streaming_deltas_accumulate_across_fragments() -> None:
    calls: list = []
    _accumulate_tool_call(calls, {"index": 0, "id": "call_1", "name": "get_weather",
                                  "arguments_delta": '{"city":'})
    _accumulate_tool_call(calls, {"index": 1, "id": "call_2", "name": "get_time",
                                  "arguments_delta": ""})
    _accumulate_tool_call(calls, {"index": 0, "id": "call_1", "arguments_delta": '"SF"}'})
    _accumulate_tool_call(calls, {"index": 1, "id": "call_2", "arguments_delta": '"}"'})
    assert [c["id"] for c in calls] == ["call_1", "call_2"]
    assert calls[0]["arguments"] == '{"city":"SF"}'
    by_id = {c.pop("id"): c for c in calls}
    assert_valid_tool_sequence([
        ChatMessage(role="assistant", content="", extra={"tool_calls": [
            {"id": cid, "function": {"name": c["name"], "arguments": c["arguments"]}}
            for cid, c in by_id.items()]}),
    ] + [ChatMessage(role="tool", content="ok", extra={"tool_call_id": cid})
         for cid in by_id])


# --- Anthropic shape: tool_use -> tool_result --------------------------------


def test_anthropic_tool_use_result_pairing() -> None:
    unified = translators.from_anthropic_messages({
        "model": "anthropic/claude", "max_tokens": 64, "tools": ANTH_TOOLS,
        "messages": [
            {"role": "user", "content": "weather in SF?"},
            {"role": "assistant", "content": [
                {"type": "text", "text": "checking"},
                {"type": "tool_use", "id": "toolu_1",
                 "name": "get_weather", "input": {"city": "SF"}}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "toolu_1",
                 "content": [{"type": "text", "text": "sunny"}]}]},
        ],
    })
    calls, results = assert_valid_tool_sequence(unified.messages)
    assert set(calls) == {"toolu_1"} and len(results) == 1


def _anthropic_tool_sse(blocks: list) -> str:
    lines = ['data: {"type": "message_start", '
             '"message": {"usage": {"input_tokens": 8}}}\n\n']
    for pos, (bid, name, arg_parts) in enumerate(blocks, start=1):
        lines.append(f'data: {{"type": "content_block_start", "index": {pos}, '
                     f'"content_block": {{"type": "tool_use", "id": "{bid}", "name": "{name}"}}}}\n\n')
        for part in arg_parts:
            lines.append(f'data: {{"type": "content_block_delta", "index": {pos}, '
                         f'"delta": {{"type": "input_json_delta", "partial_json": "{part}"}}}}\n\n')
        lines.append(f'data: {{"type": "content_block_stop", "index": {pos}}}\n\n')
    lines.append('data: {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, '
                 '"usage": {"output_tokens": 12}}\n\n')
    return "".join(lines)


def test_anthropic_adapter_receives_valid_sequence() -> None:
    captured: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append({"path": request.url.path, "body": json.loads(request.content)})
        return httpx.Response(200, content=_anthropic_tool_sse(
            [("toolu_1", "get_weather", ['{\\"city\\":', '\\"SF\\"}']),
             ("toolu_2", "get_time", ['{}'])]).encode())

    adapter = AnthropicAdapter(credentials={"api_key": "x"}, model_id="claude",
                               transport=httpx.MockTransport(handler))
    unified = translators.from_anthropic_messages({
        "model": "anthropic/claude", "max_tokens": 64, "tools": ANTH_TOOLS,
        "messages": [
            {"role": "user", "content": "weather?"},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "toolu_1", "content": "sunny"}]},
        ],
    })
    result = asyncio.run(adapter.chat(unified.as_chat_messages(),
                                      tools=unified.tools,
                                      tool_choice={"type": "auto"}))
    assert len(captured) == 1
    body = captured[0]["body"]
    assert body["tools"] == ANTH_TOOLS
    assert body["tool_choice"] == {"type": "auto"}
    assistant_blocks = [m for m in body["messages"] if m["role"] == "assistant"]
    assert assistant_blocks == []
    tool_results = [b for m in body["messages"] for b in m["content"]
                    if isinstance(b, dict) and b.get("type") == "tool_result"]
    assert tool_results and tool_results[0]["tool_use_id"] == "toolu_1"
    assert result.finish_reason == "tool_use"
    assert result.tool_calls == [
        {"id": "toolu_1", "name": "get_weather", "arguments": '{"city":"SF"}'},
        {"id": "toolu_2", "name": "get_time", "arguments": "{}"},
    ]
    assert all("index" not in call for call in result.tool_calls)


# --- public-plane lifecycle: persist nothing, stream, fail, cancel -----------


class _FakeToolAdapter:
    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def chat(self, messages: list, tools: Any = None,
                   tool_choice: Any = None) -> ChatResult:
        self._calls.append({"messages": messages, "tools": tools, "tool_choice": tool_choice})
        return ChatResult(text="", tool_calls=[
            {"id": "call_1", "name": "get_weather", "arguments": '{"city":"SF"}'}],
            finish_reason="tool_calls")

    async def chat_stream(self, messages: list, tools: Any = None,
                          tool_choice: Any = None) -> Any:
        yield StreamChunk(tool_call_delta={"index": 0, "id": "call_1",
                                           "name": "get_weather", "arguments_delta": '{"city":'})
        yield StreamChunk(tool_call_delta={"index": 0, "id": "call_1",
                                           "arguments_delta": '"SF"}'})
        yield StreamChunk(finish_reason="tool_calls")
        yield StreamChunk(prompt_tokens=9, completion_tokens=6, total_tokens=15)


def _bind(monkeypatch: Any, calls: list) -> None:
    monkeypatch.setattr(gateway_service, "build_adapter",
                        lambda *a, **k: _FakeToolAdapter(calls))


def test_tool_roundtrip_persists_no_messages(db: Any, client: TestClient, provider_factory: Any,
                                             model_factory: Any, monkeypatch: Any) -> None:
    provider = provider_factory("OAITool")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)
    response = client.post("/v1/chat/completions", json={
        "model": "OAITool/tool-model", "tools": OAI_TOOLS[:1], "tool_choice": "auto",
        "messages": [
            {"role": "user", "content": "weather?"},
            {"role": "assistant", "content": None, "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
        ]}, headers=_auth(raw))
    assert response.status_code == 200, response.text
    choice = response.json()["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"][0]["id"] == "call_1"
    forwarded = calls[0]["messages"]
    assert_valid_tool_sequence(forwarded)
    assert [m.role for m in forwarded] == ["user", "assistant", "tool"]
    assert forwarded[1].extra["tool_calls"][0]["id"] == "call_1"
    assert forwarded[2].extra["tool_call_id"] == "call_1"
    assert db.scalars(select(Message)).all() == []
    logs = db.scalars(select(ApiRequestLog)).all()
    assert len(logs) == 1 and logs[0].status == "success"


def test_tool_streaming_frames_keep_pairing(client: TestClient, provider_factory: Any,
                                            model_factory: Any, monkeypatch: Any) -> None:
    provider = provider_factory("OAIStream")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    _bind(monkeypatch, [])
    raw = _make_key(client)
    with client.stream("POST", "/v1/chat/completions", json={
            "model": "OAIStream/tool-model", "tools": OAI_TOOLS[:1], "stream": True,
            "messages": [{"role": "user", "content": "weather?"}]},
            headers=_auth(raw)) as response:
        assert response.status_code == 200, response.text
        text = response.read().decode()
    assert '"tool_calls"' in text and "call_1" in text
    assert "tool_calls" in text.split("finish_reason")[-1] and "data: [DONE]" in text


class _FakeFailAdapter:
    async def chat(self, messages: list, tools: Any = None,
                   tool_choice: Any = None) -> ChatResult:
        raise RuntimeError("provider error 500: upstream exploded")

    async def chat_stream(self, messages: list, tools: Any = None,
                          tool_choice: Any = None) -> Any:
        raise RuntimeError("provider error 500: upstream exploded")
        yield


def test_failed_tool_call_logs_failed_and_persists_nothing(
        db: Any, client: TestClient, provider_factory: Any, model_factory: Any,
        monkeypatch: Any) -> None:
    provider = provider_factory("OAIFail")
    model_factory(provider["id"], model_id="tool-model", supports_tool_calling=True)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: _FakeFailAdapter())
    raw = _make_key(client)
    response = client.post("/v1/chat/completions", json={
        "model": "OAIFail/tool-model", "tools": OAI_TOOLS[:1],
        "messages": [{"role": "user", "content": "weather?"}]}, headers=_auth(raw))
    assert response.status_code == 502, response.text
    assert response.json()["error"]["code"] == "PROVIDER_ERROR"
    assert db.scalars(select(Message)).all() == []
    logs = db.scalars(select(ApiRequestLog)).all()
    assert len(logs) == 1 and logs[0].status == "failed"
    assert logs[0].error_code == "PROVIDER_ERROR"


def _prepared(adapter: Any, response_format: str = "openai") -> Any:
    provider = SimpleNamespace(id=uuid.uuid4(), name="Mock",
                               provider_type=SimpleNamespace(value="custom"),
                               user_id=uuid.uuid4())
    model = SimpleNamespace(id=uuid.uuid4(), model_id="mock-model", provider_id=provider.id,
                            input_price=Decimal("1"), output_price=Decimal("2"),
                            cache_read_price=Decimal("0"), cache_write_price=Decimal("0"))
    ctx = SimpleNamespace(key_id=uuid.uuid4(), user_id=provider.user_id, key_prefix="tma_x")
    unified = translators.from_openai_chat({
        "model": "mock", "tools": OAI_TOOLS[:1],
        "messages": [{"role": "user", "content": "weather?"}], "stream": True})
    unified.response_format = response_format
    return gateway_service._Prepared(ctx=ctx, meta=gateway_service.ClientMeta(request_id="req-1"),
                                     unified=unified, provider=provider, model=model,
                                     adapter=adapter, messages=[], history_text="weather?",
                                     started=0.0)


def test_cancelled_tool_stream_logs_cancelled(monkeypatch: Any) -> None:
    logged: list = []

    class _CancelAdapter:
        async def chat_stream(self, messages: list, tools: Any = None,
                              tool_choice: Any = None) -> Any:
            yield StreamChunk(tool_call_delta={"index": 0, "id": "call_1",
                                               "name": "get_weather", "arguments_delta": ""})
            raise asyncio.CancelledError
            yield

    async def _collect() -> None:
        async for _ in gateway_service._stream_chat(_prepared(_CancelAdapter()), None):
            pass

    monkeypatch.setattr(gateway_service, "find_for_model", lambda *a, **k: None)
    monkeypatch.setattr(gateway_service, "record_usage", lambda *a, **k: None)
    monkeypatch.setattr(gateway_service, "log_request",
                        lambda db, entry: logged.append(entry))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(_collect())
    assert len(logged) == 1 and logged[0].status == "cancelled"


# --- compaction: pairing survives substitution, races stay 409 ----------------


def _summary_block(content: str = "Prior travel discussion.") -> SimpleNamespace:
    return SimpleNamespace(content=content)


def test_assemble_context_keeps_tool_pairing() -> None:
    tail = [
        ChatMessage(role="user", content="weather in SF?"),
        ChatMessage(role="assistant", content="", extra={"tool_calls": [{
            "id": "call_1", "type": "function",
            "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}]}),
        ChatMessage(role="tool", content="sunny, 21C", extra={"tool_call_id": "call_1"}),
        ChatMessage(role="assistant", content="It is sunny in SF."),
    ]
    messages, _ = compaction.assemble_context(
        None, system=None, stored_rows=[], latest_summary=_summary_block(), tail_rows=[],
        pending=None, trigger="manual", user_id=None, model=None, adapter=None,
        grouped={}, prebuilt_tail=(tail, 0))
    assert messages[0].role == "system" and "summary" in messages[0].content.lower()
    assert messages[1:] == tail
    calls, results = assert_valid_tool_sequence(messages)
    assert set(calls) == {"call_1"} and len(results) == 1


def test_post_compact_continuation_uses_prior_results(
        db: Any, client: TestClient, user_factory: Any, provider_factory: Any,
        model_factory: Any) -> None:
    user_id, provider, model = _owned(db, client, user_factory, provider_factory,
                                      model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer())
    response = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert response.status_code == 200, response.text
    db.expire_all()
    summary = db.get(Message, uuid.UUID(response.json()["summary_message_id"]))
    assert summary is not None and summary.role == Role.SUMMARY
    followup = [
        ChatMessage(role="user", content="and tomorrow?"),
        ChatMessage(role="assistant", content="", extra={"tool_calls": [{
            "id": "call_9", "type": "function",
            "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}]}),
        ChatMessage(role="tool", content="rain", extra={"tool_call_id": "call_9"}),
    ]
    messages, _ = compaction.assemble_context(
        db, system=None, stored_rows=[], latest_summary=summary, tail_rows=[],
        pending=None, trigger="manual", user_id=user_id, model=None, adapter=None,
        grouped={}, prebuilt_tail=(followup, 0))
    assert messages[0].role == "system" and summary.content in messages[0].content
    assert_valid_tool_sequence(messages)
    openai_adapter = OpenAIChatAdapter(credentials={}, model_id="m")
    wire = [openai_adapter._message(m) for m in messages]
    assert wire[2]["tool_calls"][0]["id"] == "call_9"
    assert wire[3]["tool_call_id"] == "call_9"
    assert [m["role"] for m in wire[1:]] == ["user", "assistant", "tool"]
    anthropic_adapter = AnthropicAdapter(credentials={"api_key": "x"}, model_id="m")
    native = [anthropic_adapter._request_content(m) for m in messages[1:]]
    tool_use = [b for b in native[1] if isinstance(b, dict) and b.get("type") == "tool_use"]
    assert tool_use and tool_use[0]["id"] == "call_9"
    assert tool_use[0]["input"] == {"city": "SF"}
    tool_result = [b for b in native[2] if isinstance(b, dict)
                   and b.get("type") == "tool_result"]
    assert tool_result and tool_result[0]["tool_use_id"] == "call_9"


def test_compact_rejected_during_active_tool_execution(
        db: Any, client: TestClient, user_factory: Any, provider_factory: Any,
        model_factory: Any) -> None:
    user_id, provider, model = _owned(db, client, user_factory, provider_factory,
                                      model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    add_message(db, conv.id, Role.ASSISTANT, "", user_id=user_id,
                status=MessageStatus.RUNNING)
    compaction.set_summarizer(_fake_summarizer())
    with pytest.raises(ConflictError):
        asyncio.run(compaction.compact_request(db, conv.id, user_id))
    assert db.scalars(select(Message).where(
        Message.conversation_id == conv.id, Message.role == Role.SUMMARY)).all() == []


def test_compact_active_generation_409_over_http(
        db: Any, client: TestClient, user_factory: Any, provider_factory: Any,
        model_factory: Any) -> None:
    user_id, provider, model = _owned(db, client, user_factory, provider_factory,
                                      model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    add_message(db, conv.id, Role.ASSISTANT, "", user_id=user_id,
                status=MessageStatus.RUNNING)
    compaction.set_summarizer(_fake_summarizer())
    response = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert response.status_code == 409, response.text


# --- tool auth: rejected at the backend, not just the UI ---------------------


def test_tools_rejected_without_tool_capability(
        client: TestClient, provider_factory: Any, model_factory: Any,
        monkeypatch: Any) -> None:
    provider = provider_factory("OAINoTools")
    model_factory(provider["id"], model_id="plain-model", supports_tool_calling=False)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)
    denied = client.post("/v1/chat/completions", json={
        "model": "OAINoTools/plain-model", "tools": OAI_TOOLS[:1],
        "messages": [{"role": "user", "content": "weather?"}]}, headers=_auth(raw))
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.text
    assert "supports_tool_calling" in denied.text
    assert calls == []


def test_tools_rejected_without_api_key(client: TestClient) -> None:
    denied = client.post("/v1/chat/completions", json={
        "model": "any/model", "tools": OAI_TOOLS[:1],
        "messages": [{"role": "user", "content": "weather?"}]})
    assert denied.status_code == 401, denied.text


def test_tools_rejected_with_invalid_api_key(client: TestClient) -> None:
    denied = client.post("/v1/chat/completions", json={
        "model": "any/model", "tools": OAI_TOOLS[:1],
        "messages": [{"role": "user", "content": "weather?"}]},
        headers=_auth("tma_invalid_key"))
    assert denied.status_code == 401, denied.text


def test_tools_rejected_across_users_no_oracle(
        client: TestClient, user_factory: Any, provider_factory: Any,
        model_factory: Any, monkeypatch: Any) -> None:
    user_factory(email="a@tollma.ai")
    raw_a = _make_key(client, name="a key")
    user_factory(email="b@tollma.ai")
    provider_b = provider_factory("BProv")
    model_factory(provider_b["id"], model_id="b-model", supports_tool_calling=True)
    calls: list = []
    _bind(monkeypatch, calls)
    denied = client.post("/v1/chat/completions", json={
        "model": "BProv/b-model", "tools": OAI_TOOLS[:1],
        "messages": [{"role": "user", "content": "weather?"}]}, headers=_auth(raw_a))
    assert denied.status_code == 404, denied.text
    assert calls == []


def test_internal_chat_has_no_tool_surface() -> None:
    assert "tools" not in ChatRequest.model_fields
    assert "tool_choice" not in ChatRequest.model_fields


def test_anthropic_tools_rejected_without_tool_capability(
        client: TestClient, provider_factory: Any, model_factory: Any,
        monkeypatch: Any) -> None:
    provider = provider_factory("AnthNoTools")
    model_factory(provider["id"], model_id="plain-model", supports_tool_calling=False)
    calls: list = []
    _bind(monkeypatch, calls)
    raw = _make_key(client)
    denied = client.post("/v1/messages", json={
        "model": "AnthNoTools/plain-model", "max_tokens": 64,
        "tools": ANTH_TOOLS, "messages": [{"role": "user", "content": "weather?"}]},
        headers={**_auth(raw), "anthropic-version": "2023-06-01"})
    assert denied.status_code == 403, denied.text
    assert "model_not_allowed" in denied.text
    assert calls == []
