"""Unified gateway: route -> stream -> usage/cost -> persist. All adapters behave the same."""

import base64
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal

import httpx
from sqlalchemy.orm import Session

from tollms.api.attachments import service as attachment_service
from tollms.core.exceptions import NotFoundError, ProviderError, ValidationError
from tollms.models.message import Role
from tollms.models.provider import ProviderType
from tollms.api.conversations.service import (
    add_message,
    create_conversation,
    get_conversation,
    list_messages,
    touch,
)
from tollms.api.conversations.schemas import ConversationCreate
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatMessage, ChatResult, MediaPart
from tollms.services.gateway import attachments as attachment_engine
from tollms.services.gateway.costing import CostBreakdown, UsageTokens, calculate, prices_for_model
from tollms.services.gateway.factory import build_adapter
from tollms.api.gateway.schemas import ChatRequest, ChatResponse
from tollms.services.model_repository.lookup import find_for_model
from tollms.api.models.service import get_model
from tollms.api.providers.service import decrypted_credentials, get_provider

logger = logging.getLogger(__name__)


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _resolve(db: Session, provider_id: uuid.UUID, model_id: uuid.UUID, user_id: uuid.UUID | None = None):
    provider = get_provider(db, provider_id, user_id)
    if not provider.is_active:
        raise ValidationError(f"provider {provider_id} is not active")
    model = get_model(db, model_id, user_id)
    if not model.is_active:
        raise ValidationError(f"model {model_id} is not active")
    if model.provider_id != provider.id:
        raise ValidationError("model does not belong to provider")
    return provider, model


def _transcriber(provider, credentials: dict) -> tuple[str, str] | None:
    """(base_url, api_key) for Whisper transcription via the provider's own
    OpenAI-compatible endpoint. None when the provider has no such path."""
    match provider.provider_type:
        case ProviderType.OPENAI_CHAT | ProviderType.OPENAI_RESPONSES:
            key = credentials.get("api_key")
            return ("https://api.openai.com/v1", key) if key else None
        case ProviderType.CUSTOM:
            base = credentials.get("base_url")
            return (base, credentials.get("api_key") or "") if base else None
        case _:
            return None


def _doc_block(filename: str, text: str | None) -> str:
    body = (text or "").strip() or "(no extractable text)"
    return f'[Attached document "{filename}":\n{body}]'


def _media_part(kind: str, row, data: bytes) -> MediaPart:
    return MediaPart(
        kind=kind,
        mime_type=row.mime_type,
        data_b64=base64.b64encode(data).decode(),
        filename=row.filename,
    )


async def _assemble_attachments(
    db: Session,
    *,
    rows,
    model,
    adapter: BaseProviderAdapter,
    transcriber: tuple[str, str] | None,
    transport: httpx.AsyncBaseTransport | None,
    strict: bool,
) -> tuple[list[str], list[MediaPart]]:
    """Attachment rows -> injected text blocks + provider-bound media parts.

    The live user message uses strict=True (unsupported -> 422). History
    rebuilds use strict=False (best-effort: derived text always, media only
    when the current adapter renders it).
    """
    flags = attachment_engine.model_media_flags(model)
    texts: list[str] = []
    media: list[MediaPart] = []
    for row in rows:
        data = attachment_engine.read_bytes(row.storage_path)
        if row.kind == "document":
            if strict and not flags["files"]:
                raise ValidationError(f"model {model.model_id} does not support file attachments")
            texts.append(_doc_block(row.filename, row.extracted_text))
        elif row.kind == "image":
            if flags["vision"] and adapter.supports_vision:
                media.append(_media_part("image", row, data))
            elif strict:
                raise ValidationError(f"model {model.model_id} does not support images")
        elif row.kind == "audio":
            if flags["audio"] and adapter.supports_audio:
                media.append(_media_part("audio", row, data))
            elif strict:
                texts.append(await _transcribe_or_fail(row, data, transcriber, transport))
            elif row.extracted_text:
                texts.append(f'[Attached audio transcript "{row.filename}":\n{row.extracted_text}]')
        elif row.kind == "video":
            if flags["video"] and adapter.supports_video:
                media.append(_media_part("video", row, data))
            elif strict:
                fallback_texts, fallback_media = await _video_fallback(
                    row, data, model, adapter, transcriber, transport
                )
                texts.extend(fallback_texts)
                media.extend(fallback_media)
            elif row.extracted_text:
                texts.append(f'[Attached video transcript "{row.filename}":\n{row.extracted_text}]')
        else:
            raise ValidationError(f"unsupported attachment kind: {row.kind}")
    return texts, media


async def _transcribe_or_fail(row, data: bytes, transcriber: tuple[str, str] | None, transport) -> str:
    if transcriber is None:
        raise ValidationError(
            f"audio is not supported here and transcription is unavailable "
            f"(upload to an OpenAI-compatible provider or use an audio-capable model)"
        )
    base_url, api_key = transcriber
    text = await attachment_engine.transcribe_audio(
        data, row.filename, row.mime_type, base_url=base_url, api_key=api_key or "", transport=transport,
    )
    row.extracted_text = text  # persisted at link time; history reuses it
    return f'[Attached audio transcript "{row.filename}":\n{text}]'


async def _video_fallback(row, data: bytes, model, adapter, transcriber, transport) -> tuple[list[str], list[MediaPart]]:
    """Frames + transcript for video-less providers. Needs ffmpeg and/or a
    transcriber; otherwise a clear 422 (no silent drops)."""
    flags = attachment_engine.model_media_flags(model)
    texts: list[str] = []
    media: list[MediaPart] = []
    frame = attachment_engine.extract_video_frame(data)
    if frame is not None and flags["vision"] and adapter.supports_vision:
        media.append(MediaPart(kind="image", mime_type="image/jpeg",
                               data_b64=base64.b64encode(frame).decode(),
                               filename=f"{row.filename} [frame]"))
    transcript: str | None = None
    if transcriber is not None and (audio := attachment_engine.extract_video_audio(data)) is not None:
        base_url, api_key = transcriber
        try:
            transcript = await attachment_engine.transcribe_audio(
                audio, row.filename, "audio/wav", base_url=base_url, api_key=api_key,
                transport=transport,
            )
        except (ProviderError, ValidationError):
            logger.warning("video audio transcription failed for %s", row.id, exc_info=True)
    if transcript:
        row.extracted_text = transcript  # persisted at link time; history reuses it
        texts.append(f'[Attached video transcript "{row.filename}":\n{transcript}]')
    if not media and not texts:
        raise ValidationError(
            "video is not supported here (no native video, no ffmpeg frame extraction, "
            "no transcription path — use a video-capable model)"
        )
    return texts, media


def _history(
    db: Session,
    conv_id: uuid.UUID | None,
    system: str | None,
    user_id: uuid.UUID | None,
    adapter: BaseProviderAdapter,
    model,
) -> list[ChatMessage]:
    """Persisted messages -> provider-bound messages, re-injecting attachments."""
    messages: list[ChatMessage] = []
    if system:
        messages.append(ChatMessage(role="system", content=system))
    if conv_id is None:
        return messages
    stored = list_messages(db, conv_id, user_id)
    grouped = attachment_service.attachments_for_messages(db, [m.id for m in stored], user_id)
    for m in stored:
        texts, media = _assemble_history(grouped.get(m.id, []), model, adapter)
        content = "\n\n".join([m.content, *texts]) if texts else m.content
        messages.append(ChatMessage(role=m.role.value, content=content, media=media))
    return messages


def _assemble_history(rows, model, adapter: BaseProviderAdapter) -> tuple[list[str], list[MediaPart]]:
    """Best-effort history assembly: derived text always, media only when the
    current adapter renders it. Never raises (a model switch must not 422)."""
    texts: list[str] = []
    media: list[MediaPart] = []
    try:
        flags = attachment_engine.model_media_flags(model)
        for row in rows:
            if row.kind == "document":
                texts.append(_doc_block(row.filename, row.extracted_text))
            elif row.kind == "image":
                if flags["vision"] and adapter.supports_vision:
                    media.append(_media_part("image", row, attachment_engine.read_bytes(row.storage_path)))
            elif row.kind in ("audio", "video") and row.extracted_text:
                texts.append(f'[Attached {row.kind} transcript "{row.filename}":\n{row.extracted_text}]')
    except Exception:
        logger.warning("history attachment assembly failed", exc_info=True)
    return texts, media


def _finalize_usage(
    db: Session, provider, model, history_text: str, result: ChatResult
) -> tuple[UsageTokens, int, CostBreakdown, bool]:
    """Estimate missing tokens, then price via CostCalculationService.

    Repository pricing wins per-field (per-token, scaled); model prices fill gaps.
    Returns (tokens, total_tokens, breakdown, estimated).
    """
    estimated = False
    prompt, completion = result.prompt_tokens, result.completion_tokens
    if not prompt and not completion:
        prompt, completion = _estimate_tokens(history_text), _estimate_tokens(result.text)
        estimated = True
    total = result.total_tokens or (prompt + completion)
    tokens = UsageTokens(
        prompt=prompt,
        completion=completion,
        cache_read=result.cache_read_tokens or 0,
        cache_write=result.cache_write_tokens or 0,
        reasoning=result.reasoning_tokens or 0,
    )
    repo = find_for_model(db, provider.provider_type.value, model.model_id)
    breakdown = calculate(tokens, prices_for_model(model, repo))
    return tokens, total, breakdown, estimated


async def run_chat(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
) -> ChatResponse:
    """Non-streaming chat. Persists user + assistant messages, usage, cost."""
    provider, model = _resolve(db, data.provider_id, data.model_id, user_id)
    start = time.monotonic()
    try:
        credentials = decrypted_credentials(provider)
        adapter = build_adapter(provider, model, credentials, transport)
        transcriber = _transcriber(provider, credentials)
        rows = attachment_service.get_many(db, data.attachment_ids, user_id)
        if data.conversation_id is None:
            title = data.message[:60] or (f"Attachment: {rows[0].filename}"[:60] if rows else "New conversation")
            conv = create_conversation(
                db,
                ConversationCreate(
                    title=title, provider_id=provider.id, model_id=model.id
                ),
                user_id,
            )
            conv_id = conv.id
        else:
            conv = get_conversation(db, data.conversation_id, user_id)
            conv_id = conv.id
        history = _history(db, conv_id, data.system, user_id, adapter, model)
        texts, media = await _assemble_attachments(
            db, rows=rows, model=model, adapter=adapter,
            transcriber=transcriber, transport=transport, strict=True,
        )
        content = "\n\n".join([data.message, *texts]) if (data.message or texts) else ""
        history.append(ChatMessage(role="user", content=content, media=media))
        logger.info(
            "gateway chat: provider=%s model=%s conv=%s attachments=%d media=%d",
            provider.provider_type, model.model_id, conv_id, len(rows), len(media),
        )
        result = await adapter.chat(history)
        latency_ms = (time.monotonic() - start) * 1000
        tokens, total, breakdown, estimated = _finalize_usage(
            db, provider, model, "".join(m.content for m in history), result
        )
        usage = (tokens.prompt, tokens.completion, total)
        cost = breakdown.legacy_triplet()
        extra_usage = (tokens.cache_read, tokens.cache_write, tokens.reasoning)
        extra_cost = (breakdown.cache_read_cost, breakdown.cache_write_cost, breakdown.reasoning_cost)
        user_msg = add_message(db, conv_id, Role.USER, data.message, provider_id=provider.id, model_id=model.id,
                    user_id=user_id)
        for row in rows:
            attachment_service.link_to_message(db, row, conv_id, user_msg.id, commit=False)
        db.commit()
        assistant = add_message(
            db, conv_id, Role.ASSISTANT, result.text,
            provider_id=provider.id, model_id=model.id, usage=usage, cost=cost,
            extra_usage=extra_usage, extra_cost=extra_cost, latency_ms=latency_ms,
            user_id=user_id,
        )
        touch(db, conv)
        logger.info(
            "gateway chat done: conv=%s tokens=%s/%s cost=%s latency=%.0fms",
            conv_id, usage[0], usage[1], cost[2], latency_ms,
        )
        return ChatResponse(
            conversation_id=conv_id, message_id=assistant.id, content=result.text,
            prompt_tokens=usage[0], completion_tokens=usage[1], total_tokens=usage[2],
            cache_read_tokens=tokens.cache_read, cache_write_tokens=tokens.cache_write,
            reasoning_tokens=tokens.reasoning,
            input_cost=cost[0], output_cost=cost[1], total_cost=cost[2],
            cache_read_cost=breakdown.cache_read_cost, cache_write_cost=breakdown.cache_write_cost,
            reasoning_cost=breakdown.reasoning_cost,
            usage_estimated=estimated, latency_ms=latency_ms,
        )
    except (NotFoundError, ValidationError):
        raise
    except Exception as e:
        logger.exception("gateway chat failed")
        raise ProviderError(str(e)) from e


async def run_stream(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
) -> AsyncIterator[str]:
    """SSE stream. Persists messages once the stream completes (or partial text on error)."""
    provider, model = _resolve(db, data.provider_id, data.model_id, user_id)
    start = time.monotonic()
    credentials = decrypted_credentials(provider)
    adapter = build_adapter(provider, model, credentials, transport)
    transcriber = _transcriber(provider, credentials)
    rows = attachment_service.get_many(db, data.attachment_ids, user_id)
    if data.conversation_id is None:
        title = data.message[:60] or (f"Attachment: {rows[0].filename}"[:60] if rows else "New conversation")
        conv = create_conversation(
            db, ConversationCreate(title=title, provider_id=provider.id, model_id=model.id),
            user_id,
        )
        conv_id = conv.id
    else:
        conv = get_conversation(db, data.conversation_id, user_id)
        conv_id = conv.id
    history = _history(db, conv_id, data.system, user_id, adapter, model)
    texts, media = await _assemble_attachments(
        db, rows=rows, model=model, adapter=adapter,
        transcriber=transcriber, transport=transport, strict=True,
    )
    content = "\n\n".join([data.message, *texts]) if (data.message or texts) else ""
    history.append(ChatMessage(role="user", content=content, media=media))
    yield f"data: {json.dumps({'conversation_id': str(conv_id)})}\n\n"
    logger.info(
        "gateway stream: provider=%s model=%s conv=%s attachments=%d media=%d",
        provider.provider_type, model.model_id, conv_id, len(rows), len(media),
    )
    parts: list[str] = []
    result = ChatResult(text="")
    try:
        async for chunk in adapter.chat_stream(history):
            parts.append(chunk.delta)
            if chunk.prompt_tokens is not None:
                result.prompt_tokens = chunk.prompt_tokens
            if chunk.completion_tokens is not None:
                result.completion_tokens = chunk.completion_tokens
            if chunk.total_tokens is not None:
                result.total_tokens = chunk.total_tokens
            if chunk.cache_read_tokens is not None:
                result.cache_read_tokens = chunk.cache_read_tokens
            if chunk.cache_write_tokens is not None:
                result.cache_write_tokens = chunk.cache_write_tokens
            if chunk.reasoning_tokens is not None:
                result.reasoning_tokens = chunk.reasoning_tokens
            if chunk.delta:
                yield f"data: {json.dumps({'delta': chunk.delta})}\n\n"
    except Exception as e:
        logger.exception("gateway stream failed mid-response")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    result.text = "".join(parts)
    latency_ms = (time.monotonic() - start) * 1000
    if result.text:
        tokens, total, breakdown, estimated = _finalize_usage(
            db, provider, model, "".join(m.content for m in history), result
        )
        usage = (tokens.prompt, tokens.completion, total)
        cost = breakdown.legacy_triplet()
        user_msg = add_message(db, conv_id, Role.USER, data.message, provider_id=provider.id, model_id=model.id,
                    user_id=user_id)
        for row in rows:
            attachment_service.link_to_message(db, row, conv_id, user_msg.id, commit=False)
        db.commit()
        assistant = add_message(
            db, conv_id, Role.ASSISTANT, result.text,
            provider_id=provider.id, model_id=model.id, usage=usage, cost=cost,
            extra_usage=(tokens.cache_read, tokens.cache_write, tokens.reasoning),
            extra_cost=(breakdown.cache_read_cost, breakdown.cache_write_cost, breakdown.reasoning_cost),
            latency_ms=latency_ms,
            user_id=user_id,
        )
        touch(db, conv)
        logger.info("gateway stream done: conv=%s tokens=%s/%s cost=%s", conv_id, usage[0], usage[1], cost[2])
        yield f"data: {json.dumps({'done': True, 'message_id': str(assistant.id), 'usage': {'prompt_tokens': usage[0], 'completion_tokens': usage[1], 'total_tokens': usage[2], 'cache_read_tokens': tokens.cache_read, 'cache_write_tokens': tokens.cache_write, 'reasoning_tokens': tokens.reasoning}, 'cost': {'input_cost': str(cost[0]), 'output_cost': str(cost[1]), 'total_cost': str(cost[2]), 'cache_read_cost': str(breakdown.cache_read_cost), 'cache_write_cost': str(breakdown.cache_write_cost), 'reasoning_cost': str(breakdown.reasoning_cost)}, 'usage_estimated': estimated, 'latency_ms': latency_ms})}\n\n"
    else:
        yield f"data: {json.dumps({'done': True, 'empty': True})}\n\n"
