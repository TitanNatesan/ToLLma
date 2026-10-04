"""Unified gateway: route -> stream -> usage/cost -> persist. All adapters behave the same.

Streaming is backend-owned: POST /stream creates the user + assistant rows
(assistant starts RUNNING) and spawns a background generation task. The HTTP
connection only subscribes to progress events — disconnects never stop the
generation, and refresh reattaches to it.
"""

import base64
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import asyncio

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tollms.api.attachments import service as attachment_service
from tollms.core.exceptions import (
    ConflictError,
    NotFoundError,
    ProviderError,
    ValidationError,
    classify_provider_failure,
)
from tollms.models.message import Message, MessageStatus, Role, TERMINAL_STATUSES
from tollms.models.message_history import GenerationRun
from tollms.models.request_log import RequestStatus
from tollms.services import request_logs as request_log_engine
from tollms.models.provider import Provider, ProviderType
from tollms.models.registered_model import AIModel
from tollms.api.conversations.service import (
    active_assistant_message,
    add_message,
    create_conversation,
    find_assistant_by_client_key,
    get_conversation,
    get_message,
    list_messages,
    touch,
)
from tollms.api.conversations.schemas import ConversationCreate
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatMessage, ChatResult, MediaPart
from tollms.services.gateway import attachments as attachment_engine
from tollms.services.gateway import caching as caching_engine
from tollms.services.gateway.costing import CostBreakdown, UsageTokens, calculate, prices_for_model
from tollms.services.gateway.factory import build_adapter
from tollms.services.cost_estimator import (
    CostEstimate,
    actual_image_cost,
    estimate_image_cost,
    estimate_video_cost,
    media_rate_card,
    video_resolution,
)
from tollms.api.gateway.schemas import (
    ActiveGenerationRead,
    ChatRequest,
    ChatResponse,
    GenerationCancelRead,
    GenerationStarted,
)
from tollms.services import generation as generation_engine
from tollms.services.generation import GenerationSpec
from tollms.services.gateway.adapters.base import ChatMessage, StreamChunk
from tollms.services.model_repository.lookup import find_for_model
from tollms.services.observability.events import emit, incr_counter
from tollms.api.models.service import get_model
from tollms.api.providers.service import decrypted_credentials, get_provider, request_revalidation

logger = logging.getLogger(__name__)


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


# Non-chat models still run through the conversation pipeline: the media
# adapter below streams progress as text deltas and stores the result as a
# conversation attachment, so images/videos get persistence, cancellation,
# regeneration and history for free.
MEDIA_ENDPOINTS = ("images/generations", "video/generations")

# Request defaults per media endpoint. Kept beside the adapter so the cost
# estimate and the provider call always describe the same generation.
IMAGE_DEFAULT_OPTIONS: dict = {"size": "1024x1024", "quality": "low"}
VIDEO_DEFAULT_OPTIONS: dict = {"size": "1280x720", "seconds": "4"}


def _is_media_model(model) -> bool:
    return (getattr(model, "primary_endpoint", None) or "") in MEDIA_ENDPOINTS


def media_options(endpoint: str) -> dict:
    """Default request options for a media endpoint (single source of truth)."""
    return dict(IMAGE_DEFAULT_OPTIONS if endpoint == "images/generations" else VIDEO_DEFAULT_OPTIONS)


def media_cost_estimate(db: Session, provider, model, endpoint: str, options: dict) -> CostEstimate:
    """Estimated cost for one media generation, honouring the media rate card."""
    repo = find_for_model(db, provider.provider_type.value, model.model_id)
    card = media_rate_card(model, repo)
    if endpoint == "images/generations":
        return estimate_image_cost(
            model_id=model.model_id,
            quality=options.get("quality"),
            size=options.get("size"),
            count=int(options.get("n", 1) or 1),
            low=card.image_low,
            medium=card.image_medium,
            high=card.image_high,
        )
    return estimate_video_cost(
        model_id=model.model_id,
        seconds=options.get("seconds"),
        size=options.get("size"),
        price_per_second=card.video_per_second,
    )


def caching_for_model(db: Session, provider, model, conversation_id) -> caching_engine.CachingPlan:
    """Provider-aware prompt-cache plan for a freshly built adapter.

    Unsupported models get a disabled plan, so the request body is unchanged.
    """
    if _is_media_model(model):
        return caching_engine.plan(provider.provider_type.value, supported=False)
    repo = find_for_model(db, provider.provider_type.value, model.model_id)
    return caching_engine.plan(
        provider.provider_type.value,
        supported=caching_engine.supports_prompt_caching(model, repo),
        conversation_id=str(conversation_id) if conversation_id else None,
        model_id=model.model_id,
    )


class _MediaGenerationAdapter(BaseProviderAdapter):
    """Chat-adapter facade over a media endpoint (images/videos).

    The generation runner only calls `chat_stream`, so this adapter produces
    the same StreamChunk contract while emitting human-readable progress and
    linking the finished media to the assistant message.
    """

    def __init__(
        self,
        *,
        model,
        adapter: BaseProviderAdapter,
        endpoint: str,
        conversation_id: uuid.UUID,
        message_id: uuid.UUID,
        user_id: uuid.UUID | None,
        prompt: str,
        provider_type: str,
        reference_attachment_id: uuid.UUID | None = None,
        options: dict | None = None,
        cost_estimate: CostEstimate | None = None,
        session_factory=None,
    ) -> None:
        super().__init__(credentials={}, model_id=model.model_id)
        self.model = model
        self.adapter = adapter
        self.media_endpoint = endpoint
        self.provider_type = provider_type
        self.conversation_id = conversation_id
        self.message_id = message_id
        self.user_id = user_id
        self.prompt = prompt
        self.reference_attachment_id = reference_attachment_id
        self.options = options or media_options(endpoint)
        self.cost_estimate = cost_estimate
        if session_factory is None:
            from tollms.db.session import SessionLocal

            session_factory = SessionLocal
        self.session_factory = session_factory
        self.reasoning_level = None
        # Final cost used by the generation runner: actual provider usage when
        # the endpoint reports it, otherwise the rate-card estimate. Stays None
        # until the provider call succeeds, so cancelled/failed runs bill zero.
        self.final_cost: CostEstimate | None = None

    def _actual_cost(self, kind: str) -> CostEstimate | None:
        if kind != "image":
            return None
        usage = getattr(self.adapter, "last_media_usage", None)
        if not isinstance(usage, dict):
            return None
        details = usage.get("input_tokens_details") or {}
        return actual_image_cost(
            model_id=self.model.model_id,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            text_input_tokens=details.get("text_tokens"),
            image_input_tokens=details.get("image_tokens"),
        )

    async def chat_stream(self, messages) -> AsyncIterator[StreamChunk]:
        from tollms.services.gateway.dispatch import call_endpoint

        kind = "image" if self.media_endpoint == "images/generations" else "video"
        options = dict(self.options)
        if kind == "video" and self.reference_attachment_id is not None:
            db = self.session_factory()
            try:
                reference, content = attachment_service.read_content(
                    db, self.reference_attachment_id, self.user_id
                )
            finally:
                db.close()
            options.update(
                image=content,
                image_filename=reference.filename,
                image_mime=reference.mime_type,
            )
        yield StreamChunk(delta=f"Generating {kind}…\n")
        try:
            result = await call_endpoint(self.adapter, self.media_endpoint, prompt=self.prompt, options=options)
        except Exception as exc:
            yield StreamChunk(delta=f"\nGeneration failed: {exc}")
            raise
        yield StreamChunk(delta="Uploading…\n")
        cost = self._actual_cost(kind) or self.cost_estimate
        self.final_cost = cost
        filename = f"{self.model.model_id}-{uuid.uuid4().hex[:8]}.{'png' if kind == 'image' else 'mp4'}"
        db = self.session_factory()
        try:
            attachment = attachment_service.upload_attachment(
                db,
                user_id=self.user_id,
                filename=filename,
                content_type="image/png" if kind == "image" else "video/mp4",
                data=result,
            )
            attachment_service.link_to_message(db, attachment, self.conversation_id, self.message_id)
            metadata: dict = {
                "generation_type": kind,
                "status": "completed",
                "model": self.model.model_id,
                "provider": self.provider_type.lower(),
                "size": options.get("size"),
                "filename": filename,
            }
            if kind == "image":
                metadata["quality"] = options.get("quality")
            else:
                metadata["seconds"] = options.get("seconds")
                metadata["resolution"] = video_resolution(options.get("size"))
            if cost is not None:
                metadata["estimated_cost"] = str(cost.estimated_cost)
                metadata["cost_source"] = cost.source
                metadata["cost_estimated"] = cost.estimated
            db.execute(
                update(Message)
                .where(Message.id == self.message_id)
                .values(metadata_={key: value for key, value in metadata.items() if value is not None})
            )
            db.commit()
        finally:
            db.close()
        yield StreamChunk(delta=f"Generated {kind}: {filename}")


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


def org_attribution(db: Session, provider: Provider, user_id: uuid.UUID | None) -> uuid.UUID | None:
    """Server-derived org for in-app generations on `provider`.

    Returns the provider's org only when it is org-scoped AND the caller
    holds ACTIVE membership there; otherwise None (personal traffic).
    In-app generations never carry an API key.
    """
    from tollms.models.organization import Membership, MembershipState

    org_id = getattr(provider, "org_id", None)
    if org_id is None or user_id is None:
        return None
    active = db.scalar(
        select(Membership.id).where(
            Membership.org_id == org_id,
            Membership.user_id == user_id,
            Membership.is_deleted.is_(False),
            Membership.state == MembershipState.ACTIVE.value,
        )
    )
    return org_id if active is not None else None


def _transcriber(provider, credentials: dict) -> tuple[str, str] | None:
    """(base_url, api_key) for Whisper transcription via the provider's own
    OpenAI-compatible endpoint. None when the provider has no such path."""
    match provider.provider_type:
        case ProviderType.OPENAI:
            base = credentials.get("base_url") or "https://api.openai.com/v1"
            return (base, credentials.get("api_key") or "")
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
    session_id: str | None = None,
) -> ChatResponse:
    """Non-streaming chat. Persists user + assistant messages, usage, cost."""
    provider, model = _resolve(db, data.provider_id, data.model_id, user_id)
    start = time.monotonic()
    started_at = datetime.now(timezone.utc)
    try:
        credentials = decrypted_credentials(provider)
        adapter = build_adapter(provider, model, credentials, transport)
        adapter.reasoning_level = data.reasoning_level
        adapter.max_output_tokens = model.max_output_tokens
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
        adapter.prompt_cache = caching_for_model(db, provider, model, conv_id)
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
                    user_id=user_id, session_id=session_id)
        for row in rows:
            attachment_service.link_to_message(db, row, conv_id, user_msg.id, commit=False)
        db.commit()
        assistant = add_message(
            db, conv_id, Role.ASSISTANT, result.text,
            provider_id=provider.id, model_id=model.id, usage=usage, cost=cost,
            extra_usage=extra_usage, extra_cost=extra_cost, latency_ms=latency_ms,
            status=MessageStatus.COMPLETED, started_at=started_at,
            completed_at=datetime.now(timezone.utc),
            user_id=user_id, session_id=session_id, usage_estimated=estimated,
        )
        db.add(
            GenerationRun(
                message_id=assistant.id,
                user_id=user_id,
                generation_number=1,
                provider_id=provider.id,
                model_id=model.id,
                content=result.text,
                status=MessageStatus.COMPLETED.value,
                is_active=True,
                prompt_tokens=tokens.prompt,
                completion_tokens=tokens.completion,
                total_tokens=tokens.prompt + tokens.completion,
                total_cost=cost[2],
                latency_ms=latency_ms,
            )
        )
        touch(db, conv)
        request_log_engine.record(
            db,
            request_log_engine.RequestLogEntry(
                user_id=user_id,
                conversation_id=conv_id,
                message_id=assistant.id,
                provider_id=provider.id,
                model_id=model.id,
                request_started_at=started_at,
                request_completed_at=datetime.now(timezone.utc),
                latency_ms=latency_ms,
                prompt_tokens=tokens.prompt,
                completion_tokens=tokens.completion,
                total_tokens=tokens.prompt + tokens.completion,
                input_cost=cost[0],
                output_cost=cost[1],
                total_cost=cost[2],
                status=RequestStatus.SUCCESS,
                is_streaming=False,
            ),
        )
        db.commit()
        logger.info(
            "gateway chat done: conv=%s tokens=%s/%s cost=%s latency=%.0fms",
            conv_id, usage[0], usage[1], cost[2], latency_ms,
        )
        incr_counter("gateway.request", {"plane": "ui", "status": "success"})
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
        incr_counter("gateway.request", {"plane": "ui", "status": "failed"})
        classified = classify_provider_failure(e)
        emit(
            "gateway.provider_error",
            code=classified.code.value,
            endpoint="chat",
            plane="ui",
        )
        incr_counter("gateway.provider_error", {"code": classified.code.value})
        # Failure-triggered revalidation: only INVALID_CREDENTIALS / TIMEOUT /
        # MODEL_UNAVAILABLE actually probe (throttled per provider). Never raises.
        try:
            await request_revalidation(db, provider.id, classified.code)
        except Exception:
            logger.warning("provider revalidation failed", exc_info=True)
        raise classified from e


@dataclass
class _Setup:
    """Validated setup: rows not yet created, provider call not yet made."""

    conv_id: uuid.UUID
    provider: Provider
    model: AIModel
    adapter: BaseProviderAdapter
    rows: list
    history: list[ChatMessage]
    history_text: str
    media_endpoint: str | None = None
    media_options: dict | None = None
    media_cost: CostEstimate | None = None


async def _setup_generation(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None,
    user_id: uuid.UUID | None,
) -> _Setup:
    """Resolve, create conv if needed, assemble history + attachments.

    Raises 404/422 before any row exists. Row creation happens in
    start_generation under the conversation lock (409 on active generation).
    """
    provider, model = _resolve(db, data.provider_id, data.model_id, user_id)
    credentials = decrypted_credentials(provider)
    adapter = build_adapter(provider, model, credentials, transport)
    adapter.reasoning_level = data.reasoning_level
    adapter.max_output_tokens = model.max_output_tokens
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
    # Prompt caching is planned once the conversation id is known (OpenAI uses
    # it as the cache key). Disabled plans leave the request body untouched.
    adapter.prompt_cache = caching_for_model(db, provider, model, conv_id)
    media_endpoint = model.primary_endpoint if _is_media_model(model) else None
    media_opts: dict | None = None
    media_cost: CostEstimate | None = None
    if media_endpoint:
        # Media models take the prompt directly; long text history and document
        # text injection do not apply. Uploaded rows stay available as reference.
        history = [ChatMessage(role="user", content=data.message)]
        texts, media = [], []
        media_opts = media_options(media_endpoint)
        media_cost = media_cost_estimate(db, provider, model, media_endpoint, media_opts)
        logger.info(
            "gateway stream: media model %s endpoint=%s cost=%s",
            model.model_id, media_endpoint, media_cost.estimated_cost,
        )
    else:
        texts, media = await _assemble_attachments(
            db, rows=rows, model=model, adapter=adapter,
            transcriber=transcriber, transport=transport, strict=True,
        )
        content = "\n\n".join([data.message, *texts]) if (data.message or texts) else ""
        history.append(ChatMessage(role="user", content=content, media=media))
        logger.info(
            "gateway stream: provider=%s model=%s conv=%s attachments=%d media=%d cache=%s",
            provider.provider_type, model.model_id, conv_id, len(rows), len(media),
            adapter.prompt_cache.strategy if adapter.prompt_cache else "none",
        )
    return _Setup(
        conv_id=conv_id, provider=provider, model=model, adapter=adapter,
        rows=rows, history=history, history_text="".join(m.content for m in history),
        media_endpoint=media_endpoint, media_options=media_opts, media_cost=media_cost,
    )


async def start_generation(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
    session_factory=None,
    session_id: str | None = None,
) -> GenerationStarted:
    """Synchronous setup + background spawn. The assistant row exists as
    RUNNING before this returns — the frontend never invents messages.

    Same client_key retries adopt the existing generation (terminal rows
    return as-is; no new rows, no new task). Concurrent same-conversation
    starts 409.
    """
    setup_start = time.monotonic()
    if data.client_key:
        existing = find_assistant_by_client_key(db, user_id, data.client_key)
        if existing is not None:
            db.refresh(existing)
            logger.info(
                "generation adopted by client_key: %s status=%s", existing.id, existing.status.value,
            )
            return GenerationStarted(
                conversation_id=existing.conversation_id,
                generation_id=existing.id,
                message_id=existing.id,
                status=existing.status.value,
            )
    setup = await _setup_generation(db, data, transport, user_id)
    provider, model = setup.provider, setup.model
    conv_id = setup.conv_id
    started_at = datetime.now(timezone.utc)
    try:
        async with generation_engine.manager.conv_lock(conv_id):
            if generation_engine.manager.is_active(conv_id) is not None:
                raise ConflictError(f"conversation {conv_id} already has an active generation")
            if active_assistant_message(db, conv_id, user_id) is not None:
                raise ConflictError(f"conversation {conv_id} already has an active generation")
            user_msg = add_message(
                db, conv_id, Role.USER, data.message,
                provider_id=provider.id, model_id=model.id, user_id=user_id,
                session_id=session_id,
            )
            for row in setup.rows:
                attachment_service.link_to_message(db, row, conv_id, user_msg.id, commit=False)
            assistant = add_message(
                db, conv_id, Role.ASSISTANT, "",
                provider_id=provider.id, model_id=model.id,
                status=MessageStatus.RUNNING, started_at=started_at,
                user_id=user_id, session_id=session_id,
            )
            run = GenerationRun(
                message_id=assistant.id,
                user_id=user_id,
                generation_number=1,
                provider_id=provider.id,
                model_id=model.id,
                content="",
                status=MessageStatus.RUNNING.value,
                is_active=False,
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            if data.client_key:
                assistant.client_key = data.client_key
                db.commit()
                db.refresh(assistant)
            conversation_row = get_conversation(db, conv_id, user_id)
            # Eagerly created (route-first) conversations arrive without a model;
            # stamp the first used provider/model so settings/analytics stay accurate.
            if conversation_row.provider_id is None:
                conversation_row.provider_id = provider.id
            if conversation_row.model_id is None:
                conversation_row.model_id = model.id
            touch(db, conversation_row)
    except IntegrityError:
        # Lost a same-key/in-flight race: adopt the winner, never duplicate.
        db.rollback()
        if data.client_key:
            winner = find_assistant_by_client_key(db, user_id, data.client_key)
            if winner is not None:
                logger.info("generation race adopted by client_key: %s", winner.id)
                return GenerationStarted(
                    conversation_id=winner.conversation_id,
                    generation_id=winner.id,
                    message_id=winner.id,
                    status=winner.status.value,
                )
        if active_assistant_message(db, conv_id, user_id) is not None:
            raise ConflictError(f"conversation {conv_id} already has an active generation")
        raise
    spec = GenerationSpec(
        generation_id=assistant.id,
        conversation_id=conv_id,
        user_id=user_id,
        adapter=setup.adapter,
        history=setup.history,
        history_text=setup.history_text,
        provider_type=provider.provider_type.value,
        model_label=model.model_id,
        input_price=str(model.input_price),
        output_price=str(model.output_price),
        cache_read_price=str(model.cache_read_price),
        cache_write_price=str(model.cache_write_price),
        session_id=session_id,
        provider_id=provider.id,
        model_id=model.id,
        org_id=org_attribution(db, provider, user_id),
        run_id=run.id,
    )
    if setup.media_endpoint:
        # Same pipeline, media driver: progress deltas + attachment persistence.
        spec.adapter = _MediaGenerationAdapter(
            model=model,
            adapter=setup.adapter,
            endpoint=setup.media_endpoint,
            conversation_id=conv_id,
            message_id=assistant.id,
            user_id=user_id,
            prompt=data.message,
            provider_type=provider.provider_type.value,
            reference_attachment_id=setup.rows[0].id if setup.rows else None,
            options=setup.media_options,
            cost_estimate=setup.media_cost,
            session_factory=session_factory or generation_engine.manager.session_factory(),
        )
        # Rate-card estimate is the runner's fallback; the adapter upgrades it
        # to actual provider usage when the endpoint reports usage.
        spec.media_cost = setup.media_cost.estimated_cost if setup.media_cost else None
        spec.media_cost_source = setup.media_cost.source if setup.media_cost else None
    generation_engine.manager.spawn(spec, session_factory=session_factory)
    logger.info(
        "generation started: %s conv=%s setup=%.0fms",
        assistant.id, conv_id, (time.monotonic() - setup_start) * 1000,
    )
    return GenerationStarted(
        conversation_id=conv_id, generation_id=assistant.id, message_id=assistant.id,
    )


async def _drain_to_sse(
    db: Session,
    generation_id: uuid.UUID,
    user_id: uuid.UUID | None,
    is_disconnected: Callable[[], Awaitable[bool]],
    snapshot: bool,
) -> AsyncIterator[str]:
    """Shared SSE body: meta (+snapshot) then live deltas until terminal.

    Disconnect only unsubscribes — the background generation keeps running.
    """
    msg = get_message(db, generation_id, user_id)
    db.refresh(msg)  # DB is truth; never trust a reused session's cache
    if msg.role != Role.ASSISTANT:
        raise NotFoundError(f"generation {generation_id} not found")
    if msg.status in TERMINAL_STATUSES:
        yield f"data: {json.dumps({'conversation_id': str(msg.conversation_id), 'generation_id': str(msg.id), 'message_id': str(msg.id), 'status': msg.status.value})}\n\n"
        if snapshot:
            yield f"data: {json.dumps({'content': msg.content, 'status': msg.status.value})}\n\n"
        yield f"data: {json.dumps(_terminal_from_row(msg))}\n\n"
        return
    # Subscribe + snapshot with no await between: the snapshot covers exactly
    # the deltas emitted before subscription — gapless by construction.
    queue = generation_engine.manager.subscribe(msg.id)
    buffered = generation_engine.manager.current_buffer(msg.id)
    if queue is None or buffered is None:
        # Task gone but row still running (crash between sweep and read):
        # fail it now so the client sees a terminal state, never a hang.
        generation_engine.sweep_stale_running(db, reason="generation process lost")
        db.refresh(msg)
        yield f"data: {json.dumps({'conversation_id': str(msg.conversation_id), 'generation_id': str(msg.id), 'message_id': str(msg.id), 'status': msg.status.value})}\n\n"
        if snapshot:
            yield f"data: {json.dumps({'content': msg.content, 'status': msg.status.value})}\n\n"
        yield f"data: {json.dumps(_terminal_from_row(msg))}\n\n"
        return
    yield f"data: {json.dumps({'conversation_id': str(msg.conversation_id), 'generation_id': str(msg.id), 'message_id': str(msg.id), 'status': msg.status.value})}\n\n"
    if snapshot:
        yield f"data: {json.dumps({'content': buffered, 'status': msg.status.value})}\n\n"
    try:
        while True:
            if await is_disconnected():
                return
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if kind == "delta":
                yield f"data: {json.dumps({'delta': payload})}\n\n"
            elif kind == "terminal":
                yield f"data: {json.dumps(payload)}\n\n"
                return
    finally:
        generation_engine.manager.unsubscribe(msg.id, queue)


def _terminal_from_row(msg) -> dict:
    return {
        "done": True,
        "generation_id": str(msg.id),
        "message_id": str(msg.id),
        "status": msg.status.value,
        "content": msg.content,
        **({"error": msg.error} if msg.error else {}),
    }


async def stream_events(
    db: Session,
    generation_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[str]:
    """Live SSE for the request that started the generation (no snapshot)."""
    async for raw in _drain_to_sse(db, generation_id, user_id, is_disconnected or _never_disconnected, snapshot=False):
        yield raw


async def reattach_events(
    db: Session,
    generation_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    is_disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[str]:
    """Recovery SSE: current partial content first, then live deltas."""
    async for raw in _drain_to_sse(db, generation_id, user_id, is_disconnected or _never_disconnected, snapshot=True):
        yield raw


async def _never_disconnected() -> bool:
    return False


async def cancel_generation(
    db: Session,
    generation_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
) -> GenerationCancelRead:
    """User stop: signal the driver, persist partial text, end CANCELLED.

    Idempotent — cancelling a terminal generation returns its status.
    """
    msg = get_message(db, generation_id, user_id)
    db.refresh(msg)  # DB is truth; never trust a reused session's cache
    if msg.role != Role.ASSISTANT:
        raise NotFoundError(f"generation {generation_id} not found")
    if msg.status in TERMINAL_STATUSES:
        return GenerationCancelRead(
            generation_id=msg.id, message_id=msg.id, status=msg.status.value,
        )
    active = generation_engine.manager.get(msg.id)
    if active is not None:
        active.cancel_event.set()
    await generation_engine.manager.request_cancel_flag(msg.id)
    logger.info("generation cancel requested: %s", msg.id)
    return GenerationCancelRead(generation_id=msg.id, message_id=msg.id, status=MessageStatus.CANCELLED.value)


def active_generation(    db: Session,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
) -> ActiveGenerationRead:
    """Recovery lookup. 404 when nothing is running (frontend: refresh-from-DB)."""
    get_conversation(db, conversation_id, user_id)
    gen_id = generation_engine.manager.is_active(conversation_id)
    if gen_id is None:
        row = active_assistant_message(db, conversation_id, user_id)
        if row is None:
            raise NotFoundError(f"conversation {conversation_id} has no active generation")
        gen_id = row.id
    msg = get_message(db, gen_id, user_id)
    db.refresh(msg)  # DB is truth; never trust a reused session's cache
    if msg.status in TERMINAL_STATUSES:
        raise NotFoundError(f"conversation {conversation_id} has no active generation")
    return ActiveGenerationRead(
        generation_id=msg.id,
        message_id=msg.id,
        conversation_id=msg.conversation_id,
        status=msg.status.value,
        current_content=msg.content,
        started_at=msg.started_at,
    )


def generation_status(
    db: Session,
    generation_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
) -> ActiveGenerationRead:
    """Single-generation lookup (running or terminal), ownership-checked."""
    msg = get_message(db, generation_id, user_id)
    db.refresh(msg)  # DB is truth; never trust a reused session's cache
    if msg.role != Role.ASSISTANT:
        raise NotFoundError(f"generation {generation_id} not found")
    return ActiveGenerationRead(
        generation_id=msg.id,
        message_id=msg.id,
        conversation_id=msg.conversation_id,
        status=msg.status.value,
        current_content=msg.content,
        started_at=msg.started_at,
    )


def generation_by_client_key(
    db: Session,
    client_key: str,
    user_id: uuid.UUID | None = None,
) -> ActiveGenerationRead:
    """Idempotency recovery: the generation a client_key send created (404 if
    unknown). Lets a tab that lost its response adopt instead of duplicating."""
    msg = find_assistant_by_client_key(db, user_id, client_key)
    if msg is None:
        raise NotFoundError(f"generation with client key {client_key} not found")
    return ActiveGenerationRead(
        generation_id=msg.id,
        message_id=msg.id,
        conversation_id=msg.conversation_id,
        status=msg.status.value,
        current_content=msg.content,
        started_at=msg.started_at,
    )


async def run_stream(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
    session_factory=None,
) -> AsyncIterator[str]:
    """Start + stream to completion. Kept for non-HTTP drivers (tests, CLI)."""
    started = await start_generation(db, data, transport, user_id, session_factory)
    async for raw in stream_events(db, started.generation_id, user_id):
        yield raw


def _history_until(
    db: Session,
    conv_id: uuid.UUID,
    cutoff,
    user_id: uuid.UUID | None,
    adapter: BaseProviderAdapter,
    model,
) -> list[ChatMessage]:
    """History up to (and including) a specific user message.

    Regeneration must not feed the previous answer back to the model, so this
    slices at the prompt that produced the assistant message being replaced.
    """
    stored = [m for m in list_messages(db, conv_id, user_id) if m.created_at <= cutoff.created_at]
    grouped = attachment_service.attachments_for_messages(db, [m.id for m in stored], user_id)
    messages: list[ChatMessage] = []
    for m in stored:
        texts, media = _assemble_history(grouped.get(m.id, []), model, adapter)
        content = "\n\n".join([m.content, *texts]) if texts else m.content
        messages.append(ChatMessage(role=m.role.value, content=content, media=media))
    return messages


def _reset_assistant_for_regeneration(assistant: Message, started_at: datetime) -> None:
    """Clear a terminal assistant row so the driver can stream a new run into it."""
    assistant.content = ""
    assistant.status = MessageStatus.RUNNING
    assistant.started_at = started_at
    assistant.completed_at = None
    assistant.error = None
    assistant.error_code = None
    assistant.usage_estimated = False
    assistant.ttfb_ms = None
    assistant.thinking_ms = None
    assistant.latency_ms = None
    assistant.prompt_tokens = None
    assistant.completion_tokens = None
    assistant.total_tokens = None
    assistant.cache_read_tokens = None
    assistant.cache_write_tokens = None
    assistant.reasoning_tokens = None
    assistant.input_cost = None
    assistant.output_cost = None
    assistant.total_cost = None
    assistant.cache_read_cost = None
    assistant.cache_write_cost = None
    assistant.reasoning_cost = None


async def start_regeneration(
    db: Session,
    message_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    reasoning_level: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    session_factory=None,
    session_id: str | None = None,
) -> GenerationStarted:
    """Regenerate an assistant message in place, preserving every prior run.

    The message row always mirrors the active generation; `generation_runs`
    keeps the full history for ◀ 1 of N ▶ navigation.
    """
    assistant = get_message(db, message_id, user_id)
    if assistant.role != Role.ASSISTANT:
        raise ValidationError("only assistant messages can be regenerated")
    if assistant.status not in TERMINAL_STATUSES:
        raise ConflictError("message is still generating")

    conv_id = assistant.conversation_id
    preceding = db.execute(
        select(Message)
        .where(
            Message.conversation_id == conv_id,
            Message.role == Role.USER,
            Message.created_at <= assistant.created_at,
            Message.id != assistant.id,
            Message.is_deleted.is_(False),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if preceding is None:
        raise ValidationError("no user message to regenerate from")

    target_provider_id = provider_id or assistant.provider_id
    target_model_id = model_id or assistant.model_id
    if target_provider_id is None or target_model_id is None:
        raise ValidationError("message has no model to regenerate with")
    provider, model = _resolve(db, target_provider_id, target_model_id, user_id)
    credentials = decrypted_credentials(provider)
    adapter = build_adapter(provider, model, credentials, transport)
    adapter.reasoning_level = reasoning_level
    adapter.max_output_tokens = model.max_output_tokens
    history = _history_until(db, conv_id, preceding, user_id, adapter, model)
    adapter.prompt_cache = caching_for_model(db, provider, model, conv_id)
    if not history:
        raise ValidationError("no conversation history to regenerate from")

    started_at = datetime.now(timezone.utc)
    async with generation_engine.manager.conv_lock(conv_id):
        if generation_engine.manager.is_active(conv_id) is not None:
            raise ConflictError(f"conversation {conv_id} already has an active generation")
        if active_assistant_message(db, conv_id, user_id) is not None:
            raise ConflictError(f"conversation {conv_id} already has an active generation")
        last_number = db.execute(
            select(func.max(GenerationRun.generation_number)).where(
                GenerationRun.message_id == assistant.id
            )
        ).scalar_one()
        db.execute(
            update(GenerationRun)
            .where(GenerationRun.message_id == assistant.id)
            .values(is_active=False)
        )
        run = GenerationRun(
            message_id=assistant.id,
            user_id=user_id,
            generation_number=int(last_number or 0) + 1,
            provider_id=provider.id,
            model_id=model.id,
            content="",
            status=MessageStatus.RUNNING.value,
            is_active=False,
        )
        db.add(run)
        _reset_assistant_for_regeneration(assistant, started_at)
        db.commit()
        db.refresh(assistant)
        db.refresh(run)

    spec = GenerationSpec(
        generation_id=assistant.id,
        conversation_id=conv_id,
        user_id=user_id,
        adapter=adapter,
        history=history,
        history_text="".join(m.content for m in history),
        provider_type=provider.provider_type.value,
        model_label=model.model_id,
        input_price=str(model.input_price),
        output_price=str(model.output_price),
        cache_read_price=str(model.cache_read_price),
        cache_write_price=str(model.cache_write_price),
        session_id=session_id,
        run_id=run.id,
        is_regeneration=True,
        provider_id=provider.id,
        model_id=model.id,
        org_id=org_attribution(db, provider, user_id),
    )
    if _is_media_model(model):
        # Retry/regenerate reuses the preceding user prompt, no duplicate rows.
        regen_endpoint = model.primary_endpoint
        regen_options = media_options(regen_endpoint)
        regen_cost = media_cost_estimate(db, provider, model, regen_endpoint, regen_options)
        spec.adapter = _MediaGenerationAdapter(
            model=model,
            adapter=adapter,
            endpoint=regen_endpoint,
            conversation_id=conv_id,
            message_id=assistant.id,
            user_id=user_id,
            prompt=preceding.content,
            provider_type=provider.provider_type.value,
            options=regen_options,
            cost_estimate=regen_cost,
            session_factory=session_factory or generation_engine.manager.session_factory(),
        )
        spec.media_cost = regen_cost.estimated_cost
        spec.media_cost_source = regen_cost.source
    generation_engine.manager.spawn(spec, session_factory=session_factory)
    logger.info(
        "regeneration started: message=%s run=%s number=%s model=%s",
        assistant.id, run.id, run.generation_number, model.model_id,
    )
    return GenerationStarted(conversation_id=conv_id, generation_id=assistant.id, message_id=assistant.id)
