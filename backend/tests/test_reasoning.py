"""Reasoning normalization: every adapter maps its wire format into <think>
spans (base.THINK_OPEN/CLOSE) so the gateway, SSE, persistence, and UI treat
reasoning identically for all providers. Raw payloads below mirror the real
provider wire shapes (Anthropic SSE events, OpenAI deltas, Responses events,
Gemini GenerateContentResponse JSON).
"""

import asyncio
import json
import uuid

import httpx

from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    BaseProviderAdapter,
    ChatMessage,
    StreamChunk,
    reasoning_effort,
    thinking_budget,
    thinking_params,
)
from tollms.services.gateway.adapters.bedrock import BedrockAdapter, bedrock_thinking_fields
from tollms.services.gateway.adapters.gemini import GeminiAdapter, VertexAdapter
from tollms.services.gateway.adapters.openai import OpenAIChatAdapter, OpenAIResponsesAdapter


def _run(adapter) -> tuple[str, list[dict]]:
    bodies: list[dict] = []

    async def _main() -> str:
        parts = []
        async for chunk in adapter.chat_stream([ChatMessage(role="user", content="hi")]):
            parts.append(chunk.delta)
        return "".join(parts)

    return asyncio.run(_main()), bodies


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _sse_response(*lines: str) -> httpx.Response:
    return httpx.Response(200, content="\n".join(lines).encode())


ANTHROPIC_THINKING_SSE = [
    'data: {"type": "message_start", "message": {"usage": {"input_tokens": 12}}}',
    'data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}}',
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Let me consider "}}',
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "opaque-integrity-token"}}',
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "the options."}}',
    'data: {"type": "ping"}',
    'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "future_unknown_delta", "text": "must not break"}}',
    'data: {"type": "content_block_stop", "index": 0}',
    'data: {"type": "content_block_start", "index": 1, "content_block": {"type": "text"}}',
    'data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "The answer."}}',
    'data: {"type": "message_delta", "usage": {"output_tokens": 9}}',
    'data: {"type": "message_stop"}',
]


def test_thinking_budget_mapping() -> None:
    assert thinking_budget(None) is None
    assert thinking_budget("none") is None
    assert thinking_budget("low") == 1024
    assert thinking_budget("medium") == 4096
    assert thinking_budget("high") == 10000
    assert thinking_budget("ultra") == 32000
    assert thinking_budget("some-future-level") == 4096


def test_anthropic_thinking_normalized_to_think_span() -> None:
    seen_body: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/messages"
        seen_body.update(json.loads(request.content))
        return _sse_response(*ANTHROPIC_THINKING_SSE)

    adapter = AnthropicAdapter(
        credentials={"api_key": "k"}, model_id="claude-haiku-x", reasoning_level="high",
        transport=_transport(handler),
    )
    text, _ = _run(adapter)
    assert text == f"{THINK_OPEN}Let me consider the options.{THINK_CLOSE}The answer."
    # Thinking explicitly requested with budget; max_tokens clears the budget.
    assert seen_body["thinking"] == {"type": "enabled", "budget_tokens": 10000}
    assert seen_body["max_tokens"] == 10000 + 4096


def test_anthropic_no_thinking_param_without_level() -> None:
    seen_body: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return _sse_response(
            'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}}',
            'data: {"type": "message_stop"}',
        )

    adapter = AnthropicAdapter(credentials={"api_key": "k"}, model_id="claude-x", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == "Hi"
    assert "thinking" not in seen_body
    assert THINK_OPEN not in text


def test_anthropic_redacted_thinking_shows_placeholder() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return _sse_response(
            'data: {"type": "content_block_start", "index": 0, "content_block": {"type": "redacted_thinking", "data": "abc"}}',
            'data: {"type": "content_block_stop", "index": 0}',
            'data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Done"}}',
        )

    adapter = AnthropicAdapter(credentials={"api_key": "k"}, model_id="claude-x", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == f"{THINK_OPEN}(Thinking redacted by the provider){THINK_CLOSE}Done"


def test_openai_chat_reasoning_content_normalized() -> None:
    body = (
        'data: {"choices": [{"delta": {"reasoning_content": "First, "}}]}\n\n'
        'data: {"choices": [{"delta": {"reasoning_content": "principles."}}]}\n\n'
        'data: {"choices": [{"delta": {"content": "Answer here"}}]}\n\n'
        'data: {"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 5, "completion_tokens": 4, "total_tokens": 9}}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(200, content=body.encode())

    adapter = OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="deepseek-x", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == f"{THINK_OPEN}First, principles.{THINK_CLOSE}Answer here"


def test_openai_chat_plain_text_untouched() -> None:
    body = (
        'data: {"choices": [{"delta": {"content": "Just text"}}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode())

    adapter = OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="gpt-x", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == "Just text"
    assert THINK_OPEN not in text


def test_openai_responses_reasoning_summary_normalized() -> None:
    lines = [
        'data: {"type": "response.reasoning_summary_text.delta", "delta": "Checking facts"}',
        'data: {"type": "response.reasoning_summary_text.delta", "delta": " carefully"}',
        'data: {"type": "response.output_text.delta", "delta": "Final."}',
        'data: {"type": "response.completed", "response": {"usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}}}',
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        return _sse_response(*lines)

    adapter = OpenAIResponsesAdapter(credentials={"api_key": "k"}, model_id="o4-x", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == f"{THINK_OPEN}Checking facts carefully{THINK_CLOSE}Final."


def _gemini_item(thought: str = "", text: str = "") -> str:
    parts = []
    if thought:
        parts.append({"thought": True, "text": thought})
    if text:
        parts.append({"text": text})
    return "data: " + json.dumps({"candidates": [{"content": {"parts": parts}}]})


def test_gemini_thought_parts_normalized() -> None:
    lines = [
        _gemini_item(thought="Hypothesis: "),
        _gemini_item(thought="likely true."),
        _gemini_item(text="Conclusion."),
        "data: " + json.dumps({"usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 3, "totalTokenCount": 5}}),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _sse_response(*lines)

    for cls in (GeminiAdapter, VertexAdapter):
        creds = {"api_key": "k"} if cls is GeminiAdapter else {"project_id": "p"}
        adapter = cls(credentials=creds, model_id="gemini-x", transport=_transport(handler))
        if cls is VertexAdapter:
            adapter._access_token = lambda: "tok"  # type: ignore[method-assign]
        text, _ = _run(adapter)
        assert text == f"{THINK_OPEN}Hypothesis: likely true.{THINK_CLOSE}Conclusion.", cls.__name__


def test_gemini_mixed_and_signature_parts() -> None:
    item = {
        "candidates": [{
            "content": {"parts": [
                {"thought": True, "text": "Hmm "},
                {"thoughtSignature": "opaque-bytes-no-text"},
                {"text": "Answer"},
            ]}
        }]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return _sse_response("data: " + json.dumps(item))

    adapter = GeminiAdapter(credentials={"api_key": "k"}, model_id="gemini-x", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == f"{THINK_OPEN}Hmm {THINK_CLOSE}Answer"


def test_normalized_shape_identical_across_providers() -> None:
    """Same semantic stream from any provider: think span first, then answer."""
    anthropic_lines = [
        'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "R"}}',
        'data: {"type": "content_block_stop", "index": 0}',
        'data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "A"}}',
    ]
    openai_body = (
        'data: {"choices": [{"delta": {"reasoning_content": "R"}}]}\n\n'
        'data: {"choices": [{"delta": {"content": "A"}}]}\n\n'
        "data: [DONE]\n\n"
    )
    gemini_lines = [_gemini_item(thought="R"), _gemini_item(text="A")]

    def handler(lines_or_body):
        def _h(request: httpx.Request) -> httpx.Response:
            content = lines_or_body.encode() if isinstance(lines_or_body, str) else "\n".join(lines_or_body).encode()
            return httpx.Response(200, content=content)
        return _h

    adapters = [
        AnthropicAdapter(credentials={"api_key": "k"}, model_id="c", transport=_transport(handler(anthropic_lines))),
        OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="o", transport=_transport(handler(openai_body))),
        GeminiAdapter(credentials={"api_key": "k"}, model_id="g", transport=_transport(handler(gemini_lines))),
    ]
    for adapter in adapters:
        text, _ = _run(adapter)
        assert text == f"{THINK_OPEN}R{THINK_CLOSE}A", type(adapter).__name__


def test_gateway_persists_think_span_end_to_end(db, provider_factory, model_factory) -> None:
    """Extraction -> generation -> persistence: the stored row keeps the span,
    which is exactly what the UI renders (and refresh restores)."""
    import uuid

    from tollms.api.conversations.service import list_messages
    from tollms.api.gateway.schemas import ChatRequest
    from tollms.api.gateway.service import run_stream

    def handler(request: httpx.Request) -> httpx.Response:
        return _sse_response(*ANTHROPIC_THINKING_SSE)

    p = provider_factory("Claude", ptype="ANTHROPIC_MESSAGES", creds={"api_key": "k"})
    m = model_factory(p["id"])
    req = ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
        message="hi", reasoning_level="medium",
    )

    async def _main() -> list[dict]:
        events = []
        async for raw in run_stream(db, req, _transport(handler)):
            assert raw.startswith("data: ")
            events.append(json.loads(raw[6:]))
        return events

    events = asyncio.run(_main())
    assert events[-1]["done"] is True
    assistants = [msg for msg in list_messages(db, uuid.UUID(events[0]["conversation_id"])) if msg.role.value == "assistant"]
    assert len(assistants) == 1
    assert assistants[0].content == (
        f"{THINK_OPEN}Let me consider the options.{THINK_CLOSE}The answer."
    )


# --- Bedrock: the reported failing path (Claude via Converse) ---------------

BEDROCK_HAIKU = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
BEDROCK_SONNET = "global.anthropic.claude-sonnet-4-6"


def test_bedrock_claude_thinking_fields_requested() -> None:
    """Root cause: Claude on Bedrock emits reasoningContent only when
    additionalModelRequestFields.thinking is set. budget < maxTokens."""
    medium = bedrock_thinking_fields(BEDROCK_HAIKU, "medium", 64000)
    assert medium == ({"thinking": {"type": "enabled", "budget_tokens": 4096}}, 64000)
    low = bedrock_thinking_fields(BEDROCK_SONNET, "low", 64000)
    assert low == ({"thinking": {"type": "enabled", "budget_tokens": 1024}}, 64000)
    # No level / thinking disabled -> nothing sent.
    assert bedrock_thinking_fields(BEDROCK_HAIKU, None, 64000) is None
    assert bedrock_thinking_fields(BEDROCK_HAIKU, "none", 64000) is None


def test_bedrock_non_claude_never_gets_thinking_fields() -> None:
    """DeepSeek-R1/MiniMax reject the thinking field; they reason without it."""
    assert bedrock_thinking_fields("us.deepseek.r1-v1:0", "medium", 4096) is None
    assert bedrock_thinking_fields("minimax.minimax-m2.5", "high", 8192) is None
    assert bedrock_thinking_fields("amazon.titan-text-premier-v1:0", "low", 3072) is None


def test_bedrock_adaptive_only_models_use_adaptive_shape() -> None:
    """Sonnet 5 / Opus 4.7+ 400 on manual budget_tokens: use adaptive+effort."""
    assert bedrock_thinking_fields("global.anthropic.claude-sonnet-5", "ultra", 64000) == (
        {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}}, None,
    )
    assert bedrock_thinking_fields("global.anthropic.claude-opus-4-7", "medium", 64000) == (
        {"thinking": {"type": "adaptive"}, "output_config": {"effort": "medium"}}, None,
    )


def test_bedrock_budget_clamped_to_model_max_output() -> None:
    assert bedrock_thinking_fields(BEDROCK_SONNET, "ultra", 4096) == (
        {"thinking": {"type": "enabled", "budget_tokens": 1024}}, 4096,
    )
    # Too small for any thinking budget: disabled rather than a 400.
    assert bedrock_thinking_fields(BEDROCK_SONNET, "high", 1024) is None


def _bedrock_stream(events: list[dict], model_id: str, level: str | None, max_output: int | None = None):
    """Run the real adapter with a stubbed boto3 stream; capture the payload."""
    adapter = BedrockAdapter(
        credentials={"region": "us-east-1"}, model_id=model_id,
        reasoning_level=level, max_output_tokens=max_output,
    )
    captured: dict = {}

    def fake_stream_events(payload: dict):
        captured.update(payload)
        return iter(events)

    adapter._stream_events = fake_stream_events  # type: ignore[method-assign]

    async def _main() -> str:
        parts = []
        async for chunk in adapter.chat_stream([ChatMessage(role="user", content="hi")]):
            parts.append(chunk.delta)
        return "".join(parts)

    return asyncio.run(_main()), captured


BEDROCK_REASONING_EVENTS = [
    {"contentBlockDelta": {"delta": {"reasoningContent": {"text": "Check "}}}},
    {"contentBlockDelta": {"delta": {"reasoningContent": {"signature": "opaque"}}}},
    {"contentBlockDelta": {"delta": {"reasoningContent": {"text": "facts."}}}},
    {"contentBlockStop": {}},
    {"contentBlockDelta": {"delta": {"text": "Answer."}}},
    {"metadata": {"usage": {"totalTokens": 9}}},
]


def test_bedrock_claude_end_to_end_normalized() -> None:
    text, payload = _bedrock_stream(BEDROCK_REASONING_EVENTS, BEDROCK_HAIKU, "medium", 64000)
    assert payload["additionalModelRequestFields"] == {
        "thinking": {"type": "enabled", "budget_tokens": 4096}
    }
    assert payload["inferenceConfig"] == {"maxTokens": 64000}
    assert text == f"{THINK_OPEN}Check facts.{THINK_CLOSE}Answer."


def test_bedrock_deepseek_no_thinking_fields_but_reasoning_parsed() -> None:
    text, payload = _bedrock_stream(BEDROCK_REASONING_EVENTS, "us.deepseek.r1-v1:0", "medium", 4096)
    assert "additionalModelRequestFields" not in payload
    assert "inferenceConfig" not in payload
    assert text == f"{THINK_OPEN}Check facts.{THINK_CLOSE}Answer."


def test_bedrock_redacted_reasoning_placeholder() -> None:
    events = [
        {"contentBlockDelta": {"delta": {"reasoningContent": {"redactedContent": b"\x01\x02"}}}},
        {"contentBlockDelta": {"delta": {"text": "Safe answer."}}},
    ]
    text, _ = _bedrock_stream(events, "us.deepseek.r1-v1:0", None)
    assert text == f"{THINK_OPEN}(Thinking redacted by the provider){THINK_CLOSE}Safe answer."


# --- Thinking/effort mapping shared helpers ---------------------------------

def test_thinking_params_clamp_and_disable() -> None:
    assert thinking_params("medium", 64000) == (4096, 64000)
    assert thinking_params("ultra", 4096) == (1024, 4096)
    assert thinking_params("low") == (1024, 1024 + 4096)
    assert thinking_params(None) is None
    assert thinking_params("none") is None
    assert thinking_params("default") is None
    assert thinking_params("ultra", 1024) is None


def test_reasoning_effort_mapping() -> None:
    assert reasoning_effort(None) is None
    assert reasoning_effort("none") is None
    assert reasoning_effort("default") is None
    assert reasoning_effort("low") == "low"
    assert reasoning_effort("medium") == "medium"
    assert reasoning_effort("high") == "high"
    assert reasoning_effort("ultra") == "high"  # clamps to the broad max
    assert reasoning_effort("max") == "high"


# --- OpenAI-compatible request-side enablement ------------------------------

def test_openai_chat_sends_reasoning_effort_when_level_set() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=b"data: [DONE]\n\n")

    def run(level: str | None) -> dict:
        adapter = OpenAIChatAdapter(
            credentials={"api_key": "k"}, model_id="m", reasoning_level=level,
            transport=_transport(handler),
        )
        _run(adapter)
        return bodies[-1]

    assert run("high")["reasoning_effort"] == "high"
    assert run("ultra")["reasoning_effort"] == "high"
    assert "reasoning_effort" not in run(None)
    assert "reasoning_effort" not in run("none")


def test_openai_responses_sends_reasoning_object() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _sse_response('data: {"type": "response.completed", "response": {}}')

    adapter = OpenAIResponsesAdapter(
        credentials={"api_key": "k"}, model_id="o4", reasoning_level="low",
        transport=_transport(handler),
    )
    _run(adapter)
    # Summary is requested explicitly so reasoning text streams back.
    assert bodies[-1]["reasoning"] == {"effort": "low", "summary": "auto"}


def test_openai_chat_parses_openrouter_reasoning_shapes() -> None:
    body = (
        'data: {"choices": [{"delta": {"reasoning": "Legacy string. "}}]}\n\n'
        'data: {"choices": [{"delta": {"reasoning_details": ['
        '{"type": "reasoning.text", "text": "Detail A. "},'
        '{"type": "reasoning.encrypted", "data": "opaque"},'
        '{"type": "reasoning.text", "text": "Detail B."}]}}]}\n\n'
        'data: {"choices": [{"delta": {"reasoning_content": " Plus content."}}]}\n\n'
        'data: {"choices": [{"delta": {"content": "Final."}}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode())

    adapter = OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="m", transport=_transport(handler))
    text, _ = _run(adapter)
    assert text == f"{THINK_OPEN}Legacy string. Detail A. Detail B. Plus content.{THINK_CLOSE}Final."


# --- "none": explicit off switch on the request side ------------------------

def test_anthropic_none_level_sends_no_thinking_fields() -> None:
    """None is an explicit off switch: no thinking field and max_tokens stays
    untouched even when the model declares a large max output."""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _sse_response(
            'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}}',
            'data: {"type": "message_stop"}',
        )

    for level in ("none", "default"):
        adapter = AnthropicAdapter(
            credentials={"api_key": "k"}, model_id="claude-x", reasoning_level=level,
            max_output_tokens=64000, transport=_transport(handler),
        )
        text, _ = _run(adapter)
        assert text == "Hi"
        body = bodies[-1]
        assert "thinking" not in body, level
        assert body["max_tokens"] == 4096, level  # never bumped for a budget


def test_openai_responses_none_level_omits_reasoning_object() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _sse_response('data: {"type": "response.completed", "response": {}}')

    for level in (None, "none", "default"):
        adapter = OpenAIResponsesAdapter(
            credentials={"api_key": "k"}, model_id="o4", reasoning_level=level,
            transport=_transport(handler),
        )
        _run(adapter)
        assert "reasoning" not in bodies[-1], level


def test_deepseek_none_requests_no_reasoning_effort_but_still_normalizes() -> None:
    """DeepSeek reasoners are always-on: "none" omits the request parameter
    (DeepSeek rejects reasoning_effort) while provider-emitted reasoning is
    still rendered — off means "not requested", never "hide output"."""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=(
            'data: {"choices": [{"delta": {"reasoning_content": "R"}}]}\n\n'
            'data: {"choices": [{"delta": {"content": "A"}}]}\n\n'
            "data: [DONE]\n\n"
        ).encode())

    adapter = OpenAIChatAdapter(
        credentials={"api_key": "k"}, model_id="deepseek-reasoner",
        reasoning_level="none", transport=_transport(handler),
    )
    text, _ = _run(adapter)
    assert "reasoning_effort" not in bodies[-1]
    assert text == f"{THINK_OPEN}R{THINK_CLOSE}A"


def test_gemini_never_sends_reasoning_config() -> None:
    """Gemini/Vertex thinking is model-controlled: ToLLma never requests it, so
    "none" (and every other level) is a no-op on the wire rather than a
    provider-specific hack."""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return _sse_response(_gemini_item(text="Hi"))

    for level in ("none", "high"):
        adapter = GeminiAdapter(
            credentials={"api_key": "k"}, model_id="gemini-x", reasoning_level=level,
            transport=_transport(handler),
        )
        _run(adapter)
        body = bodies[-1]
        assert "generationConfig" not in body, level
        assert "thinkingConfig" not in body, level


def test_bedrock_none_level_sends_no_thinking_fields_end_to_end() -> None:
    text, payload = _bedrock_stream(BEDROCK_REASONING_EVENTS, BEDROCK_HAIKU, "none", 64000)
    assert "additionalModelRequestFields" not in payload
    assert "inferenceConfig" not in payload
    # Always-on reasoners (or models that ignore the off switch) still render:
    # none disables the request, never the display of provider-emitted reasoning.
    assert text == f"{THINK_OPEN}Check facts.{THINK_CLOSE}Answer."


# --- Gateway forwarding of composer level + model max output ----------------

def _forward_adapter(db, provider_factory, model_factory, monkeypatch, level: str | None):
    """Start a generation with `level` and return the adapter the gateway built."""
    import uuid as _uuid

    from tollms.api.gateway import service as gateway_service
    from tollms.api.gateway.schemas import ChatRequest
    from tollms.services import generation as generation_engine
    from tollms.services.gateway.adapters.base import StreamChunk

    captured: dict = {}

    class CapturingAdapter(OpenAIChatAdapter):
        async def chat_stream(self, messages):
            yield StreamChunk(delta="done")

    def fake_build(*args, **kwargs) -> CapturingAdapter:
        adapter = CapturingAdapter(credentials={"api_key": "k"}, model_id="m")
        captured["adapter"] = adapter
        return adapter

    monkeypatch.setattr(gateway_service, "build_adapter", fake_build)
    p = provider_factory("Cap")
    m = model_factory(p["id"], max_output_tokens=64000)
    req = ChatRequest(
        provider_id=_uuid.UUID(p["id"]), model_id=_uuid.UUID(m["id"]),
        message="hi", reasoning_level=level,
    )

    async def _main():
        started = await gateway_service.start_generation(db, req)
        active = generation_engine.manager.get(started.generation_id)
        assert active is not None and active.task is not None
        await active.task

    asyncio.run(_main())
    return captured["adapter"]


def test_gateway_forwards_level_and_max_output(db, provider_factory, model_factory, monkeypatch) -> None:
    """The composer level and the model's declared max output reach the
    adapter — the two values that enable Claude thinking with a valid budget."""
    adapter = _forward_adapter(db, provider_factory, model_factory, monkeypatch, "high")
    assert adapter.reasoning_level == "high"
    assert adapter.max_output_tokens == 64000


def test_gateway_forwards_none_level_to_adapter(db, provider_factory, model_factory, monkeypatch) -> None:
    """The explicit off selection reaches the adapter as "none" — never
    silently dropped as a falsy value."""
    adapter = _forward_adapter(db, provider_factory, model_factory, monkeypatch, "none")
    assert adapter.reasoning_level == "none"


# --- Persisted reasoning duration (messages.thinking_ms) --------------------

class _ThinkingAdapter(BaseProviderAdapter):
    """Paced normalized thinking: THINK_OPEN → reasoning → THINK_CLOSE → answer."""

    def __init__(self, hold_s: float = 0.15, cancel_after_s: float | None = None) -> None:
        super().__init__(credentials={}, model_id="thinking-mock")
        self._hold = hold_s
        self._cancel_after = cancel_after_s

    async def chat_stream(self, messages):
        yield StreamChunk(delta=THINK_OPEN)
        await asyncio.sleep(self._hold)
        if self._cancel_after is not None:
            await asyncio.sleep(10)  # cancelled while thinking
        yield StreamChunk(delta="pondering the question")
        await asyncio.sleep(self._hold)
        yield StreamChunk(delta=THINK_CLOSE)
        yield StreamChunk(delta="Answer.")


def _row(db, generation_id):
    from sqlalchemy.orm import sessionmaker

    from tollms.api.conversations.service import get_message

    maker = sessionmaker(bind=db.get_bind())
    session = maker()
    try:
        return get_message(session, generation_id)
    finally:
        session.close()


def test_thinking_duration_persisted_on_completion(db, provider_factory, model_factory, monkeypatch) -> None:
    from tollms.api.gateway import service as gateway_service
    from tollms.api.gateway.schemas import ChatRequest
    from tollms.services import generation as generation_engine

    adapter = _ThinkingAdapter(hold_s=0.15)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)
    p = provider_factory("Think")
    m = model_factory(p["id"])
    req = ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]), message="hi")

    async def _main():
        started = await gateway_service.start_generation(db, req)
        active = generation_engine.manager.get(started.generation_id)
        assert active is not None and active.task is not None
        await active.task
        return started

    started = asyncio.run(_main())
    row = _row(db, started.generation_id)
    assert row.status.value == "completed"
    assert row.thinking_ms is not None and row.thinking_ms >= 200  # two 150ms holds
    assert row.content == f"{THINK_OPEN}pondering the question{THINK_CLOSE}Answer."


def test_thinking_duration_persisted_when_interrupted(db, provider_factory, model_factory, monkeypatch) -> None:
    """Cancel mid-think: 'stopped after Xs' stays truthful."""
    from tollms.api.gateway import service as gateway_service
    from tollms.api.gateway.schemas import ChatRequest
    from tollms.services import generation as generation_engine

    adapter = _ThinkingAdapter(hold_s=0.15, cancel_after_s=True)
    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: adapter)
    p = provider_factory("Think")
    m = model_factory(p["id"])
    req = ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]), message="hi")

    async def _main():
        started = await gateway_service.start_generation(db, req)
        await asyncio.sleep(0.15)  # inside the thinking hold
        await gateway_service.cancel_generation(db, started.generation_id)
        active = generation_engine.manager.get(started.generation_id)
        if active is not None and active.task is not None:
            await active.task
        return started

    started = asyncio.run(_main())
    row = _row(db, started.generation_id)
    assert row.status.value == "cancelled"
    assert row.thinking_ms is not None and row.thinking_ms >= 100
    assert row.content == THINK_OPEN  # partial reasoning kept
