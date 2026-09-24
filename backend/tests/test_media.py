"""Chat-native media generation: provider usage cost + metadata persistence.

The standalone /api/v1/media/* debug routes were removed with the /generate page;
image and video generation flow exclusively through the chat pipeline."""

import base64

import httpx
import pytest
from fastapi.testclient import TestClient

PNG_HEADER = b"\x89PNG\r\n\x1a\n"
MP4_HEADER = b"\x00\x00\x00\x18ftypmp42"


def test_chat_media_generation_stores_actual_cost_and_metadata(
    db, provider_factory, model_factory
) -> None:
    """Images generated through the conversation pipeline cost the provider
    usage (actual), not estimated text tokens, and carry generation metadata."""
    import asyncio
    import json

    from tollms.api.conversations.service import list_messages
    from tollms.api.gateway.schemas import ChatRequest
    from tollms.api.gateway.service import run_stream

    p = provider_factory("MediaChat", creds={"base_url": "http://mock"})
    model = model_factory(
        p["id"],
        model_id="gpt-image-1",
        name="GPT Image 1",
        endpoint_type="images_generations",
        primary_endpoint="images/generations",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/images/generations")
        png = base64.b64encode(PNG_HEADER + b"\x00" * 64).decode()
        return httpx.Response(
            200,
            json={
                "data": [{"b64_json": png}],
                "usage": {
                    "input_tokens": 60,
                    "output_tokens": 4160,
                    "input_tokens_details": {"text_tokens": 60, "image_tokens": 0},
                },
            },
        )

    request = ChatRequest(
        provider_id=__import__("uuid").UUID(p["id"]),
        model_id=__import__("uuid").UUID(model["id"]),
        message="a green circle",
    )

    async def collect() -> list[dict]:
        events = []
        async for raw in run_stream(db, request, httpx.MockTransport(handler)):
            events.append(json.loads(raw[6:]))
        return events

    events = asyncio.run(collect())
    assert events[-1]["done"] is True
    conversation_id = __import__("uuid").UUID(events[0]["conversation_id"])
    messages = list_messages(db, conversation_id)
    assistant = messages[-1]
    assert assistant.metadata_["generation_type"] == "image"
    assert assistant.metadata_["cost_source"] == "actual"
    assert assistant.metadata_["cost_estimated"] is False
    assert assistant.metadata_["quality"] == "low"
    assert assistant.metadata_["size"] == "1024x1024"
    # 60 text tokens @ $5/1M + 4160 output tokens @ $40/1M = $0.1667
    assert float(assistant.total_cost) == pytest.approx(0.1667, abs=1e-9)
    assert assistant.usage_estimated is False
    assert assistant.attachments and assistant.attachments[0].kind == "image"


def test_chat_media_estimate_when_provider_reports_no_usage(
    db, provider_factory, model_factory
) -> None:
    """Without provider usage the rate-card estimate is stored and flagged."""
    import asyncio
    import json
    import uuid as _uuid

    from tollms.api.conversations.service import list_messages
    from tollms.api.gateway.schemas import ChatRequest
    from tollms.api.gateway.service import run_stream

    p = provider_factory("MediaEst", creds={"base_url": "http://mock"})
    model = model_factory(
        p["id"],
        model_id="sora-2",
        name="Sora 2",
        endpoint_type="chat_completions",
        primary_endpoint="video/generations",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/videos"):
            return httpx.Response(200, json={"id": "video_1", "status": "completed"})
        if request.url.path.endswith("/videos/video_1/content"):
            return httpx.Response(200, content=MP4_HEADER + b"\x00" * 64)
        return httpx.Response(404, json={"error": "unexpected path"})

    request = ChatRequest(
        provider_id=_uuid.UUID(p["id"]), model_id=_uuid.UUID(model["id"]), message="a flying squirrel"
    )

    async def collect() -> list[dict]:
        events = []
        async for raw in run_stream(db, request, httpx.MockTransport(handler)):
            events.append(json.loads(raw[6:]))
        return events

    events = asyncio.run(collect())
    assert events[-1]["done"] is True
    conversation_id = _uuid.UUID(events[0]["conversation_id"])
    assistant = list_messages(db, conversation_id)[-1]
    assert assistant.metadata_["generation_type"] == "video"
    assert assistant.metadata_["seconds"] == "4"
    assert assistant.metadata_["resolution"] == "720p"
    # 4 seconds of sora-2 at $0.10/second.
    assert float(assistant.total_cost) == pytest.approx(0.40, abs=1e-9)
    assert assistant.usage_estimated is True
    assert assistant.attachments and assistant.attachments[0].kind == "video"
