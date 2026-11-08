"""Production-readiness audit for compaction (spec sections 2-8, 10-11, 13-14).

Failing-test-first evidence for every verified defect; mocked transports only
(MockTransport / fake boto3 — no provider network, no adapter edits).

Sections mirror the audit workstreams:
  T1 provider compat — summary-as-system substitution per adapter wire shape
  T2 budget correctness — estimate vs real payload, 20/80/100 boundaries
  T3 giant message — single-oversized-message 422, fail-closed
  T4 multimodal — reserves vs per-provider counting, documented limits
  T5 branching — compact on branch, switch earlier, regen/edit, roots,
       repeated compaction, version chaining, failed/cancelled, no future-leak
  T6 concurrency — message-during-summarize, timeout, DB failure, retry,
       stale snapshot, duplicate prevention, model switch
"""

import asyncio
import base64
import json
import uuid
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy.orm import sessionmaker

from tollms.api.conversations import compaction
from tollms.api.conversations import service as conv_service
from tollms.api.conversations.schemas import ConversationCreate
from tollms.api.conversations.service import (
    active_path,
    add_message,
    create_conversation,
)
from tollms.core.exceptions import ConflictError, ValidationError
from tollms.models.message import Message, MessageStatus, Role
from tollms.services.gateway.adapters.base import ChatMessage, MediaPart

WINDOW = 2000  # manual 20% = 400 tokens, auto 80% = 1600 tokens


@pytest.fixture(autouse=True)
def _reset_summarizer():
    compaction.reset_summarizer()
    yield
    compaction.reset_summarizer()


def _fake_summarizer(text="Canned summary of the covered history.", calls=None, fail=None, delay=0.0):
    async def _fn(adapter, instruction, transcript):
        if delay:
            await asyncio.sleep(delay)
        (calls if calls is not None else []).append((instruction, transcript))
        if fail is not None:
            raise fail
        return text

    return _fn


def _adapter_ns(record=None):
    ns = SimpleNamespace(supports_vision=False, chat_calls=record if record is not None else [])

    async def _chat(messages, tools=None, tool_choice=None):
        ns.chat_calls.append(messages)
        raise AssertionError("provider adapter must not be called during compaction tests")

    ns.chat = _chat
    return ns


def _user_id(client):
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _owned(db, client, user_factory, provider_factory, model_factory, email="u@tollma.ai", **mkw):
    user_factory(email=email)
    provider = provider_factory()
    model = model_factory(provider["id"], **mkw)
    return _user_id(client), provider, model


def _conv(db, user_id, provider, model, title="Audit me"):
    return create_conversation(
        db,
        ConversationCreate(
            title=title,
            provider_id=uuid.UUID(provider["id"]),
            model_id=uuid.UUID(model["id"]),
        ),
        user_id,
    )


def _fill(db, conv_id, user_id, n_exchanges=3, size=620):
    for i in range(n_exchanges):
        add_message(db, conv_id, Role.USER, f"question {i} " + "q" * size, user_id=user_id)
        add_message(db, conv_id, Role.ASSISTANT, f"answer {i} " + "a" * size, user_id=user_id)


def _provider_model(db, provider, model):
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    return db.get(Provider, uuid.UUID(provider["id"])), db.get(AIModel, uuid.UUID(model["id"]))


# --- T1: substituted context fixture (unique markers for order asserts) --------

SYS = "SYS-MARK-7f3a"
SUM = "SUM-MARK-9b2c"
TAILQ = "TAILQ-MARK-1a"
CHECK = "CHECK-MARK-2b"
TOOLRES = "SUNNY-MARK-3c"
TAILA = "TAILA-MARK-4d"
PEND = "PEND-MARK-5e"

TOOL_CALL_EXTRA = {
    "tool_calls": [
        {"id": "call_1", "function": {"name": "get_weather", "arguments": '{"city":"SF"}'}}
    ]
}


def _substituted_context():
    """[system, summary-as-system, tail(user, assistant+tools, tool, assistant),
    pending] — the exact shape compaction.assemble_context emits."""
    return [
        ChatMessage(role="system", content=f"sys prompt {SYS}"),
        ChatMessage(role="system", content=f"Earlier conversation summary:\n\n{SUM}"),
        ChatMessage(role="user", content=f"tail question {TAILQ}"),
        ChatMessage(role="assistant", content=f"checking {CHECK}", extra=dict(TOOL_CALL_EXTRA)),
        ChatMessage(role="tool", content=TOOLRES, extra={"tool_call_id": "call_1"}),
        ChatMessage(role="assistant", content=f"tail answer {TAILA}"),
        ChatMessage(role="user", content=f"follow-up {PEND}"),
    ]


def _assert_marker_order(dump: str):
    idx = [dump.index(m) for m in (SYS, SUM, TAILQ, CHECK, TOOLRES, TAILA, PEND)]
    assert idx == sorted(idx), idx


def _assert_tail_order(dump: str):
    """Chronological tail + pending order inside a section dump (adapters
    that hoist systems into a separate field: Anthropic, Bedrock)."""
    idx = [dump.index(m) for m in (TAILQ, CHECK, TOOLRES, TAILA, PEND)]
    assert idx == sorted(idx), idx


def _no_summary_role(roles: list[str], where: str):
    assert roles, where
    assert "summary" not in [str(r).lower() for r in roles], (where, roles)

# --- T1: per-adapter wire verification (mocked transports, adapters unedited) --


def _openai_chat_sse(text="ok"):
    return (
        f'data: {{"choices": [{{"delta": {{"content": "{text}"}}}}]}}\n\n'
        'data: {"choices": [{"delta": {}}], "usage": '
        '{"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}}\n\n'
        "data: [DONE]\n\n"
    )


def test_t1_openai_chat_substitution_and_tool_pairing():
    """OpenAI Chat: system/summary order, no SUMMARY role, tool pair intact."""
    from tollms.services.gateway.adapters.openai import OpenAIChatAdapter

    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=_openai_chat_sse().encode())

    adapter = OpenAIChatAdapter(
        credentials={"api_key": "x"}, model_id="gpt", transport=httpx.MockTransport(handler)
    )
    result = asyncio.run(adapter.chat(_substituted_context()))
    assert result.text == "ok"
    assert len(captured) == 1
    messages = captured[0]["messages"]
    _no_summary_role([m["role"] for m in messages], "openai-chat")
    assert [m["role"] for m in messages] == [
        "system", "system", "user", "assistant", "tool", "assistant", "user",
    ]
    assert messages[0]["content"].endswith(SYS)
    assert SUM in messages[1]["content"]
    # Tool-call / tool-result pairing passes through untouched.
    assert messages[3]["tool_calls"] == TOOL_CALL_EXTRA["tool_calls"]
    assert messages[4] == {"role": "tool", "content": TOOLRES, "tool_call_id": "call_1"}
    _assert_marker_order(json.dumps(captured[0]))


def test_t1_openai_responses_substitution_and_function_items():
    """OpenAI Responses: input items ordered, function_call pair preserved."""
    from tollms.services.gateway.adapters.openai import OpenAIResponsesAdapter

    captured: list[dict] = []
    sse = (
        'data: {"type": "response.output_text.delta", "delta": "ok"}\n\n'
        'data: {"type": "response.completed", "response": {"usage": '
        '{"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/responses")
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=sse.encode())

    adapter = OpenAIResponsesAdapter(
        credentials={"api_key": "x"}, model_id="gpt", transport=httpx.MockTransport(handler)
    )
    result = asyncio.run(adapter.chat(_substituted_context()))
    assert result.text == "ok"
    assert len(captured) == 1
    items = captured[0]["input"]
    roles = [i.get("role") for i in items if "role" in i]
    _no_summary_role(roles, "openai-responses")
    assert roles == ["system", "system", "user", "assistant", "assistant", "user"]
    kinds = [i.get("type") for i in items]
    assert "function_call" in kinds and "function_call_output" in kinds
    call = next(i for i in items if i.get("type") == "function_call")
    assert (call["call_id"], call["name"]) == ("call_1", "get_weather")
    out = next(i for i in items if i.get("type") == "function_call_output")
    assert (out["call_id"], out["output"]) == ("call_1", TOOLRES)
    assert items[0]["content"] == f"sys prompt {SYS}"  # system/developer ordering kept
    assert SUM in items[1]["content"]
    _assert_marker_order(json.dumps(captured[0]))


def test_t1_anthropic_system_merge_and_tool_blocks():
    """Anthropic: both systems merge into one system string (order kept);
    tool_use/tool_result blocks survive; no SUMMARY role leaks."""
    from tollms.services.gateway.adapters.anthropic import AnthropicAdapter

    captured: list[dict] = []
    sse = (
        'data: {"type": "message_start", "message": {"usage": {"input_tokens": 1}}}\n\n'
        'data: {"type": "content_block_delta", "delta": '
        '{"type": "text_delta", "text": "ok"}}\n\n'
        'data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, '
        '"usage": {"output_tokens": 1}}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v1/messages")
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=sse.encode())

    adapter = AnthropicAdapter(
        credentials={"api_key": "x"}, model_id="claude", transport=httpx.MockTransport(handler)
    )
    result = asyncio.run(adapter.chat(_substituted_context()))
    assert result.text == "ok"
    assert len(captured) == 1
    body = captured[0]
    assert SYS in body["system"] and SUM in body["system"]
    assert body["system"].index(SYS) < body["system"].index(SUM)
    roles = [m["role"] for m in body["messages"]]
    _no_summary_role(roles, "anthropic")
    assert roles == ["user", "assistant", "user", "assistant", "user"]  # tool -> user
    assistant_blocks = body["messages"][1]["content"]
    assert {"type": "text", "text": f"checking {CHECK}"} in assistant_blocks
    assert {
        "type": "tool_use", "id": "call_1", "name": "get_weather", "input": {"city": "SF"},
    } in assistant_blocks
    assert {
        "type": "tool_result", "tool_use_id": "call_1", "content": TOOLRES,
    } in body["messages"][2]["content"]
    _assert_tail_order(json.dumps(body["messages"]))  # systems ride the system field


def test_t1_gemini_text_only_mapping_no_summary_leak():
    """Gemini: systems fold to user turns in order; text preserved; tool
    envelopes are text-only by design (dropped, never misrouted)."""
    from tollms.services.gateway.adapters.gemini import GeminiAdapter

    captured: list[dict] = []
    sse = (
        'data: {"candidates": [{"content": {"parts": [{"text": "ok"}]}}], '
        '"usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, '
        '"totalTokenCount": 2}}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert "GenerateContent" in request.url.path
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=sse.encode())

    adapter = GeminiAdapter(
        credentials={"api_key": "x"}, model_id="gemini-2.0-flash",
        transport=httpx.MockTransport(handler),
    )
    result = asyncio.run(adapter.chat(_substituted_context()))
    assert result.text == "ok"
    assert len(captured) == 1
    contents = captured[0]["contents"]
    roles = {c["role"] for c in contents}
    assert roles <= {"user", "model"}, roles  # never a "summary" role
    assert contents[0]["role"] == "user" and SYS in contents[0]["parts"][0]["text"]
    assert SUM in contents[1]["parts"][0]["text"]
    _assert_marker_order(json.dumps(captured[0]))


def test_t1_vertex_shares_gemini_body_contract():
    """Vertex uses the same _gemini_body wire shape: order + roles hold."""
    from tollms.services.gateway.adapters.gemini import _gemini_body

    body = _gemini_body(_substituted_context())
    roles = [c["role"] for c in body["contents"]]
    assert "summary" not in roles
    assert roles == ["user", "user", "user", "model", "model", "model", "user"]
    texts = [p.get("text", "") for c in body["contents"] for p in c["parts"]]
    joined = "\n".join(texts)
    for marker in (SYS, SUM, TAILQ, CHECK, TOOLRES, TAILA, PEND):
        assert marker in joined, marker
    _assert_marker_order(joined)


def test_t1_bedrock_converse_system_and_tool_blocks(monkeypatch):
    """Bedrock: systems -> system list in order; assistant/user mapping kept;
    toolUse/toolResult blocks preserved; history toolUse redeclares toolConfig."""
    import boto3

    from tollms.services.gateway.adapters.bedrock import BedrockAdapter

    events = [
        {"contentBlockDelta": {"delta": {"text": "ok"}, "contentBlockIndex": 0}},
        {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}}},
    ]

    class _FakeClient:
        def __init__(self):
            self.payloads: list[dict] = []

        def converse_stream(self, **kwargs):
            self.payloads.append(kwargs)
            return {"stream": list(events)}

    fake = _FakeClient()
    monkeypatch.setattr(boto3, "client", lambda *a, **k: fake)
    adapter = BedrockAdapter(
        credentials={"access_key": "k", "secret_key": "s", "region": "us-east-1"},
        model_id="anthropic.claude-haiku-4-5-20251001-v1:0",
    )
    result = asyncio.run(adapter.chat(_substituted_context()))
    assert result.text == "ok"
    assert len(fake.payloads) == 1
    payload = fake.payloads[0]
    assert [b["text"] for b in payload["system"]] == [f"sys prompt {SYS}", f"Earlier conversation summary:\n\n{SUM}"]
    roles = [m["role"] for m in payload["messages"]]
    assert "summary" not in roles
    assert roles == ["user", "assistant", "user", "assistant", "user"]
    assistant_blocks = payload["messages"][1]["content"]
    assert {"text": f"checking {CHECK}"} in assistant_blocks
    assert {
        "toolUse": {"toolUseId": "call_1", "name": "get_weather", "input": {"city": "SF"}},
    } in assistant_blocks
    assert {
        "toolResult": {"toolUseId": "call_1", "status": "success",
                       "content": [{"text": TOOLRES}]},
    } in payload["messages"][2]["content"]
    # History carries toolUse but the request defines no tools: Converse still
    # requires toolConfig, redeclared from the observed history names.
    assert [t["toolSpec"]["name"] for t in payload["toolConfig"]["tools"]] == ["get_weather"]
    _assert_tail_order(json.dumps(payload["messages"], default=str))  # systems ride system[]
    assert json.dumps(payload["system"]).index(SYS) < json.dumps(payload["system"]).index(SUM)


def test_t1_custom_gateway_matches_openai_chat_shape():
    """Custom OpenAI-compatible gateways route by base_url and serialize
    exactly like OpenAI Chat (same class, gateway base URL, key optional)."""
    from tollms.services.gateway.adapters.openai import CustomAdapter, OpenAIChatAdapter

    assert CustomAdapter is OpenAIChatAdapter
    captured: list[dict] = []
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["host"] = request.url.host
        seen["auth"] = request.headers.get("authorization")
        assert request.url.path.endswith("/chat/completions")
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=_openai_chat_sse().encode())

    adapter = CustomAdapter(
        credentials={"base_url": "http://custom.local:11434/v1"},
        model_id="llama",
        transport=httpx.MockTransport(handler),
    )
    result = asyncio.run(adapter.chat(_substituted_context()))
    assert result.text == "ok"
    assert seen["host"] == "custom.local" and seen["auth"] is None
    assert [m["role"] for m in captured[0]["messages"]] == [
        "system", "system", "user", "assistant", "tool", "assistant", "user",
    ]
    _assert_marker_order(json.dumps(captured[0]))

# --- T2: budget correctness -----------------------------------------------


def test_t2_manual_exact_20pct_edge_compacts(db, client, user_factory, provider_factory, model_factory):
    """Manual threshold is fail-open at exactly 20%: 400/2000 proceeds."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "x" * 1568, user_id=user_id)  # 392 + 8 = 400
    compaction.set_summarizer(_fake_summarizer())
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    assert r.json()["usage_before"] == pytest.approx(0.20)


def test_t2_assembled_at_100pct_fails_closed_no_oversized_send(
    db, client, user_factory, provider_factory, model_factory
):
    """At ~100% the summarizer input itself exceeds the window: 422 before any
    provider I/O, history intact (never narrow silently, never send oversized)."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "a" * 12000, user_id=user_id)
    p, m = _provider_model(db, provider, model)
    record: list = []
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(record),
        )

    with pytest.raises(ValidationError, match="too large to summarize"):
        asyncio.run(_main())
    assert record == []  # provider adapter never invoked
    assert not [r for r in conv_service.list_messages(db, conv.id, user_id) if r.role == Role.SUMMARY]
    assert len(conv_service.list_messages(db, conv.id, user_id)) == 1


def test_t2_pending_media_reserve_is_bytes_aware(
    db, client, user_factory, provider_factory, model_factory
):
    """Pending image bytes ride the request as base64: the reserve must count
    them. Base-only (1000) stays under the 80% edge here; bytes-aware crosses."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "a" * 2000, user_id=user_id)  # 500 + 8 = 508
    p, m = _provider_model(db, provider, model)
    blob = b"\x89PNG" + b"\x00" * 102400
    pending = ChatMessage(
        role="user", content="b" * 100,  # text-only subtotal 525 + 16 = 541
        media=[MediaPart(kind="image", mime_type="image/png",
                         data_b64=base64.b64encode(blob).decode())],
    )
    compaction.set_summarizer(_fake_summarizer())

    async def _main():
        return await compaction.ensure_budget(
            db, conv_id=conv.id, user_id=user_id, provider=p, model=m,
            adapter=_adapter_ns(), pending=pending,
        )

    ensured = asyncio.run(_main())
    # 541 + 1000 (base) + 100 (102403B // 1024) = 1641 >= 1600: must compact.
    assert ensured.compaction is not None and ensured.compaction.trigger == "auto"


def test_t2_tokens_after_counts_pending_media(
    db, client, user_factory, provider_factory, model_factory
):
    """tokens_after must include the pending media reserve (same basis as
    tokens_before), or usage_after understates the real request."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory, context_window=WINDOW)
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    p, m = _provider_model(db, provider, model)
    compaction.set_summarizer(_fake_summarizer(text="Canned summary."))

    async def _main():
        return await compaction.compact_conversation(
            db, conv_id=conv.id, user_id=user_id, trigger="manual",
            provider=p, model=m, adapter=_adapter_ns(), window=WINDOW, min_ratio=None,
            pending_text="hi", pending_media_tokens=1100,
        )

    result = asyncio.run(_main())
    db.expire_all()
    summary = db.get(Message, result.summary_message_id)
    expected, _ = compaction.estimate_assembled(
        system=None,
        summary_text=compaction.summary_context_block(summary, "manual"),
        tail_contents=[], pending_text="hi", media_tokens=1100,
    )
    assert result.tokens_after == expected


def test_t2_estimation_limits_documented():
    """The conservative strategy and its limits live in the module docstring:
    char rule + framing, output reservation headroom, tool definitions,
    cache markers, per-provider media approximations."""
    doc = compaction.__doc__ or ""
    for phrase in ("max_output_tokens", "tool definitions", "cache", "8 tokens",
                   "base64", "dimensions"):
        assert phrase in doc, phrase

# --- T3: giant single message ------------------------------------------------


def test_t3_single_oversized_message_422_fail_closed(
    db, client, user_factory, provider_factory, model_factory
):
    """One message larger than the window: 422 (too large to summarize),
    summarizer never invoked, provider never invoked, history intact.

    Chunked/bounded summarization is deliberately NOT attempted: narrowing
    coverage silently would let the summary claim content it never saw, and
    sending oversized would violate fail-closed sends. Limitation documented
    in the module docstring (transcript-must-fit rule); the remedy is a new
    conversation (see the 422 message).
    """
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=500, email="giant@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    add_message(db, conv.id, Role.USER, "q" * 3000, user_id=user_id)
    calls: list = []
    compaction.set_summarizer(_fake_summarizer(calls=calls))

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422, r.text
    assert "too large to summarize" in r.json()["error"]["message"]
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert calls == []  # summarizer never invoked -> provider never invoked
    rows = conv_service.list_messages(db, conv.id, user_id)
    assert len(rows) == 1 and rows[0].content == "q" * 3000  # history intact
    assert not [m for m in rows if m.role == Role.SUMMARY]


# --- T4: multimodal reserves -------------------------------------------------


def _att_row(kind, size=2048, extracted="saved transcript", filename="f.bin"):
    return SimpleNamespace(
        id=uuid.uuid4(), kind=kind, filename=filename, mime_type=f"{kind}/x",
        storage_path=f"rel/{filename}", extracted_text=extracted, file_size=size,
    )


def _capable_model():
    return SimpleNamespace(supports_vision=True, supports_audio_input=True, metadata_={"supports_video_input": True})


def _capable_adapter():
    return SimpleNamespace(supports_vision=True, supports_audio=True, supports_video=True)


def _gated_model():
    return SimpleNamespace(supports_vision=False, supports_audio_input=False, metadata_={})


def _gated_adapter():
    return SimpleNamespace(supports_vision=False, supports_audio=False, supports_video=False)


def test_t4_native_reserves_bytes_aware_and_gated_zero(monkeypatch):
    """Stored rows: native media reserves scale with bytes; gated rows and
    documents reserve nothing (transcript text is char-counted instead)."""
    from tollms.services.gateway import attachments as attachment_engine

    monkeypatch.setattr(attachment_engine, "read_bytes", lambda rel: b"\x00" * 64)
    flags = attachment_engine.model_media_flags(_capable_model())
    adapter = _capable_adapter()
    assert compaction.media_reserve_for_row(_att_row("image", size=2048), flags, adapter) == 1000 + 2
    assert compaction.media_reserve_for_row(_att_row("audio", size=2048), flags, adapter) == 500 + 4
    assert compaction.media_reserve_for_row(_att_row("video", size=2048), flags, adapter) == 1500 + 4
    big = compaction.media_reserve_for_row(_att_row("image", size=102400), flags, adapter)
    small = compaction.media_reserve_for_row(_att_row("image", size=1024), flags, adapter)
    assert big > small >= 1000  # monotonic in bytes, base floor holds
    gated_flags = attachment_engine.model_media_flags(_gated_model())
    gated = _gated_adapter()
    for kind in ("image", "audio", "video"):
        assert compaction.media_reserve_for_row(_att_row(kind), gated_flags, gated) == 0
    assert compaction.media_reserve_for_row(_att_row("document"), flags, adapter) == 0


def test_t4_pending_matches_stored_for_same_bytes():
    """Pending (assembled base64) and stored (file_size) paths agree for the
    same bytes: one reserve basis, not two. Unknown kinds reserve nothing."""
    blob = b"\x89PNG" + b"\x00" * 2048
    pending = ChatMessage(
        role="user", content="look",
        media=[MediaPart(kind="image", mime_type="image/png",
                         data_b64=base64.b64encode(blob).decode())],
    )
    assert compaction.pending_media_reserve(pending) == 1000 + len(blob) // 1024 == 1002
    audio = ChatMessage(
        role="user", content="listen",
        media=[MediaPart(kind="audio", mime_type="audio/mp3",
                         data_b64=base64.b64encode(b"\x00" * 1024).decode())],
    )
    assert compaction.pending_media_reserve(audio) == 500 + 2
    assert compaction.pending_media_reserve(None) == 0
    assert compaction.pending_media_reserve(ChatMessage(role="user", content="no media")) == 0
    weird = ChatMessage(
        role="user", content="x",
        media=[MediaPart(kind="document", mime_type="text/plain", data_b64="eA==")],
    )
    assert compaction.pending_media_reserve(weird) == 0

# --- T5: branching ------------------------------------------------------------


def test_t5_compact_on_branch_covers_branch_only(db, client, user_factory, provider_factory, model_factory):
    """Compacting while the leaf sits on a divergent branch covers that
    branch's ancestors (shared root included); switching back to the main tip
    shows no summary — no future-leak across branches; originals intact."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="branch@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    root_q = add_message(db, conv.id, Role.USER, "root question", user_id=user_id)
    root_a = add_message(db, conv.id, Role.ASSISTANT, "root answer", user_id=user_id)
    assert (root_q.id, root_a.id)  # shared ancestors
    branch_u = add_message(db, conv.id, Role.USER, "branch q " + "q" * 3000,
                           user_id=user_id, parent_message_id=root_a.id)
    branch_a = add_message(db, conv.id, Role.ASSISTANT, "branch a " + "a" * 3000,
                           user_id=user_id, parent_message_id=branch_u.id)
    assert active_path(db, conv.id, user_id)[-1].id == branch_a.id
    compaction.set_summarizer(_fake_summarizer(text="BRANCH-SUMMARY"))

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["coverage_through_message_id"] == str(branch_a.id)
    db.expire_all()
    summary = db.get(Message, uuid.UUID(body["summary_message_id"]))
    comp = (summary.metadata_ or {})["compaction"]
    assert set(comp["covered_message_ids"]) == {
        str(root_q.id), str(root_a.id), str(branch_u.id), str(branch_a.id)}
    # A divergent sibling created after the compact (off the covered path)
    # never inherits the summary: no future-leak to newer branches.
    divergent = add_message(db, conv.id, Role.USER, "later branch " + "d" * 100,
                            user_id=user_id, parent_message_id=root_a.id,
                            use_active_leaf=False)
    assert active_path(db, conv.id, user_id)[-1].id == divergent.id
    path = client.get(f"/api/v1/conversations/{conv.id}/path").json()
    assert [m["role"] for m in path["path"]] == ["user", "assistant", "user"]
    assert "BRANCH-SUMMARY" not in client.get(f"/api/v1/conversations/{conv.id}/path").text
    # History intact: all originals still listed.
    assert {m.id for m in conv_service.list_messages(db, conv.id, user_id)} >= {
        root_q.id, root_a.id, branch_u.id, branch_a.id, summary.id}


def test_t5_switch_earlier_then_compact_covers_ancestors_only(
    db, client, user_factory, provider_factory, model_factory
):
    """Selecting an earlier side-branch tip (Rule D: select lands on the
    descendant tip) then compacting covers only its ancestors; the newer main
    line stays detached, reselectable with no summary."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="earlier@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    root_q = add_message(db, conv.id, Role.USER, "root question", user_id=user_id)
    root_a = add_message(db, conv.id, Role.ASSISTANT, "root answer", user_id=user_id)
    side_u = add_message(db, conv.id, Role.USER, "side q " + "q" * 3000,
                         user_id=user_id, parent_message_id=root_a.id)
    side_a = add_message(db, conv.id, Role.ASSISTANT, "side a " + "a" * 3000,
                         user_id=user_id, parent_message_id=side_u.id)
    main_q = add_message(db, conv.id, Role.USER, "main q",
                         user_id=user_id, parent_message_id=root_a.id)
    main_a = add_message(db, conv.id, Role.ASSISTANT, "main a",
                         user_id=user_id, parent_message_id=main_q.id)
    conv_service.select_message(db, conv.id, side_a.id, user_id)  # earlier tip
    assert active_path(db, conv.id, user_id)[-1].id == side_a.id
    compaction.set_summarizer(_fake_summarizer(text="EARLY-SUMMARY"))

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    db.expire_all()
    summary = db.get(Message, uuid.UUID(r.json()["summary_message_id"]))
    comp = (summary.metadata_ or {})["compaction"]
    assert set(comp["covered_message_ids"]) == {
        str(root_q.id), str(root_a.id), str(side_u.id), str(side_a.id)}
    assert comp["prev_summary_id"] is None
    assert summary.parent_message_id == side_a.id
    # The newer main line survives on its branch; reselecting shows no summary.
    conv_service.select_message(db, conv.id, main_a.id, user_id)
    roles = [m["role"] for m in client.get(f"/api/v1/conversations/{conv.id}/path").json()["path"]]
    assert roles == ["user", "assistant", "user", "assistant"]
    assert len(conv_service.list_messages(db, conv.id, user_id)) == 6 + 1  # history + summary intact


def test_t5_repeated_compaction_version_chain(db, client, user_factory, provider_factory, model_factory):
    """Repeated compacts chain versions: each summary's parent is the newest
    covered leaf, prev_summary_id links the chain, growth stays O(tail)."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="repeat@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-ONE"))
    first = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert first.status_code == 200, first.text
    add_message(db, conv.id, Role.USER, "round two " + "q" * 3000, user_id=user_id)
    add_message(db, conv.id, Role.ASSISTANT, "round two answer " + "a" * 100, user_id=user_id)
    compaction.set_summarizer(_fake_summarizer(text="SUMMARY-TWO"))
    second = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert second.status_code == 200, second.text

    db.expire_all()
    s1 = db.get(Message, uuid.UUID(first.json()["summary_message_id"]))
    s2 = db.get(Message, uuid.UUID(second.json()["summary_message_id"]))
    c2 = (s2.metadata_ or {})["compaction"]
    assert c2["prev_summary_id"] == str(s1.id)
    assert s2.parent_message_id != s1.parent_message_id  # new coverage frontier
    assert s2.version_number >= 1 and s1.version_number >= 1
    # Only the latest summary renders as context; both stay in history.
    rows = active_path(db, conv.id, user_id)
    assert [m.id for m in rows if m.role == Role.SUMMARY] == [s1.id, s2.id]
    latest, _covered, tail = compaction.latest_applicable_summary(rows)
    assert latest is not None and latest.id == s2.id and tail == []

# --- T6: concurrency ----------------------------------------------------------


def test_t6_message_during_summarize_aborts_no_partial(
    db, client, user_factory, provider_factory, model_factory
):
    """A message landing mid-summarize moves the tip: phase 2 sees the stale
    tip and 409s — no partial/stale summary becomes active context."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="race@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    before = len(conv_service.list_messages(db, conv.id, user_id))

    async def _sneaky(adapter, instruction, transcript):
        add_message(db, conv.id, Role.USER, "mid-compact arrival", user_id=user_id)
        return "stale summary that must never attach"

    compaction.set_summarizer(_sneaky)
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 409, r.text
    db.expire_all()
    rows = conv_service.list_messages(db, conv.id, user_id)
    assert len(rows) == before + 1  # only the new message; no summary row
    assert not [m for m in rows if m.role == Role.SUMMARY]
    assert rows[-1].content == "mid-compact arrival"


def test_t6_summarizer_timeout_fails_closed(db, client, user_factory, provider_factory, model_factory):
    """Summarizer timeout surfaces as 422 (compaction failed), history intact,
    provider never invoked with an oversized request."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="timeout@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    before = [m.content for m in conv_service.list_messages(db, conv.id, user_id)]
    compaction.set_summarizer(_fake_summarizer(fail=asyncio.TimeoutError("slow")))

    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 422, r.text
    assert "compaction failed (TimeoutError)" in r.json()["error"]["message"]
    assert [m.content for m in conv_service.list_messages(db, conv.id, user_id)] == before


def test_t6_db_failure_persists_nothing(db, client, user_factory, provider_factory, model_factory, monkeypatch):
    """A DB failure in phase-2 persist leaves no partial summary row: the
    failed insert never commits, originals untouched."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="dbfail@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    before = len(conv_service.list_messages(db, conv.id, user_id))
    compaction.set_summarizer(_fake_summarizer())

    def _boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(conv_service, "add_message", _boom)
    with pytest.raises(RuntimeError, match="db down"):
        client.post(f"/api/v1/conversations/{conv.id}/compact")
    db.rollback()
    rows = conv_service.list_messages(db, conv.id, user_id)
    assert len(rows) == before and not [m for m in rows if m.role == Role.SUMMARY]


def test_t6_retry_after_failure_succeeds_once(db, client, user_factory, provider_factory, model_factory):
    """After a summarizer failure, a retry compacts exactly once (no duplicate
    from the failed attempt, no stale snapshot from the retry)."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="retry@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    state = {"n": 0}

    async def _flaky(adapter, instruction, transcript):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("transient summarizer outage")
        return "recovered summary"

    compaction.set_summarizer(_flaky)
    assert client.post(f"/api/v1/conversations/{conv.id}/compact").status_code == 422
    assert not [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    assert state["n"] == 2
    db.expire_all()
    summaries = [m for m in conv_service.list_messages(db, conv.id, user_id) if m.role == Role.SUMMARY]
    assert len(summaries) == 1 and "recovered summary" in summaries[0].content


def test_t6_model_switch_during_summarize_keeps_snapshot(
    db, client, user_factory, provider_factory, model_factory
):
    """Switching the conversation's model mid-summarize does not corrupt the
    persist: the summary records the snapshot pair it was built with."""
    user_id, provider, model = _owned(
        db, client, user_factory, provider_factory, model_factory,
        context_window=WINDOW, email="switch@tollma.ai")
    conv = _conv(db, user_id, provider, model)
    _fill(db, conv.id, user_id)
    provider2 = provider_factory(name="P2")
    model2 = model_factory(provider2["id"], model_id="mock-big", name="Big", context_window=128000)
    from tollms.models.conversation import Conversation

    async def _sneaky(adapter, instruction, transcript):
        row = db.get(Conversation, conv.id)
        row.provider_id = uuid.UUID(provider2["id"])
        row.model_id = uuid.UUID(model2["id"])
        db.commit()
        return "snapshot summary"

    compaction.set_summarizer(_sneaky)
    r = client.post(f"/api/v1/conversations/{conv.id}/compact")
    assert r.status_code == 200, r.text
    db.expire_all()
    summary = db.get(Message, uuid.UUID(r.json()["summary_message_id"]))
    comp = (summary.metadata_ or {})["compaction"]
    assert comp["provider_id"] == provider["id"]  # snapshot pair, not the switched one
    assert comp["model_id"] == model["id"]
    # The switch itself is preserved (not rolled back by the compact).
    assert str(db.get(Conversation, conv.id).model_id) == model2["id"]
