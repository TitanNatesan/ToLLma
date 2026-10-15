"""Media continuity: history-fed image edits + lineage metadata.

Turn N in an image conversation reuses the most recent prior image in the
SAME conversation as the /images/edits reference (explicit uploads first),
with size/count intent parsed from the prompt text and lineage recorded on
the new assistant message (zero-migration: messages.metadata_ JSONB).
"""

import asyncio
import base64
import json
import uuid
from types import SimpleNamespace

import httpx
import pytest

from tollms.api.attachments import service as attachment_service
from tollms.api.conversations.service import list_messages
from tollms.api.gateway import service as gateway_service
from tollms.api.gateway.schemas import ChatRequest
from tollms.api.gateway.service import (
    IMAGE_MAX_COUNT,
    _parse_image_intent,
    _resolve_image_reference,
    _select_media_operation,
    _setup_generation,
    run_stream,
)
from tollms.core.config import get_settings
from tollms.models.message import Role

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PNG_B64 = base64.b64encode(PNG).decode()


@pytest.fixture()
def _storage(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "storage_dir", str(tmp_path / "uploads"))


def _providers(provider_factory, model_factory, name, ptype="CUSTOM", model_id="gpt-image-1"):
    p = provider_factory(name, ptype=ptype, creds={"base_url": "http://mock"})
    m = model_factory(
        p["id"],
        model_id=model_id,
        name=model_id,
        endpoint_type="images_generations",
        primary_endpoint="images/generations",
    )
    return p, m


class _Recorder:
    """Mock transport serving generations + edits while recording requests."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith(("/images/generations", "/images/edits")):
            return httpx.Response(200, json={"data": [{"b64_json": PNG_B64}]})
        if request.url.path.endswith("/videos"):
            return httpx.Response(200, json={"id": "vid1", "status": "completed"})
        if request.url.path.endswith("/videos/vid1/content"):
            return httpx.Response(200, content=b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
        return httpx.Response(404, json={"error": f"unexpected {request.url.path}"})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def paths(self) -> list[str]:
        return [r.url.path for r in self.requests]


def _request(p, m, message, **kw) -> ChatRequest:
    return ChatRequest(
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]), message=message, **kw
    )


def _run(db, request, transport) -> list[dict]:
    async def collect() -> list[dict]:
        events = []
        async for raw in run_stream(db, request, transport):
            events.append(json.loads(raw[6:]))
        return events

    return asyncio.run(collect())


def _assistant(db, conversation_id) -> object:
    return list_messages(db, conversation_id)[-1]


# --- intent parsing (no LLM call) -------------------------------------------


@pytest.mark.parametrize(
    "text,count,count_source",
    [
        ("make it widescreen", 1, "default"),
        ("a 2:1 banner", 1, "default"),
        ("a green circle", 1, "default"),
        ("give me 3 variations of a cat", 3, "explicit"),
        ("3 variations, widescreen", 3, "explicit"),
        ("99 variations please", IMAGE_MAX_COUNT, "explicit"),
    ],
)
def test_image_count_intent_matrix(text, count, count_source) -> None:
    # Size/aspect/quality prose is never parsed into params: the model reads
    # the prompt itself. Only the output count is interpreted.
    assert _parse_image_intent(text) == (count, count_source)


# --- reference resolution (pure) -------------------------------------------


def _row(row_id, *, kind="image", user_id, conv_id):
    return SimpleNamespace(id=row_id, kind=kind, user_id=user_id, conversation_id=conv_id)


def _msg(msg_id, role, content=""):
    return SimpleNamespace(id=msg_id, role=role, content=content)


def test_resolve_reference_prefers_most_recent_and_skips_foreign_rows() -> None:
    me, other, conv, foreign_conv = (uuid.uuid4() for _ in range(4))
    u1, a1, u2, a2, u3, a3 = (uuid.uuid4() for _ in range(6))
    ok_row = _row(uuid.uuid4(), user_id=me, conv_id=conv)
    messages = [
        _msg(u1, Role.USER, "a red boat"),
        _msg(a1, Role.ASSISTANT, ""),
        _msg(u2, Role.USER, "make it blue"),
        _msg(a2, Role.ASSISTANT, ""),
        _msg(u3, Role.USER, "add sunset"),
        _msg(a3, Role.ASSISTANT, ""),
    ]
    grouped = {
        a1: [_row(uuid.uuid4(), user_id=me, conv_id=foreign_conv)],  # cross-conversation
        a2: [_row(uuid.uuid4(), user_id=other, conv_id=conv)],  # cross-user
        a3: [ok_row],
    }
    row, message_id, excerpt = _resolve_image_reference(messages, grouped, me, conv)
    assert row.id == ok_row.id
    assert message_id == a3
    assert excerpt == "add sunset"


def test_resolve_reference_returns_none_when_only_foreign_rows() -> None:
    me, other, conv, foreign_conv = (uuid.uuid4() for _ in range(4))
    u1, a1 = uuid.uuid4(), uuid.uuid4()
    messages = [_msg(u1, Role.USER, "hi"), _msg(a1, Role.ASSISTANT, "")]
    grouped = {
        a1: [
            _row(uuid.uuid4(), user_id=other, conv_id=conv),
            _row(uuid.uuid4(), user_id=me, conv_id=foreign_conv),
        ]
    }
    assert _resolve_image_reference(messages, grouped, me, conv) is None


# --- operation selection (pure) --------------------------------------------


@pytest.mark.parametrize(
    "supports_edit,has_reference,excerpt,prompt,expected",
    [
        (True, True, "", "make it blue", ("edit", "make it blue", None)),
        (
            False, True, "a red boat", "make it blue",
            ("generate", "Same subject as: a red boat. make it blue", "edit_unsupported"),
        ),
        (False, True, "", "make it blue", ("generate", "make it blue", "edit_unsupported")),
        (True, False, "", "a cat", ("generate", "a cat", None)),
    ],
)
def test_operation_selection_matrix(supports_edit, has_reference, excerpt, prompt, expected) -> None:
    assert _select_media_operation(
        supports_edit=supports_edit, has_reference=has_reference,
        prior_excerpt=excerpt, prompt=prompt,
    ) == expected


# --- generations fallback: no history ---------------------------------------


def test_first_turn_generates_with_default_lineage(db, provider_factory, model_factory, _storage) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaFirst")
    rec = _Recorder()
    events = _run(db, _request(p, m, "a green circle"), rec.transport())

    assert events[-1]["done"] is True
    assert rec.paths() == ["/images/generations"]
    body = json.loads(rec.requests[0].content.decode())
    # Prompt-only sends: model + prompt, no invented size/n/quality params.
    assert body == {"model": body["model"], "prompt": "a green circle"}

    assistant = _assistant(db, uuid.UUID(events[0]["conversation_id"]))
    meta = assistant.metadata_
    assert meta["generation_type"] == "image"
    assert meta["generation_operation"] == "generate"
    assert meta["intent"] == {"count_source": "default"}
    assert "reference_attachment_id" not in meta
    assert "reference_message_id" not in meta
    assert assistant.attachments and assistant.attachments[0].kind == "image"


def test_new_conversation_ignores_other_conversation_images(
    db, provider_factory, model_factory, _storage
) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaIsolation")
    rec = _Recorder()
    first = _run(db, _request(p, m, "a red boat"), rec.transport())
    assert first[-1]["done"] is True
    second = _run(db, _request(p, m, "make it blue"), rec.transport())
    assert second[-1]["done"] is True

    assert rec.paths() == ["/images/generations", "/images/generations"]
    meta = _assistant(db, uuid.UUID(second[0]["conversation_id"])).metadata_
    assert meta["generation_operation"] == "generate"
    assert "reference_attachment_id" not in meta


# --- continuity: second turn edits ------------------------------------------


def test_second_turn_edits_with_reference_bytes_and_lineage(
    db, provider_factory, model_factory, _storage
) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaEdit")
    rec = _Recorder()
    first = _run(db, _request(p, m, "a red boat"), rec.transport())
    assert first[-1]["done"] is True
    conv_id = uuid.UUID(first[0]["conversation_id"])
    prior_assistant = _assistant(db, conv_id)
    prior_attachment = prior_assistant.attachments[0]

    second = _run(
        db, _request(p, m, "add a sunset, 2:1", conversation_id=conv_id), rec.transport()
    )
    assert second[-1]["done"] is True

    assert rec.paths() == ["/images/generations", "/images/edits"]
    edit_request = rec.requests[1]
    assert PNG[:16] in edit_request.content  # reference bytes travel multipart
    # No size param: the "2:1" prose stays in the prompt for the model.
    assert b"1792x1024" not in edit_request.content

    meta = _assistant(db, conv_id).metadata_
    assert meta["generation_operation"] == "edit"
    assert "size" not in meta and "quality" not in meta  # model-decided
    assert meta["reference_attachment_id"] == str(prior_attachment.id)
    assert meta["reference_message_id"] == str(prior_assistant.id)
    assert meta["prior_prompt_excerpt"] == "a red boat"
    assert meta["intent"] == {"count_source": "default"}

    # Prior output is preserved: old row still linked to the old message, the
    # new output is a new row on the new assistant message.
    db.refresh(prior_attachment)
    assert prior_attachment.message_id == prior_assistant.id and not prior_attachment.is_deleted
    current = _assistant(db, conv_id)
    assert current.id != prior_assistant.id
    assert len(current.attachments) == 1
    assert current.attachments[0].id != prior_attachment.id
    assert current.attachments[0].message_id == current.id


def test_explicit_upload_takes_precedence_over_history(
    db, provider_factory, model_factory, _storage
) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaExplicit")
    rec = _Recorder()
    staged = attachment_service.upload_attachment(
        db, user_id=None, filename="ref.png", content_type="image/png", data=PNG,
    )
    events = _run(
        db, _request(p, m, "restyle this", attachment_ids=[staged.id]), rec.transport()
    )
    assert events[-1]["done"] is True

    assert rec.paths() == ["/images/edits"]
    assert PNG[:16] in rec.requests[0].content
    meta = _assistant(db, uuid.UUID(events[0]["conversation_id"])).metadata_
    assert meta["generation_operation"] == "edit"
    assert meta["reference_attachment_id"] == str(staged.id)
    assert "reference_message_id" not in meta


# --- count ------------------------------------------------------------------


def test_count_parsing_drives_sequential_generations(
    db, provider_factory, model_factory, _storage
) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaCount")
    rec = _Recorder()
    events = _run(db, _request(p, m, "a cat, 3 variations"), rec.transport())
    assert events[-1]["done"] is True

    assert rec.paths() == ["/images/generations"] * 3
    assistant = _assistant(db, uuid.UUID(events[0]["conversation_id"]))
    assert len(assistant.attachments) == 3
    meta = assistant.metadata_
    assert meta["count"] == 3 and len(meta["filenames"]) == 3
    assert meta["intent"] == {"count_source": "explicit"}


def test_count_clamped_to_provider_max(db, provider_factory, model_factory, _storage) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaClamp")
    rec = _Recorder()
    events = _run(db, _request(p, m, "99 variations please"), rec.transport())
    assert events[-1]["done"] is True

    assert rec.paths() == ["/images/generations"] * IMAGE_MAX_COUNT
    assert _assistant(db, uuid.UUID(events[0]["conversation_id"])).metadata_["count"] == IMAGE_MAX_COUNT


# --- unsupported family: fail fast, never claim an edit -------------------------


def test_unsupported_family_fails_before_any_edit(
    db, provider_factory, model_factory, _storage
) -> None:
    from tollms.core.exceptions import ProviderError

    p, m = _providers(provider_factory, model_factory, "MediaCustom", model_id="gpt-image-1")
    rec = _Recorder()
    first = _run(db, _request(p, m, "a red boat"), rec.transport())
    assert first[-1]["done"] is True
    conv_id = uuid.UUID(first[0]["conversation_id"])

    pg, mg = _providers(
        provider_factory, model_factory, "MediaGemini", ptype="GEMINI", model_id="imagen-3"
    )
    with pytest.raises(ProviderError, match="does not support endpoint"):
        asyncio.run(
            _setup_generation(
                db, _request(pg, mg, "make it blue", conversation_id=conv_id), rec.transport(), None
            )
        )
    # No edit was attempted: only the first turn's generations call went out.
    assert rec.paths() == ["/images/generations"]


# --- video intent + image-to-video -------------------------------------------

from tollms.api.gateway.service import _parse_video_intent  # noqa: E402


@pytest.mark.parametrize(
    "text,seconds,source",
    [
        ("animate this", "4", "default"),
        ("a 5 second clip", "5", "explicit"),
        ("make it 10 seconds long", "10", "explicit"),
        ("a 99 second epic", "60", "explicit"),
        ("a cinematic video", "4", "default"),
    ],
)
def test_video_seconds_intent_matrix(text, seconds, source) -> None:
    assert _parse_video_intent(text) == (seconds, source)


def _video_providers(provider_factory, model_factory, name):
    p = provider_factory(name, ptype="CUSTOM", creds={"base_url": "http://mock"})
    m = model_factory(
        p["id"],
        model_id="stub-video-1",
        name="stub-video-1",
        primary_endpoint="video/generations",
        supported_endpoints=["video/generations"],
    )
    return p, m


def test_video_reuses_prior_image_as_input_reference(
    db, provider_factory, model_factory, _storage
) -> None:
    p, m = _providers(provider_factory, model_factory, "MediaImgForVid")
    rec = _Recorder()
    first = _run(db, _request(p, m, "a red boat"), rec.transport())
    assert first[-1]["done"] is True
    conv_id = uuid.UUID(first[0]["conversation_id"])
    prior_attachment = _assistant(db, conv_id).attachments[0]

    pv, mv = _video_providers(provider_factory, model_factory, "MediaVid")
    second = _run(
        db,
        _request(pv, mv, "animate it into a 5 second video", conversation_id=conv_id),
        rec.transport(),
    )
    assert second[-1]["done"] is True

    video_posts = [r for r in rec.requests if r.url.path.endswith("/videos")]
    assert len(video_posts) == 1
    body = video_posts[0].content
    assert b"input_reference" in body  # prior image bytes travel multipart
    assert PNG[:16] in body
    assert b'"5"' in body or b"5" in body  # explicit seconds reach the call

    meta = _assistant(db, conv_id).metadata_
    assert meta["generation_type"] == "video"
    assert meta["reference_attachment_id"] == str(prior_attachment.id)
    assert meta["intent"] == {"seconds_source": "explicit"}
    assert meta["generation_operation"] == "generate"  # video never claims "edit"

    # Prior stills preserved; video is a new attachment on the new message.
    current = _assistant(db, conv_id)
    assert any(a.kind == "video" for a in current.attachments)


def test_video_without_reference_is_text_only_prompt(
    db, provider_factory, model_factory, _storage
) -> None:
    pv, mv = _video_providers(provider_factory, model_factory, "MediaVidFresh")
    rec = _Recorder()
    events = _run(db, _request(pv, mv, "a drone shot of a coastline"), rec.transport())
    assert events[-1]["done"] is True

    video_posts = [r for r in rec.requests if r.url.path.endswith("/videos")]
    assert len(video_posts) == 1
    assert b"input_reference" not in video_posts[0].content
    meta = _assistant(db, uuid.UUID(events[0]["conversation_id"])).metadata_
    assert "reference_attachment_id" not in meta
    assert meta["intent"] == {"seconds_source": "default"}
