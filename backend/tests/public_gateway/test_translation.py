"""Public gateway unit tests: payload translation + model resolution.

No network, no database: translators are pure and resolution queries are
mocked, so these tests document the exact unified contract mapping.
"""

import asyncio
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tollms.api.public_gateway import service
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.provider import ProviderType
from tollms.services.gateway import model_resolution, translators

DATA_URL = "data:image/png;base64,aGVsbG8="


# --- OpenAI chat completions -------------------------------------------------


def test_openai_chat_translation():
    unified = translators.from_openai_chat(
        {
            "model": "openai/gpt-4o",
            "messages": [
                {"role": "system", "content": "be nice"},
                {"role": "user", "content": "hi"},
            ],
            "stream": True,
            "max_completion_tokens": 256,
            "temperature": 0.2,
            "top_p": 0.9,
            "stop": "END",
            "tools": [{"type": "function", "function": {"name": "f"}}],
            "tool_choice": "auto",
        }
    )
    assert unified.endpoint == "chat_completions"
    assert unified.model_identifier == "openai/gpt-4o"
    assert unified.response_format == "openai"
    assert unified.stream is True
    assert unified.max_tokens == 256
    assert [message.role for message in unified.messages] == ["system", "user"]
    assert unified.stop == ["END"]
    assert unified.tools == [{"type": "function", "function": {"name": "f"}}]
    assert unified.tool_choice == "auto"
    assert unified.as_chat_messages()[0].content == "be nice"


def test_openai_chat_multimodal_image():
    unified = translators.from_openai_chat(
        {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "describe"},
                        {"type": "image_url", "image_url": {"url": DATA_URL}},
                    ],
                }
            ],
        }
    )
    message = unified.messages[0]
    assert message.content == "describe"
    assert len(message.media) == 1
    image = message.media[0]
    assert image.kind == "image"
    assert image.mime_type == "image/png"
    assert image.data_b64 == "aGVsbG8="


def test_openai_chat_prefers_max_tokens():
    unified = translators.from_openai_chat(
        {"model": "m", "messages": [{"role": "user", "content": "x"}], "max_tokens": 10, "max_completion_tokens": 99}
    )
    assert unified.max_tokens == 10


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"model": "", "messages": [{"role": "user", "content": "x"}]},
        {"model": "m", "messages": []},
        {"model": "m", "messages": "nope"},
        {"model": "m", "messages": [{"content": "no role"}]},
        {"model": "m", "messages": [{"role": "user", "content": "x"}], "stop": 5},
        "not-an-object",
    ],
)
def test_openai_chat_rejects_malformed_payloads(payload):
    with pytest.raises(ValidationError):
        translators.from_openai_chat(payload)


# --- Anthropic messages --------------------------------------------------------


def test_anthropic_translation_system_blocks_and_image():
    unified = translators.from_anthropic_messages(
        {
            "model": "anthropic/claude-3-5-sonnet",
            "max_tokens": 1024,
            "system": [{"type": "text", "text": "sys"}],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "what is this"},
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/jpeg", "data": "aGVsbG8="},
                        },
                    ],
                }
            ],
            "stop_sequences": ["STOP"],
            "stream": True,
        }
    )
    assert unified.endpoint == "messages"
    assert unified.response_format == "anthropic"
    assert unified.system == "sys"
    assert unified.max_tokens == 1024
    assert unified.stream is True
    assert unified.stop == ["STOP"]
    message = unified.messages[0]
    assert message.content == "what is this"
    assert message.media[0].mime_type == "image/jpeg"
    assert unified.as_chat_messages()[0].role == "system"


def test_anthropic_system_string():
    unified = translators.from_anthropic_messages(
        {"model": "m", "max_tokens": 5, "system": "plain", "messages": [{"role": "user", "content": "x"}]}
    )
    assert unified.system == "plain"


def test_anthropic_requires_max_tokens():
    with pytest.raises(ValidationError, match="max_tokens"):
        translators.from_anthropic_messages({"model": "m", "messages": [{"role": "user", "content": "x"}]})


def test_anthropic_rejects_malformed_messages():
    with pytest.raises(ValidationError):
        translators.from_anthropic_messages(
            {"model": "m", "max_tokens": 5, "messages": [{"role": "user", "content": [42]}]}
        )


# --- Responses -------------------------------------------------------------------


def test_responses_input_string_with_instructions():
    unified = translators.from_responses(
        {"model": "gpt-5", "input": "hello", "instructions": "be terse", "max_output_tokens": 64}
    )
    assert unified.endpoint == "responses"
    assert unified.response_format == "responses"
    assert unified.system == "be terse"
    assert unified.max_tokens == 64
    assert [message.content for message in unified.messages] == ["hello"]


def test_responses_input_items_with_image():
    unified = translators.from_responses(
        {
            "model": "gpt-5",
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "look"},
                        {"type": "input_image", "image_url": DATA_URL},
                    ],
                }
            ],
        }
    )
    assert unified.messages[0].content == "look"
    assert unified.messages[0].media[0].mime_type == "image/png"


def test_responses_rejects_missing_input():
    with pytest.raises(ValidationError, match="input"):
        translators.from_responses({"model": "gpt-5"})


# --- media ------------------------------------------------------------------------


def test_images_generation_translation():
    unified = translators.from_images(
        {"model": "openai/gpt-image-1", "prompt": "a cat", "size": "512x512", "quality": "high", "n": 2},
        edits=False,
    )
    assert unified.endpoint == "images"
    assert unified.prompt == "a cat"
    assert unified.media_options == {"size": "512x512", "quality": "high", "n": 2}


def test_images_edits_requires_and_keeps_image():
    with pytest.raises(ValidationError, match="image"):
        translators.from_images({"model": "m", "prompt": "p"}, edits=True)
    unified = translators.from_images(
        {"model": "m", "prompt": "p", "image": "aGVsbG8="}, edits=True
    )
    assert unified.endpoint == "image_edits"
    assert unified.media_options["image"] == "aGVsbG8="


def test_images_reject_zero_n():
    with pytest.raises(ValidationError, match="n"):
        translators.from_images({"model": "m", "prompt": "p", "n": 0}, edits=False)


def test_videos_translation():
    unified = translators.from_videos({"model": "sora-2", "prompt": "a dog", "size": "1280x720", "seconds": 8})
    assert unified.endpoint == "videos"
    assert unified.media_options == {"size": "1280x720", "seconds": "8"}


# --- model resolution -------------------------------------------------------------


def _provider(name="DeepSeek", provider_type=ProviderType.CUSTOM, user_id=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        name=name,
        provider_type=provider_type,
        user_id=user_id or uuid.uuid4(),
        is_deleted=False,
        is_active=True,
    )


def _model(provider_id, model_id="deepseek-chat"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        provider_id=provider_id,
        model_id=model_id,
        is_deleted=False,
        is_active=True,
    )


@pytest.fixture()
def cache_stub():
    with (
        patch.object(model_resolution, "cache_get_sync", return_value=None) as get,
        patch.object(model_resolution, "cache_set_sync", return_value=True) as set_,
    ):
        yield SimpleNamespace(get=get, set=set_)


def test_provider_aliases_cover_hints_and_name():
    provider = SimpleNamespace(name="My Claude", provider_type=ProviderType.ANTHROPIC_MESSAGES)
    aliases = model_resolution.provider_aliases(provider)
    assert {"anthropic", "anthropic_messages", "my claude"} <= aliases
    gemini = model_resolution.provider_aliases(SimpleNamespace(name="G", provider_type=ProviderType.GEMINI))
    assert "google" in gemini


def test_resolve_provider_hint(cache_stub):
    provider, model = _provider(), None
    model = _model(provider.id)
    with patch.object(model_resolution, "_candidates_with_hint", return_value=([(provider, model)], True)):
        resolved = model_resolution.resolve_model(None, "deepseek/deepseek-chat", provider.user_id)
    assert resolved.provider is provider
    assert resolved.model is model
    key = cache_stub.set.call_args.args[0]
    assert key == f"tollma:modelres:{provider.user_id}:deepseek/deepseek-chat"
    assert cache_stub.set.call_args.kwargs["ttl"] == 30


def test_resolve_bare_unique(cache_stub):
    provider = _provider()
    model = _model(provider.id)
    with (
        patch.object(model_resolution, "_candidates_with_hint", return_value=([], False)),
        patch.object(model_resolution, "_candidates_bare", return_value=[(provider, model)]) as bare,
    ):
        resolved = model_resolution.resolve_model(None, "DeepSeek-chat", provider.user_id)
    assert resolved.model is model
    bare.assert_called_once_with(None, provider.user_id, "DeepSeek-chat")


def test_resolve_ambiguous_model(cache_stub):
    first, second = _provider(name="A"), _provider(name="B")
    with (
        patch.object(model_resolution, "_candidates_with_hint", return_value=([], False)),
        patch.object(
            model_resolution,
            "_candidates_bare",
            return_value=[(first, _model(first.id)), (second, _model(second.id))],
        ),
    ):
        with pytest.raises(ValidationError, match="ambiguous_model"):
            model_resolution.resolve_model(None, "shared-model", first.user_id)


def test_resolve_missing_model(cache_stub):
    with (
        patch.object(model_resolution, "_candidates_with_hint", return_value=([], False)),
        patch.object(model_resolution, "_candidates_bare", return_value=[]),
    ):
        with pytest.raises(NotFoundError, match="model not found"):
            model_resolution.resolve_model(None, "nope", uuid.uuid4())


def test_resolve_slashed_model_id_falls_back_to_bare(cache_stub):
    provider = _provider()
    model = _model(provider.id, model_id="meta-llama/Llama-3")
    with (
        patch.object(model_resolution, "_candidates_with_hint", return_value=([], False)) as hinted,
        patch.object(model_resolution, "_candidates_bare", return_value=[(provider, model)]) as bare,
    ):
        resolved = model_resolution.resolve_model(None, "meta-llama/Llama-3", provider.user_id)
    hinted.assert_called_once_with(None, provider.user_id, "meta-llama", "Llama-3")
    bare.assert_called_once_with(None, provider.user_id, "meta-llama/Llama-3")
    assert resolved.model is model


def test_resolve_uses_cache_hit():
    provider = _provider()
    model = _model(provider.id)

    class _FakeDB:
        def get(self, model_class, identifier):
            if model_class.__name__ == "Provider" and identifier == provider.id:
                return provider
            if model_class.__name__ == "AIModel" and identifier == model.id:
                return model
            return None

    cached = {"provider_id": str(provider.id), "model_id": str(model.id)}
    with (
        patch.object(model_resolution, "cache_get_sync", return_value=cached),
        patch.object(model_resolution, "cache_set_sync") as set_,
        patch.object(model_resolution, "_resolve_uncached", side_effect=AssertionError("must not query")),
    ):
        resolved = model_resolution.resolve_model(_FakeDB(), "deepseek-chat", provider.user_id)
    assert resolved.provider is provider
    assert resolved.model is model
    set_.assert_not_called()


def test_resolve_cache_ignores_inactive_rows(cache_stub):
    provider = _provider()
    provider.is_active = False
    model = _model(provider.id)

    class _FakeDB:
        def get(self, model_class, identifier):
            return provider if identifier == provider.id else model

    cached = {"provider_id": str(provider.id), "model_id": str(model.id)}
    fresh = model_resolution.ResolvedModel(provider=provider, model=model)
    with (
        patch.object(model_resolution, "cache_get_sync", return_value=cached),
        patch.object(model_resolution, "_resolve_uncached", return_value=fresh) as uncached,
    ):
        resolved = model_resolution.resolve_model(_FakeDB(), "deepseek-chat", provider.user_id)
    uncached.assert_called_once()
    assert resolved is fresh


# --- streaming wire shapes ----------------------------------------------------------


class _FakeAdapter:
    """Provider adapter double: replays pre-built normalized chunks."""

    def __init__(self, chunks):
        self._chunks = chunks

    async def chat_stream(self, messages):
        for chunk in self._chunks:
            yield chunk


def _stream_prepared(response_format: str, chunks):
    from tollms.services.gateway.adapters.base import StreamChunk

    provider = SimpleNamespace(
        id=uuid.uuid4(), name="Mock", provider_type=ProviderType.OPENAI, user_id=uuid.uuid4()
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
    ctx = SimpleNamespace(key_id=uuid.uuid4(), user_id=provider.user_id, key_prefix="tma_sk_live_x")
    unified = translators.from_openai_chat(
        {"model": "mock", "messages": [{"role": "user", "content": "hi"}], "stream": True}
    )
    unified.response_format = response_format
    prepared = service._Prepared(
        ctx=ctx,
        meta=service.ClientMeta(request_id="req-1"),
        unified=unified,
        provider=provider,
        model=model,
        adapter=_FakeAdapter(chunks),
        messages=[],
        history_text="hi",
        started=0.0,
    )
    return prepared


def _data_events(frames):
    events = []
    for frame in frames:
        lines = [line for line in frame.splitlines()]
        event = next((line[7:] for line in lines if line.startswith("event: ")), None)
        data = next((line[6:] for line in lines if line.startswith("data: ")), None)
        if data is not None:
            events.append((event, json.loads(data) if data != "[DONE]" else "[DONE]"))
    return events


@pytest.mark.parametrize("response_format", ["openai", "anthropic", "responses"])
def test_streaming_wire_shapes(response_format):
    from tollms.services.gateway.adapters.base import StreamChunk

    chunks = [
        StreamChunk(delta="Hello"),
        StreamChunk(delta=" world", prompt_tokens=7, completion_tokens=5, total_tokens=12),
    ]
    prepared = _stream_prepared(response_format, chunks)
    recorded: list[dict] = []
    logged: list[object] = []
    with (
        patch.object(service, "find_for_model", return_value=None),
        patch.object(service, "record_usage", lambda *a, **k: recorded.append(k)),
        patch.object(service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        frames = asyncio.run(_collect_stream(service._stream_chat(prepared, db=None)))

    assert len(logged) == 1
    assert logged[0].status == "success"
    assert logged[0].is_streaming is True
    assert logged[0].input_tokens == 7
    assert recorded and recorded[0]["tokens"] == 12

    events = _data_events(frames)
    if response_format == "openai":
        kinds = [event for event, _ in events]
        assert kinds[0] is None  # data-only frames, no event: lines
        assert events[0][1]["object"] == "chat.completion.chunk"
        assert events[0][1]["choices"][0]["delta"]["content"] == "Hello"
        assert events[2][1]["choices"] == []
        assert events[2][1]["usage"] == {
            "prompt_tokens": 7,
            "completion_tokens": 5,
            "total_tokens": 12,
        }
        assert events[-1][1] == "[DONE]"
    elif response_format == "anthropic":
        assert [event for event, _ in events] == [
            "message_start",
            "content_block_start",
            "content_block_delta",
            "content_block_delta",
            "content_block_stop",
            "message_delta",
            "message_stop",
        ]
        assert events[1][1]["content_block"]["type"] == "text"
        assert events[2][1]["delta"] == {"type": "text_delta", "text": "Hello"}
        assert events[5][1]["usage"]["output_tokens"] == 5
    else:
        assert [event for event, _ in events] == [
            "response.created",
            "response.output_text.delta",
            "response.output_text.delta",
            "response.completed",
        ]
        assert events[1][1]["delta"] == "Hello"
        completed = events[3][1]["response"]
        assert completed["status"] == "completed"
        assert completed["usage"] == {"input_tokens": 7, "output_tokens": 5, "total_tokens": 12}


async def _collect_stream(iterator):
    frames = []
    async for frame in iterator:
        frames.append(frame)
    return frames


def test_streaming_failure_logs_once_and_emits_error():
    from tollms.services.gateway.adapters.base import StreamChunk

    class _Failing:
        async def chat_stream(self, messages):
            yield StreamChunk(delta="partial")
            raise RuntimeError("provider error 500: boom")

    prepared = _stream_prepared("openai", [])
    prepared.adapter = _Failing()
    logged: list[object] = []
    with (
        patch.object(service, "find_for_model", return_value=None),
        patch.object(service, "record_usage", lambda *a, **k: None),
        patch.object(service, "log_request", lambda db, entry: logged.append(entry)),
    ):
        frames = asyncio.run(_collect_stream(service._stream_chat(prepared, db=None)))
    assert len(logged) == 1
    assert logged[0].status == "failed"
    assert logged[0].error_code == "PROVIDER_ERROR"
    assert frames[-1] == "data: [DONE]\n\n"
    assert '"error"' in frames[-2]
