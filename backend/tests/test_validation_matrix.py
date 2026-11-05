"""Low-cost endpoint validation matrix.

Every endpoint kind (chat, responses, vision, embeddings, images, audio) is
dispatched through the shared gateway dispatcher and asserted to produce a
minimal result. All transports are mocked: this is the always-on validation
suite; `scripts/validate_endpoints.py` does the same against live providers.
"""

import asyncio
import base64
import json

import httpx
import pytest

from tollms.core.exceptions import ProviderError
from tollms.models.provider import Provider, ProviderType
from tollms.services.gateway.adapters.base import ChatMessage, MediaPart
from tollms.services.gateway.dispatch import call_endpoint
from tollms.services.gateway.factory import build_adapter

# The cheapest possible probes; live script mirrors these.
CHAT_PROMPT = "Say Hello"
CHAT_REPLY = "Hello"
EMBED_INPUT = "hello"
IMAGE_PROMPT = "green circle"
AUDIO_TEXT = "hello"

# 1x1 PNG (transparent) — smallest valid image for the vision probe.
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _provider(ptype: ProviderType = ProviderType.OPENAI, creds: dict | None = None) -> Provider:
    return Provider(name="p", provider_type=ptype, credentials_encrypted="", metadata_={})


def _model(endpoint: str):
    from tollms.models.registered_model import endpoint_enum

    return type(
        "M",
        (),
        {
            "model_id": "cheap-model",
            "primary_endpoint": endpoint,
            "endpoint_type": endpoint_enum(endpoint),
        },
    )()


def _sse_chat(reply: str) -> bytes:
    chunks = [
        {"choices": [{"delta": {"content": reply}}]},
        {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3}},
    ]
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return body.encode()


def _sse_responses(reply: str) -> bytes:
    events = [
        {"type": "response.output_text.delta", "delta": reply},
        {
            "type": "response.completed",
            "response": {"usage": {"input_tokens": 2, "output_tokens": 1, "total_tokens": 3}},
        },
    ]
    return ("".join(f"data: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n").encode()


def _run(endpoint: str, handler, **kwargs):
    adapter = build_adapter(
        _provider(ProviderType.OPENAI, {"api_key": "k"}),
        _model(endpoint),
        {"api_key": "k"},
        httpx.MockTransport(handler),
    )
    adapter.max_output_tokens = 16  # aggressive token cap for every probe
    return asyncio.run(call_endpoint(adapter, endpoint, **kwargs))


@pytest.mark.parametrize("endpoint", ["chat_completions", "responses"])
def test_chat_matrix_returns_tiny_reply(endpoint: str) -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.read().decode()
        content = _sse_chat(CHAT_REPLY) if endpoint == "chat_completions" else _sse_responses(CHAT_REPLY)
        return httpx.Response(200, content=content, headers={"content-type": "text/event-stream"})

    result = _run(endpoint, handler, messages=[ChatMessage(role="user", content=CHAT_PROMPT)])
    assert result.text == CHAT_REPLY
    assert result.completion_tokens <= 8
    assert '"stream":true' in seen["body"].replace(" ", "")


def test_vision_matrix_sends_image_part() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.read().decode()
        return httpx.Response(200, content=_sse_chat("I see a dot"), headers={"content-type": "text/event-stream"})

    message = ChatMessage(
        role="user",
        content="What do you see?",
        media=[MediaPart(kind="image", mime_type="image/png", data_b64=base64.b64encode(TINY_PNG).decode())],
    )
    result = _run("chat_completions", handler, messages=[message])
    assert result.text == "I see a dot"
    assert "image_url" in seen["body"]
    assert "data:image/png;base64," in seen["body"]


def test_embeddings_matrix_returns_vector() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/embeddings")
        return httpx.Response(200, json={"data": [{"embedding": [0.01, -0.02, 0.03]}]})

    vectors = _run("embeddings", handler, inputs=[EMBED_INPUT])
    assert len(vectors) == 1 and len(vectors[0]) == 3


def test_images_matrix_returns_single_image() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/images/generations")
        body = json.loads(request.read())
        # Explicit caller-supplied params pass through; nothing is invented
        # (no "n": the loop, not the provider, drives multi-image runs).
        assert body["size"] == "1024x1024" and body["quality"] == "low"
        assert "n" not in body
        return httpx.Response(
            200, json={"data": [{"b64_json": base64.b64encode(b"\x89PNGtiny").decode()}]}
        )

    image = _run("images/generations", handler, prompt=IMAGE_PROMPT, options={"size": "1024x1024", "quality": "low"})
    assert image.startswith(b"\x89PNG")


def test_audio_transcription_matrix_returns_text() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/audio/transcriptions")
        return httpx.Response(200, json={"text": AUDIO_TEXT})

    text = _run("audio/transcriptions", handler, audio=b"RIFF-fake", filename="hello.wav", mime_type="audio/wav")
    assert text == AUDIO_TEXT


def test_audio_speech_matrix_returns_bytes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/audio/speech")
        assert json.loads(request.read())["input"] == AUDIO_TEXT
        return httpx.Response(200, content=b"ID3-audio", headers={"content-type": "audio/mpeg"})

    audio = _run("audio/speech", handler, text=AUDIO_TEXT, options={"voice": "alloy"})
    assert audio == b"ID3-audio"


def test_video_matrix_creates_polls_and_downloads() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/videos"):
            assert request.headers["content-type"].startswith("multipart/form-data")
            return httpx.Response(200, json={"id": "video_123", "status": "queued"})
        if request.url.path.endswith("/videos/video_123"):
            return httpx.Response(200, json={"id": "video_123", "status": "completed"})
        if request.url.path.endswith("/videos/video_123/content"):
            return httpx.Response(200, content=b"mp4-bytes", headers={"content-type": "video/mp4"})
        return httpx.Response(404)

    video = _run(
        "video/generations",
        handler,
        prompt="a green circle pulsing",
        options={"size": "1280x720", "seconds": "4", "poll_interval": 0.01},
    )
    assert video == b"mp4-bytes"
    assert calls[0].endswith("/videos") and calls[-1].endswith("/content")


def test_video_poll_retries_transient_transport_errors() -> None:
    """A DNS/TCP hiccup during a long video poll must not kill the job."""
    polls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/videos"):
            return httpx.Response(200, json={"id": "v1", "status": "queued"})
        if request.url.path.endswith("/videos/v1"):
            polls["count"] += 1
            if polls["count"] == 1:
                raise httpx.ConnectError("temporary DNS failure")
            return httpx.Response(200, json={"id": "v1", "status": "completed"})
        if request.url.path.endswith("/videos/v1/content"):
            return httpx.Response(200, content=b"mp4-bytes")
        return httpx.Response(404)

    video = _run("video/generations", handler, prompt="x", options={"poll_interval": 0.01})
    assert video == b"mp4-bytes"
    assert polls["count"] == 2


def test_dispatcher_rejects_unknown_endpoint() -> None:
    adapter = build_adapter(
        _provider(ProviderType.OPENAI, {"api_key": "k"}),
        _model("chat_completions"),
        {"api_key": "k"},
    )
    with pytest.raises(ProviderError):
        asyncio.run(call_endpoint(adapter, "holograms/generations"))
