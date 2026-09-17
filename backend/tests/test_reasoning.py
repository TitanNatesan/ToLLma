"""Reasoning normalization: every adapter maps its wire format into <think>
spans (base.THINK_OPEN/CLOSE) so the gateway, SSE, persistence, and UI treat
reasoning identically for all providers. Raw payloads below mirror the real
provider wire shapes (Anthropic SSE events, OpenAI deltas, Responses events,
Gemini GenerateContentResponse JSON).
"""

import asyncio
import json

import httpx

from tollms.services.gateway.adapters.anthropic import AnthropicAdapter, thinking_budget
from tollms.services.gateway.adapters.base import THINK_CLOSE, THINK_OPEN, ChatMessage
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
