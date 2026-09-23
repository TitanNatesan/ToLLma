"""Media generation routes: endpoint validation + attachment persistence."""

import base64

import httpx
import pytest
from fastapi.testclient import TestClient

from tollms.api.media import service as media_service
from tollms.services.gateway.factory import build_adapter as real_build_adapter

PNG_HEADER = b"\x89PNG\r\n\x1a\n"
MP4_HEADER = b"\x00\x00\x00\x18ftypmp42"


def _adapter_with(handler):
    def fake_build_adapter(provider, model, credentials, transport=None):
        return real_build_adapter(provider, model, credentials, httpx.MockTransport(handler))

    return fake_build_adapter


def test_image_generation_persists_attachment(
    client: TestClient, provider_factory, model_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    p = provider_factory("MediaImg", creds={"base_url": "http://mock"})
    model = model_factory(p["id"], endpoint_type="images_generations", primary_endpoint="images/generations")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/images/generations")
        png = base64.b64encode(PNG_HEADER + b"\x00" * 64).decode()
        return httpx.Response(200, json={"data": [{"b64_json": png}]})

    monkeypatch.setattr(media_service, "build_adapter", _adapter_with(handler))
    r = client.post(
        "/api/v1/media/images",
        json={
            "provider_id": p["id"],
            "model_id": model["id"],
            "prompt": "green circle",
            "quality": "low",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attachment"]["kind"] == "image"
    assert body["attachment"]["mime_type"] == "image/png"
    assert body["attachment"]["file_size"] > 0
    content = client.get(f"/api/v1/chat/attachments/{body['attachment']['id']}/content")
    assert content.status_code == 200
    assert content.content.startswith(PNG_HEADER)


def test_video_generation_with_reference_image(
    client: TestClient, provider_factory, model_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    p = provider_factory("MediaVid", creds={"base_url": "http://mock"})
    model = model_factory(p["id"], endpoint_type="chat_completions", primary_endpoint="video/generations")

    # Reference image upload (normal attachment flow).
    upload = client.post(
        "/api/v1/chat/attachments",
        files={"file": ("ref.png", PNG_HEADER + b"\x00" * 32, "image/png")},
    )
    assert upload.status_code in (200, 201), upload.text
    reference_id = upload.json()["attachment_id"]

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        if request.url.path.endswith("/videos"):
            assert b"input_reference" in request.content
            return httpx.Response(200, json={"id": "video_1", "status": "queued"})
        if request.url.path.endswith("/videos/video_1"):
            return httpx.Response(200, json={"id": "video_1", "status": "completed"})
        if request.url.path.endswith("/videos/video_1/content"):
            return httpx.Response(200, content=MP4_HEADER + b"\x00" * 128, headers={"content-type": "video/mp4"})
        return httpx.Response(404)

    monkeypatch.setattr(media_service, "build_adapter", _adapter_with(handler))
    r = client.post(
        "/api/v1/media/videos",
        json={
            "provider_id": p["id"],
            "model_id": model["id"],
            "prompt": "wave at the camera",
            "seconds": "4",
            "reference_attachment_id": reference_id,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attachment"]["kind"] == "video"
    assert body["attachment"]["mime_type"] == "video/mp4"
    assert seen["path"].endswith("/videos/video_1/content")


def test_media_rejects_model_without_endpoint(
    client: TestClient, provider_factory, model_factory
) -> None:
    p = provider_factory("MediaBad", creds={"base_url": "http://mock"})
    model = model_factory(p["id"], endpoint_type="chat_completions")
    r = client.post(
        "/api/v1/media/images",
        json={"provider_id": p["id"], "model_id": model["id"], "prompt": "nope"},
    )
    assert r.status_code in (400, 422)
    assert "images/generations" in r.text
