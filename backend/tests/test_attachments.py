"""Attachment tests: upload, ownership, extraction, adapter transforms, gateway flow."""

import asyncio
import base64
import io
import json
import uuid
import zipfile

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.gateway.schemas import ChatRequest
from tollms.api.gateway.service import run_chat, run_stream
from tollms.core.config import get_settings
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.main import app
from tollms.models.attachment import Attachment
from tollms.services.gateway import attachments as engine
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import ChatMessage, MediaPart
from tollms.services.gateway.adapters.bedrock import BedrockAdapter
from tollms.services.gateway.adapters.gemini import _gemini_parts
from tollms.services.gateway.adapters.openai import OpenAIChatAdapter, OpenAIResponsesAdapter

# Valid 1x1 PNG (magic bytes pass the sniffer).
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c626001000000ffff03000006000557bfabd4"
    "0000000049454e44ae426082"
)

SSE_BODY = (
    'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
    'data: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}\n\n'
    "data: [DONE]\n\n"
)


@pytest.fixture()
def _storage(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "storage_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(get_settings(), "max_upload_mb", 25)


def _upload(client: TestClient, name: str, data: bytes, mime: str):
    return client.post(
        "/api/v1/chat/attachments", files={"file": (name, data, mime)}
    )


def _other_client() -> TestClient:
    c2 = TestClient(app)
    r = c2.post("/auth/signup", json={"email": "other@tollma.ai", "password": "Password123"})
    assert r.status_code == 200, r.text
    return c2


def _uid(client: TestClient) -> uuid.UUID:
    return uuid.UUID(client.get("/auth/me").json()["id"])


def _chat_transport(captured: list, transcript: str | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/audio/transcriptions"):
            return httpx.Response(200, json={"text": transcript or "spoken words here"})
        assert request.url.path.endswith("/chat/completions")
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=SSE_BODY.encode(), headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler)


def _docx(*paras: str) -> bytes:
    body = "".join(f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paras)
    xml = (
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", xml)
    return buf.getvalue()


# --- upload API ---


def test_upload_image(client: TestClient, provider_factory, _storage) -> None:
    provider_factory("Mock")
    r = _upload(client, "cat.png", PNG, "image/png")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "image"
    assert body["filename"] == "cat.png"
    assert body["size"] == len(PNG)
    assert "storage_path" not in body
    assert "attachment_id" in body


def test_upload_document_extracts_text(client: TestClient, db: Session, provider_factory, _storage) -> None:
    provider_factory("Mock")
    r = _upload(client, "notes.txt", b"hello world", "text/plain")
    assert r.status_code == 201, r.text
    row = db.get(Attachment, uuid.UUID(r.json()["attachment_id"]))
    assert row is not None and row.kind == "document"
    assert row.extracted_text == "hello world"


def test_upload_rejects_bad_type_mismatch_and_empty(client: TestClient, provider_factory, _storage) -> None:
    provider_factory("Mock")
    assert _upload(client, "evil.exe", b"MZ", "application/octet-stream").status_code == 422
    assert _upload(client, "fake.png", b"not an image at all", "image/png").status_code == 422
    assert _upload(client, "empty.txt", b"", "text/plain").status_code == 422


def test_upload_rejects_oversize(client: TestClient, provider_factory, _storage, monkeypatch) -> None:
    provider_factory("Mock")
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    assert _upload(client, "big.txt", b"x", "text/plain").status_code == 422


def test_upload_requires_auth(db: Session) -> None:
    c = TestClient(app)
    r = c.post("/api/v1/chat/attachments", files={"file": ("a.txt", b"x", "text/plain")})
    assert r.status_code in (401, 403)


# --- ownership + retrieval ---


def test_cross_user_access_is_404(client: TestClient, provider_factory, _storage) -> None:
    provider_factory("Mock")
    aid = _upload(client, "cat.png", PNG, "image/png").json()["attachment_id"]
    other = _other_client()
    assert other.get(f"/api/v1/chat/attachments/{aid}").status_code == 404
    assert other.get(f"/api/v1/chat/attachments/{aid}/content").status_code == 404
    assert other.delete(f"/api/v1/chat/attachments/{aid}").status_code == 404
    # Owner still sees it.
    assert client.get(f"/api/v1/chat/attachments/{aid}").status_code == 200


def test_download_roundtrip(client: TestClient, provider_factory, _storage) -> None:
    provider_factory("Mock")
    aid = _upload(client, "cat.png", PNG, "image/png").json()["attachment_id"]
    r = client.get(f"/api/v1/chat/attachments/{aid}/content")
    assert r.status_code == 200
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"


def test_delete_staged_only(client: TestClient, db: Session, provider_factory, _storage) -> None:
    provider_factory("Mock")
    aid = _upload(client, "temp.txt", b"bye", "text/plain").json()["attachment_id"]
    assert client.delete(f"/api/v1/chat/attachments/{aid}").status_code == 204
    assert client.get(f"/api/v1/chat/attachments/{aid}").status_code == 404
    row = db.get(Attachment, uuid.UUID(aid))
    assert row is not None and row.is_deleted


# --- extraction engine ---


def test_extract_docx_and_csv() -> None:
    assert engine.extract_text(_docx("Alpha", "Beta"), "d.docx") == "Alpha\nBeta"
    assert engine.extract_text(b"a,b\n1,2\n", "t.csv") == "a | b\n1 | 2"


def test_extract_rejects_corrupt_pdf() -> None:
    try:
        engine.extract_text(b"%PDF-1.4 garbage", "broken.pdf")
        raise AssertionError("expected ValidationError")
    except ValidationError:
        pass


# --- adapter transforms ---


def _img() -> MediaPart:
    return MediaPart(kind="image", mime_type="image/png",
                     data_b64=base64.b64encode(PNG).decode(), filename="cat.png")


def test_openai_chat_image_and_audio_parts() -> None:
    a = OpenAIChatAdapter(credentials={}, model_id="m")
    content = a._content(ChatMessage(role="user", content="hi", media=[_img()]))
    img = next(p for p in content if p["type"] == "image_url")
    assert img["image_url"]["url"].startswith("data:image/png;base64,")
    audio = MediaPart(kind="audio", mime_type="audio/wav", data_b64="AAA", filename="a.wav")
    content = a._content(ChatMessage(role="user", content="", media=[audio]))
    assert content[0] == {"type": "input_audio", "input_audio": {"data": "AAA", "format": "wav"}}
    assert a.supports_vision and a.supports_audio and not a.supports_video
    assert OpenAIResponsesAdapter(credentials={}, model_id="m").supports_audio is False


def test_anthropic_gemini_bedrock_parts() -> None:
    block = AnthropicAdapter(credentials={}, model_id="m")._content(
        ChatMessage(role="user", content="hi", media=[_img()]))
    img = next(p for p in block if p["type"] == "image")
    assert img["source"] == {"type": "base64", "media_type": "image/png",
                             "data": base64.b64encode(PNG).decode()}
    parts = _gemini_parts(ChatMessage(role="user", content="hi", media=[_img()]))
    assert {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(PNG).decode()}} in parts
    b = BedrockAdapter(credentials={}, model_id="m")
    blocks = b._blocks(ChatMessage(role="user", content="hi", media=[_img()]))
    assert blocks[1]["image"]["format"] == "png"
    assert b.supports_vision and b.supports_video and not b.supports_audio


# --- gateway flow ---


def test_gateway_image_reaches_provider(
    client: TestClient, db: Session, provider_factory, model_factory, _storage
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"], supports_vision=True)
    aid = _upload(client, "cat.png", PNG, "image/png").json()["attachment_id"]
    captured: list[dict] = []
    req = ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                      message="what is this?", attachment_ids=[uuid.UUID(aid)])
    result = asyncio.run(run_chat(db, req, _chat_transport(captured), user_id=_uid(client)))
    assert result.content == "Hello world"
    sent = captured[0]["messages"][0]
    img = next(p for p in sent["content"] if p["type"] == "image_url")
    assert base64.b64decode(img["image_url"]["url"].split(",", 1)[1]) == PNG
    row = db.get(Attachment, uuid.UUID(aid))
    assert row is not None and row.message_id is not None and row.conversation_id == result.conversation_id
    # History read exposes the attachment (preview cards source).
    conv = client.get(f"/api/v1/conversations/{result.conversation_id}").json()
    assert conv["messages"][0]["attachments"][0]["filename"] == "cat.png"


def test_gateway_document_text_injected(
    client: TestClient, db: Session, provider_factory, model_factory, _storage
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"], metadata={"supports_files": True})
    aid = _upload(client, "notes.txt", b"secret recipe", "text/plain").json()["attachment_id"]
    captured: list[dict] = []
    asyncio.run(run_chat(
        db,
        ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                    message="summarize", attachment_ids=[uuid.UUID(aid)]),
        _chat_transport(captured),
        user_id=_uid(client),
    ))
    assert "secret recipe" in captured[0]["messages"][0]["content"]


def test_gateway_rejects_unsupported_and_transcribes(
    client: TestClient, db: Session, provider_factory, model_factory, _storage
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])  # no vision flag
    aid = _upload(client, "cat.png", PNG, "image/png").json()["attachment_id"]
    try:
        asyncio.run(run_chat(
            db,
            ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                        message="hi", attachment_ids=[uuid.UUID(aid)]),
            _chat_transport([]),
            user_id=_uid(client),
        ))
        raise AssertionError("expected ValidationError")
    except ValidationError:
        pass

    # OpenAI-family audio without native support falls back to transcription.
    po = provider_factory("OA", ptype="OPENAI", creds={"api_key": "k"})
    mo = model_factory(po["id"])
    wav = b"RIFF" + b"\x00" * 100
    aa = _upload(client, "note.wav", wav, "audio/wav").json()["attachment_id"]
    captured: list[dict] = []
    asyncio.run(run_chat(
        db,
        ChatRequest(provider_id=uuid.UUID(po["id"]), model_id=uuid.UUID(mo["id"]),
                    message="transcribe", attachment_ids=[uuid.UUID(aa)]),
        _chat_transport(captured, transcript="hello there"),
        user_id=_uid(client),
    ))
    assert "hello there" in captured[0]["messages"][0]["content"]
    row = db.get(Attachment, uuid.UUID(aa))
    assert row is not None and row.extracted_text == "hello there"

    # Sent attachments cannot be deleted (conversation history).
    assert client.delete(f"/api/v1/chat/attachments/{aa}").status_code == 422


def test_history_reinjects_image_on_next_turn(
    client: TestClient, db: Session, provider_factory, model_factory, _storage
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"], supports_vision=True)
    aid = _upload(client, "cat.png", PNG, "image/png").json()["attachment_id"]
    base = {"provider_id": uuid.UUID(p["id"]), "model_id": uuid.UUID(m["id"])}
    first = asyncio.run(run_chat(
        db, ChatRequest(**base, message="first", attachment_ids=[uuid.UUID(aid)]), _chat_transport([]),
        user_id=_uid(client)))
    captured: list[dict] = []
    asyncio.run(run_chat(
        db, ChatRequest(**base, message="second", conversation_id=first.conversation_id),
        _chat_transport(captured), user_id=_uid(client)))
    turn2_user = captured[0]["messages"][0]
    kinds = [p_["type"] for p_ in turn2_user["content"]]
    assert "image_url" in kinds  # prior-turn image re-attached from storage


def test_stream_links_attachments(
    client: TestClient, db: Session, provider_factory, model_factory, _storage
) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"], supports_vision=True)
    aid = _upload(client, "cat.png", PNG, "image/png").json()["attachment_id"]

    async def collect() -> list[dict]:
        events = []
        stream = run_stream(
            db,
            ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                        message="hi", attachment_ids=[uuid.UUID(aid)]),
            _chat_transport([]),
            user_id=_uid(client),
        )
        async for raw in stream:
            events.append(json.loads(raw[6:]))
        return events

    events = asyncio.run(collect())
    assert events[-1]["done"] is True
    row = db.get(Attachment, uuid.UUID(aid))
    assert row is not None and row.message_id is not None


def test_unknown_attachment_id_404s(client: TestClient, db: Session, provider_factory, model_factory) -> None:
    p = provider_factory("Mock")
    m = model_factory(p["id"])
    try:
        asyncio.run(run_chat(
            db,
            ChatRequest(provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
                        message="hi", attachment_ids=[uuid.uuid4()]),
            _chat_transport([]),
            user_id=_uid(client),
        ))
        raise AssertionError("expected NotFoundError")
    except NotFoundError:
        pass
