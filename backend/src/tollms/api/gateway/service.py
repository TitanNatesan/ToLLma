"""Unified gateway: route -> stream -> usage/cost -> persist. All adapters behave the same.

Streaming is backend-owned: POST /stream creates the user + assistant rows
(assistant starts RUNNING) and spawns a background generation task. The HTTP
connection only subscribes to progress events — disconnects never stop the
generation, and refresh reattaches to it.
"""

import base64
import json
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, replace
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
    ForbiddenError,
    NotFoundError,
    ProviderError,
    TooManyRequestsError,
    ValidationError,
    classify_provider_failure,
)
from tollms.models.api_key import ApiKey
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
from tollms.api.attachments.schemas import AttachmentRead
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
    ChatKeyRead,
    ChatRequest,
    ChatResponse,
    GenerationCancelRead,
    GenerationStarted,
)
from tollms.api.models.schemas import ModelRead, read_model
from tollms.services import generation as generation_engine
from tollms.services.api_keys import keys as key_engine
from tollms.services.gateway import key_policy
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

# Upper bound for parsed image counts ("99 variations" clamps here).
IMAGE_MAX_COUNT = 10

# Provider families whose image adapter speaks /images/edits.
_EDIT_CAPABLE_TYPES = frozenset({ProviderType.OPENAI, ProviderType.CUSTOM})

# Provider families whose chat wire shape accepts thinkingConfig. The adapter
# still skips it when image_output is set (image models reject it); models
# without supports_reasoning stay off entirely (they 400 on the field).
_THINKING_CONFIG_TYPES = frozenset({ProviderType.GEMINI, ProviderType.VERTEX_AI})

_COUNT_RE = re.compile(r"(\d{1,2})\s*(?:variations?|versions?|images?|pictures?|copies|options?)\b")


def _parse_image_intent(text: str) -> tuple[int, str]:
    """(count, count_source) from free-form prompt text.

    No LLM call: "<n> variations"-style phrases fix the output count (the
    generation loop runs once per image; no `n` param is sent). Size, aspect,
    quality and all other technical properties stay in the prompt prose for
    the model to interpret — the backend never invents them.
    """
    lowered = (text or "").lower()
    count, count_source = 1, "default"
    match = _COUNT_RE.search(lowered)
    if match:
        count = max(1, min(int(match.group(1)), IMAGE_MAX_COUNT))
        count_source = "explicit"
    return count, count_source


def _parse_video_intent(text: str) -> tuple[str, str]:
    """(seconds, seconds_source) from free-form prompt text.

    No LLM call: an explicit "<n> second(s)" wins, clamped to a sane range;
    otherwise the model default applies. Unknown prose is left untouched.
    """
    lowered = (text or "").lower()
    seconds, seconds_source = VIDEO_DEFAULT_OPTIONS["seconds"], "default"
    match = re.search(r"(\d{1,2})\s*-?\s*seconds?", lowered)
    if match:
        seconds = str(max(1, min(int(match.group(1)), 60)))
        seconds_source = "explicit"
    return seconds, seconds_source


def _resolve_image_reference(messages, grouped, user_id, conv_id):
    """Most recent prior assistant-message image attachment in this conversation.

    Returns (row, reference_message_id, prior_prompt_excerpt) or None.
    Rows failing ownership (wrong user / wrong conversation) are skipped, never
    raised: a forged reference falls back to plain generation, never a 500.
    """
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if getattr(message.role, "value", message.role) != Role.ASSISTANT.value:
            continue
        candidates = [
            row
            for row in grouped.get(message.id, [])
            if row.kind == "image"
            and (user_id is None or row.user_id == user_id)
            and row.conversation_id == conv_id
        ]
        if not candidates:
            continue
        prior_prompt = next(
            (
                messages[j].content
                for j in range(index - 1, -1, -1)
                if getattr(messages[j].role, "value", messages[j].role) == Role.USER.value
            ),
            "",
        )
        return candidates[-1], message.id, (prior_prompt or "")[:120]
    return None


def _select_media_operation(*, supports_edit: bool, has_reference: bool, prior_excerpt: str, prompt: str):
    """(operation, final_prompt, note) for an image turn.

    Edit only when a reference exists AND the provider speaks /images/edits;
    otherwise generate, augmenting with the prior subject line when one exists.
    """
    if has_reference and supports_edit:
        return "edit", prompt, None
    if has_reference and prior_excerpt:
        return "generate", f"Same subject as: {prior_excerpt}. {prompt}", "edit_unsupported"
    if has_reference:
        return "generate", prompt, "edit_unsupported"
    return "generate", prompt, None


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
        reference_bytes: bytes | None = None,
        operation: str = "generate",
        count: int = 1,
        lineage: dict | None = None,
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
        self.reference_bytes = reference_bytes
        self.operation = operation
        self.count = max(1, int(count or 1))
        self.lineage = dict(lineage or {})
        self.options = options if options is not None else media_options(endpoint)
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
        cost = actual_image_cost(
            model_id=self.model.model_id,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            text_input_tokens=details.get("text_tokens"),
            image_input_tokens=details.get("image_tokens"),
        )
        # Count loops as sequential one-image calls: usage covers one call.
        if cost is not None and self.count > 1:
            cost = replace(
                cost,
                estimated_cost=cost.estimated_cost * self.count,
                basis={**cost.basis, "count": self.count},
            )
        return cost

    async def chat_stream(self, messages) -> AsyncIterator[StreamChunk]:
        from tollms.services.gateway.dispatch import call_endpoint

        kind = "image" if self.media_endpoint == "images/generations" else "video"
        options = dict(self.options)
        endpoint = self.media_endpoint
        if kind == "image":
            # The endpoint records what actually happened: edits only when the
            # reference bytes made it here, otherwise plain generations.
            if self.operation == "edit" and self.reference_bytes is not None:
                endpoint = "images/edits"
                options["image_bytes"] = self.reference_bytes
        elif self.reference_attachment_id is not None:
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
        operation = "edit" if endpoint == "images/edits" else "generate"
        logger.info(
            "media generation: kind=%s operation=%s size=%s count=%d ref=%s",
            kind, operation, options.get("size"), self.count, self.reference_attachment_id,
        )
        yield StreamChunk(delta=f"Generating {kind}…\n")
        try:
            payloads = []
            for index in range(self.count):
                # Per-image progress so the UI can show one preview with a
                # "×N" badge instead of N stacked loaders. Only emitted for
                # multi-image runs; single generations keep the plain label.
                if kind == "image" and self.count > 1:
                    yield StreamChunk(delta=f"Generating image ({index + 1} of {self.count})…\n")
                payloads.append(
                    await call_endpoint(self.adapter, endpoint, prompt=self.prompt, options=options)
                )
        except Exception as exc:
            yield StreamChunk(delta=f"\nGeneration failed: {exc}")
            raise
        yield StreamChunk(delta="Uploading…\n")
        cost = self._actual_cost(kind) or self.cost_estimate
        self.final_cost = cost
        db = self.session_factory()
        try:
            filenames: list[str] = []
            for payload in payloads:
                filename = f"{self.model.model_id}-{uuid.uuid4().hex[:8]}.{'png' if kind == 'image' else 'mp4'}"
                attachment = attachment_service.upload_attachment(
                    db,
                    user_id=self.user_id,
                    filename=filename,
                    content_type="image/png" if kind == "image" else "video/mp4",
                    data=payload,
                )
                attachment_service.link_to_message(db, attachment, self.conversation_id, self.message_id)
                filenames.append(filename)
            metadata: dict = {
                "generation_type": kind,
                "generation_operation": operation,
                "status": "completed",
                "model": self.model.model_id,
                "provider": self.provider_type.lower(),
                "size": options.get("size"),
                "filename": filenames[0],
                **self.lineage,
            }
            if len(filenames) > 1:
                metadata["filenames"] = filenames
                metadata["count"] = len(filenames)
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
        for filename in filenames:
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
    Orthogonal to `api_key_id`: keyed session-chat rows carry both.
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


def _require_chat_key(db: Session, key_id: uuid.UUID | None, user_id: uuid.UUID | None) -> ApiKey | None:
    """Session-user key gate for in-app generations.

    Returns None for the legacy unscoped path (``key_id`` None + ``user_id``
    None: internal/service/test callers only — mirrors the ``user_id=None``
    unscoped convention in providers/models/conversations services).

    A session user without ``key_id`` gets 422 KEY_REQUIRED. Every other
    denial (unknown, wrong owner, cross-org, disabled, expired,
    soft-deleted, tombstoned, lapsed assignee membership) is a 404 oracle —
    same convention as ``get_provider`` — so key existence never leaks.
    """
    if key_id is None:
        if user_id is None:
            return None
        raise ValidationError(
            "KEY_REQUIRED: An API key is required to use chat. "
            "Select a key or create one first."
        )
    key = db.get(ApiKey, key_id)
    if key is None or key.is_deleted:
        raise NotFoundError("api key not found")
    if user_id is None or key.user_id != user_id:
        raise NotFoundError("api key not found")
    if key.org_id is not None:
        from tollms.models.organization import Membership, MembershipState

        active = db.scalar(
            select(Membership.id).where(
                Membership.org_id == key.org_id,
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        )
        if active is None:
            # Assigned key, but the assignee lost ACTIVE membership (also
            # covers org keys revoked via remove/suspend/leave).
            raise NotFoundError("api key not found")
    if not key.enabled:
        raise NotFoundError("api key not found")
    if _key_expired(key, datetime.now(timezone.utc)):
        raise NotFoundError("api key not found")
    if key_engine.is_tombstoned(key.key_hash):
        raise NotFoundError("api key not found")
    return key


def _key_expired(key: ApiKey, now: datetime) -> bool:
    """Expired via the key or its policy (mirrors _require_chat_key)."""
    moments = [key.expires_at]
    if key.policy is not None:
        moments.append(key.policy.expires_at)
    for moment in moments:
        if moment is None:
            continue
        m = moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)
        if m <= now:
            return True
    return False


def _eligible_models(db: Session, key: ApiKey, user_id: uuid.UUID | None) -> list[AIModel]:
    """Models servable under `key`: allow-list ∩ provider live+active ∩
    model live+active. No permission ROWS at all means all live models in
    scope (documented intent: unrestricted); rows existing but ALL disabled
    means ZERO eligible models (deny-all). Scope is the caller's personal
    providers (personal key) or the key's org providers (org key).

    Provider delete/deactivate and model delete/disable need no allow-list
    cleanup: they fall out of eligibility here automatically. Rows for
    unavailable providers are retained but inert (documented limitation:
    provider deactivation has no row-pruning hook by design).
    """
    if key.org_id is None:
        scope = select(Provider).where(
            Provider.org_id.is_(None),
            Provider.user_id == key.user_id,
            Provider.is_deleted.is_(False),
            Provider.is_active.is_(True),
        )
    else:
        scope = select(Provider).where(
            Provider.org_id == key.org_id,
            Provider.is_deleted.is_(False),
            Provider.is_active.is_(True),
        )
    providers = {p.id for p in db.scalars(scope)}
    if not providers:
        return []
    models = list(
        db.scalars(
            select(AIModel)
            .where(
                AIModel.provider_id.in_(list(providers)),
                AIModel.is_deleted.is_(False),
                AIModel.is_active.is_(True),
            )
            .order_by(AIModel.created_at)
        )
    )
    if not key.model_permissions:
        return models
    perms = [perm for perm in key.model_permissions if perm.enabled]
    if not perms:
        return []
    return [
        m
        for m in models
        if any(
            (perm.provider_id is None or perm.provider_id == m.provider_id)
            and (perm.model_id is None or perm.model_id == m.id)
            for perm in perms
        )
    ]


def validate_key_for_model(
    db: Session, key_id: uuid.UUID | None, user_id: uuid.UUID | None, model_id: uuid.UUID
) -> ApiKey | None:
    """Key + allow-list gate for one model, validated BEFORE a mutating step
    commits (message edits that will auto-regenerate). Same gate as chat
    send: 422 when a session user omits the key, 404 oracle on bad keys,
    403 when the model sits outside the key's allow-list."""
    key = _require_chat_key(db, key_id, user_id)
    _enforce_key_model(db, key, model_id)
    return key


def _enforce_key_model(db: Session, key: ApiKey | None, model_id: uuid.UUID) -> None:
    """Requested model must be in the key's eligible set, else 403."""
    if key is None:
        return
    if all(m.id != model_id for m in _eligible_models(db, key, key.user_id)):
        raise ForbiddenError(
            f"model_not_allowed: model {model_id} is not allowed for this API key"
        )


def _chat_estimate(db: Session, provider: Provider, model: AIModel, text: str) -> tuple[int, Decimal]:
    """Pre-flight estimate for the key policy: prompt-only tokens + shared pricing."""
    tokens = max(1, len(text or "") // 4)
    repo = find_for_model(db, provider.provider_type.value, model.model_id)
    cost = calculate(UsageTokens(prompt=tokens), prices_for_model(model, repo)).total_cost
    return tokens, cost


def _enforce_chat_key(
    db: Session,
    api_key: ApiKey | None,
    provider: Provider,
    model: AIModel,
    *,
    estimated_tokens: int,
    estimated_cost: Decimal,
    request_id: str | None,
    client_ip: str | None,
    pre_text: str | None = None,
    pre_user_id: uuid.UUID | None = None,
) -> tuple[key_engine.KeyContext | None, Decimal | None]:
    """Shared in-app key-policy gate. No-op on the legacy keyless path.

    Returns (ctx, org_cap) for usage reconciliation. Raises 404-oracle on
    bad/disabled/expired keys, 403/429 on policy denies — always BEFORE any
    row creation or provider I/O by the caller.
    """
    # Guardrail pre-check runs regardless of api_key (keyless calls pass
    # api_key_id=None): unpriced traffic is still inspected, and blocks raise
    # before any row creation or provider I/O by the caller.
    if pre_text is not None:
        from tollms.services.guardrails import enforcement as guardrail_enforcement

        try:
            guardrail_enforcement.check_pre_sync(
                db, text=pre_text, user_id=pre_user_id,
                provider_id=provider.id, model_id=model.id,
                api_key_id=api_key.id if api_key is not None else None,
                source="internal",
                endpoint="chat", request_id=request_id,
            )
        except (ForbiddenError, NotFoundError, ValidationError):
            raise
        except Exception:
            logger.warning("guardrail pre-check hook failed (fail-open)", exc_info=True)
    if api_key is None:
        return None, None
    ctx = key_policy.chat_key_context(db, api_key)
    org_cap = key_policy.org_cap_usd(db, ctx)
    key_policy.enforce_chat_policy(
        db, ctx, provider, model,
        estimated_tokens, estimated_cost, request_id, client_ip, org_cap,
    )
    return ctx, org_cap


def _guardrail_post(
    db: Session,
    *,
    text: str,
    user_id: uuid.UUID | None,
    provider: Provider,
    model: AIModel,
    api_key_id: uuid.UUID | None,
    generation_id: uuid.UUID | None = None,
    request_id: str | None = None,
    allow_block: bool = False,
) -> str:
    """Guardrail post hook: audit-first, never raises, never touches Valkey
    usage counters. Returns the worst action; non-streaming callers withhold
    delivery when it is blocked (buffer_then_inspect only)."""
    try:
        from tollms.services.guardrails import enforcement as guardrail_enforcement

        return guardrail_enforcement.record_post_sync(
            db, text=text or "", user_id=user_id,
            org_id=org_attribution(db, provider, user_id),
            provider_id=provider.id, model_id=model.id, api_key_id=api_key_id,
            source="internal", endpoint="chat", request_id=request_id,
            generation_id=generation_id, allow_block=allow_block)
    except Exception:
        logger.warning("guardrail post hook failed", exc_info=True)
        return "allowed"


async def _promptlog_capture(
    db: Session,
    *,
    input_text: str | None,
    output_text: str | None,
    user_id: uuid.UUID | None,
    org_id: uuid.UUID | None,
    api_key,
    provider,
    model,
    conversation_id: uuid.UUID | None,
    request_id: str | None,
    generation_id: uuid.UUID | None,
    status: str,
    tokens=None,
    latency_ms: float | None = None,
    error_code: str | None = None,
) -> None:
    """Prompt-log hook: immutable ledger write, fail-open always. Never raises,
    never touches Valkey usage counters, never logs content.

    Provenance resolves server-side from the ApiKey row (``key_provenance``
    stays None): a personal provider + org key logs to the key's org, and a
    provider-org-A + key-org-B mismatch attributes B — never the provider's
    org. Same rule as the streaming driver (generation.py passes None too).
    """
    try:
        from tollms.services.prompt_logging import queue as promptlog_queue

        promptlog_queue.enqueue_post(
            db, input_text=input_text, output_text=output_text, user_id=user_id,
            org_id=org_id, api_key_id=getattr(api_key, "id", None),
            key_provenance=None,
            provider_id=getattr(provider, "id", None),
            model_id=getattr(model, "id", None),
            conversation_id=conversation_id, endpoint="chat", source="internal",
            request_id=request_id, generation_id=generation_id, status=status,
            tokens=tokens, latency_ms=latency_ms, error_code=error_code,
            allow_store=True)
    except Exception:
        logger.warning("promptlog hook failed (fail-open)", exc_info=True)


def _release_chat_reservation(
    ctx: key_engine.KeyContext | None,
    provider: Provider,
    model: AIModel,
    request_id: str | None,
    org_cap: Decimal | None,
) -> None:
    """Refund the pre-flight Valkey reservation (provider failure/cancel)."""
    key_policy.reconcile_chat_usage(
        ctx, provider_id=provider.id, model_id=model.id,
        tokens=0, cost=Decimal(0), request_id=request_id, org_cap=org_cap,
    )


def _reconcile_chat_usage(
    db: Session,
    ctx: key_engine.KeyContext | None,
    provider: Provider,
    model: AIModel,
    tokens: UsageTokens,
    breakdown: CostBreakdown,
    request_id: str | None,
    org_cap: Decimal | None,
) -> None:
    """Swap the reservation for actual usage after the request-log row commits."""
    del db  # reconciliation is Valkey-only; the DB row is the caller's commit
    key_policy.reconcile_chat_usage(
        ctx, provider_id=provider.id, model_id=model.id,
        tokens=tokens.prompt + tokens.completion, cost=breakdown.total_cost,
        request_id=request_id, org_cap=org_cap,
    )


def validated_reasoning_level(model: AIModel, level: str | None) -> str | None:
    """Constrain a requested reasoning level to the model's catalog options.

    Mirrors the frontend gate (`capabilities.ts isReasoningValueValid`) so
    direct API callers cannot buy thinking the model doesn't offer: unknown
    levels collapse to None (off) instead of the adapter's medium/high
    fallback. Models without declared options keep legacy pass-through.
    """
    if not level:
        return None
    options = (model.metadata_ or {}).get("reasoning_options")
    if not isinstance(options, list) or not options:
        return level  # unknown catalog state: legacy adapter clamping applies
    from tollms.services.gateway.adapters.base import REASONING_OFF_LEVELS

    for entry in options:
        if not isinstance(entry, dict):
            continue
        kind = entry.get("type")
        if kind == "effort":
            values = [v for v in entry.get("values") or [] if isinstance(v, str)]
            if not values:
                continue
            if level in REASONING_OFF_LEVELS:
                return level
            return level if level in values else None
        if kind == "budget_tokens":
            minimum = entry.get("min")
            maximum = entry.get("max")
            try:
                n = int(str(level).strip())
            except (TypeError, ValueError):
                return None
            floor = int(minimum) if isinstance(minimum, (int, float)) and minimum >= 0 else 0
            ceiling = int(maximum) if isinstance(maximum, (int, float)) and maximum >= floor else None
            if n >= floor and (ceiling is None or n <= ceiling):
                return str(n)
            return None
        if kind == "toggle":
            default = entry.get("default")
            on_value = default if isinstance(default, str) and default else "on"
            return level if level == on_value else None
    return None


def _adapter_reasoning_level(provider: Provider, model: AIModel, level: str | None) -> str | None:
    """Reasoning level after the thinkingConfig capability gate.

    validated_reasoning_level passes legacy levels through when the catalog
    declares no reasoning_options; Gemini/Vertex models without
    supports_reasoning 400 on thinkingConfig, so they stay off. Other
    families pass through — their adapters decide what to request.
    """
    level = validated_reasoning_level(model, level)
    if provider.provider_type in _THINKING_CONFIG_TYPES and not model.supports_reasoning:
        return None
    return level


def chat_keys(db: Session, user_id: uuid.UUID) -> list[ChatKeyRead]:
    """Session user's key picker entries: live personal keys plus org keys
    assigned to the caller while their membership stays ACTIVE."""
    from tollms.models.organization import Membership, MembershipState, Organization

    rows = list(
        db.scalars(
            select(ApiKey)
            .where(ApiKey.user_id == user_id, ApiKey.is_deleted.is_(False))
            .order_by(ApiKey.created_at.desc())
        )
    )
    active_orgs = set(
        db.scalars(
            select(Membership.org_id).where(
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        )
    )
    org_ids = {key.org_id for key in rows if key.org_id is not None}
    org_names: dict = (
        dict(
            db.execute(
                select(Organization.id, Organization.name).where(
                    Organization.id.in_(list(org_ids))
                )
            ).all()
        )
        if org_ids
        else {}
    )
    now = datetime.now(timezone.utc)
    out: list[ChatKeyRead] = []
    for key in rows:
        if key.org_id is not None and key.org_id not in active_orgs:
            continue
        if not key.enabled:
            continue
        if _key_expired(key, now):
            continue
        if key_engine.is_tombstoned(key.key_hash):
            continue
        out.append(
            ChatKeyRead(
                id=key.id,
                name=key.name,
                scope="organization" if key.org_id is not None else "personal",
                org_id=key.org_id,
                org_name=org_names.get(key.org_id),
                enabled=key.enabled,
                model_count=len(_eligible_models(db, key, user_id)),
            )
        )
    return out


def chat_models_for_key(
    db: Session, key_id: uuid.UUID, user_id: uuid.UUID
) -> list[ModelRead]:
    """Eligible models for one key (same resolver as the gateway).

    Full ModelRead rows (not minimal ids): the composer renders
    capabilities/pricing from these directly, so org models never depend
    on the personal-only registry listing.
    """
    key = _require_chat_key(db, key_id, user_id)
    assert key is not None  # session users never take the legacy path
    return [read_model(m) for m in _eligible_models(db, key, user_id)]


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
    client_ip: str | None = None,
) -> ChatResponse:
    """Non-streaming chat. Persists user + assistant messages, usage, cost."""
    api_key = _require_chat_key(db, data.key_id, user_id)
    provider, model = _resolve(db, data.provider_id, data.model_id, user_id)
    _enforce_key_model(db, api_key, model.id)
    api_key_id = api_key.id if api_key is not None else None
    start = time.monotonic()
    started_at = datetime.now(timezone.utc)
    # Pre-flight reservation id: the client idempotency key when present, else
    # the conversation under test, else a fresh id (reconciled with actuals below).
    request_id = data.client_key or (
        str(data.conversation_id) if data.conversation_id is not None else uuid.uuid4().hex
    )
    ctx: key_engine.KeyContext | None = None
    org_cap: Decimal | None = None
    try:
        credentials = decrypted_credentials(provider)
        adapter = build_adapter(provider, model, credentials, transport)
        adapter.reasoning_level = _adapter_reasoning_level(provider, model, data.reasoning_level)
        adapter.image_output = bool(model.supports_image_generation)
        adapter.max_output_tokens = model.max_output_tokens
        transcriber = _transcriber(provider, credentials)
        rows = attachment_service.get_many(db, data.attachment_ids, user_id)
        history = _history(db, data.conversation_id, data.system, user_id, adapter, model)
        texts, media = await _assemble_attachments(
            db, rows=rows, model=model, adapter=adapter,
            transcriber=transcriber, transport=transport, strict=True,
        )
        content = "\n\n".join([data.message, *texts]) if (data.message or texts) else ""
        history.append(ChatMessage(role="user", content=content, media=media))
        history_text = "".join(m.content for m in history)
        if _is_media_model(model):
            media_est = media_cost_estimate(
                db, provider, model, model.primary_endpoint, media_options(model.primary_endpoint)
            )
            est_tokens, est_cost = max(1, len(history_text) // 4), media_est.estimated_cost
        else:
            est_tokens, est_cost = _chat_estimate(db, provider, model, history_text)
        # Policy gate BEFORE any row creation or provider I/O (raises on deny).
        ctx, org_cap = _enforce_chat_key(
            db, api_key, provider, model,
            estimated_tokens=est_tokens, estimated_cost=est_cost,
            request_id=request_id, client_ip=client_ip,
            pre_text=history_text, pre_user_id=user_id,
        )
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
        adapter.prompt_cache = caching_for_model(db, provider, model, conv_id)
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
        if api_key_id is not None:
            user_msg.api_key_id = api_key_id
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
        if api_key_id is not None:
            assistant.api_key_id = api_key_id
            db.commit()
            db.refresh(assistant)
        # Guardrail post: audit-first; a blocked buffer_then_inspect verdict
        # withholds the text (usage/cost rows stand — the provider billed).
        guard_action = _guardrail_post(
            db, text=result.text, user_id=user_id, provider=provider,
            model=model, api_key_id=api_key_id, generation_id=assistant.id,
            request_id=request_id, allow_block=True,
        )
        content = "[withheld by guardrail policy]" if guard_action == "blocked" else result.text
        if guard_action == "blocked" and assistant.content != content:
            assistant.content = content
            db.commit()
            db.refresh(assistant)
        image_rows = attachment_service.persist_inline_images(
            db,
            images=getattr(result, "images", []),
            conversation_id=conv_id,
            message_id=assistant.id,
            user_id=user_id,
            model_label=model.model_id,
        )
        attachments = [AttachmentRead.model_validate(row) for row in image_rows]
        db.add(
            GenerationRun(
                message_id=assistant.id,
                user_id=user_id,
                api_key_id=api_key_id,
                generation_number=1,
                provider_id=provider.id,
                model_id=model.id,
                content=content,
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
                org_id=org_attribution(db, provider, user_id),
                api_key_id=api_key_id,
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
                cache_read_tokens=tokens.cache_read,
                cache_write_tokens=tokens.cache_write,
                reasoning_tokens=tokens.reasoning,
                input_cost=cost[0],
                output_cost=cost[1],
                total_cost=cost[2],
                status=RequestStatus.SUCCESS,
                is_streaming=False,
                usage_estimated=estimated,
            ),
        )
        db.commit()
        # Guardrail rule: the post verdict above already withheld delivery
        # (buffer_then_inspect), so the ledger stores the same marker — never
        # the blocked text. Streaming paths instead capture delivered bytes.
        await _promptlog_capture(
            db, input_text=history_text, output_text=content, user_id=user_id,
            org_id=org_attribution(db, provider, user_id), api_key=api_key,
            provider=provider, model=model, conversation_id=conv_id,
            request_id=request_id, generation_id=assistant.id, status="completed",
            tokens={"prompt": tokens.prompt, "completion": tokens.completion},
            latency_ms=latency_ms)
        _reconcile_chat_usage(
            db, ctx, provider, model, tokens, breakdown,
            request_id=request_id, org_cap=org_cap,
        )
        logger.info(
            "gateway chat done: conv=%s tokens=%s/%s cost=%s latency=%.0fms",
            conv_id, usage[0], usage[1], cost[2], latency_ms,
        )
        incr_counter("gateway.request", {"plane": "ui", "status": "success"})
        return ChatResponse(
            conversation_id=conv_id, message_id=assistant.id, content=content,
            prompt_tokens=usage[0], completion_tokens=usage[1], total_tokens=usage[2],
            cache_read_tokens=tokens.cache_read, cache_write_tokens=tokens.cache_write,
            reasoning_tokens=tokens.reasoning,
            input_cost=cost[0], output_cost=cost[1], total_cost=cost[2],
            cache_read_cost=breakdown.cache_read_cost, cache_write_cost=breakdown.cache_write_cost,
            reasoning_cost=breakdown.reasoning_cost,
            usage_estimated=estimated, latency_ms=latency_ms,
            attachments=attachments,
        )
    except (NotFoundError, ValidationError, ForbiddenError, TooManyRequestsError):
        raise
    except Exception as e:
        logger.exception("gateway chat failed")
        _release_chat_reservation(ctx, provider, model, request_id, org_cap)
        incr_counter("gateway.request", {"plane": "ui", "status": "failed"})
        classified = classify_provider_failure(e)
        # Prompt-log failure record: input captured when the policy allows
        # (output empty, outcome marked failed). Never breaks propagation.
        await _promptlog_capture(
            db, input_text=locals().get("history_text") or data.message or "",
            output_text="", user_id=user_id,
            org_id=locals().get("failed_org_id"),
            api_key=locals().get("api_key"),
            provider=locals().get("provider"), model=locals().get("model"),
            conversation_id=locals().get("conv_id"),
            request_id=request_id, generation_id=None, status="failed",
            latency_ms=(time.monotonic() - start) * 1000,
            error_code=classified.code.value)
        # Durable failure record: no message row exists on this path, so log
        # the attempt itself (unknown usage stays NULL — never fabricated).
        # Never breaks error propagation.
        try:
            try:
                failed_org_id = org_attribution(db, provider, user_id)
            except Exception:
                failed_org_id = None
            request_log_engine.record(
                db,
                request_log_engine.RequestLogEntry(
                    user_id=user_id,
                    org_id=failed_org_id,
                    api_key_id=api_key_id,
                    conversation_id=locals().get("conv_id"),
                    message_id=None,
                    provider_id=getattr(provider, "id", None),
                    model_id=getattr(model, "id", None),
                    request_started_at=started_at,
                    request_completed_at=datetime.now(timezone.utc),
                    latency_ms=(time.monotonic() - start) * 1000,
                    status=RequestStatus.FAILED,
                    error_code=classified.code.value,
                    is_streaming=False,
                ),
            )
            db.commit()
        except Exception:
            db.rollback()
            logger.warning("gateway chat failure logging failed", exc_info=True)
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
    media_operation: str = "generate"
    media_prompt: str | None = None
    media_count: int = 1
    media_ref_id: uuid.UUID | None = None
    media_ref_message_id: uuid.UUID | None = None
    media_prior_excerpt: str = ""
    media_ref_bytes: bytes | None = None
    media_lineage: dict | None = None
    api_key_id: uuid.UUID | None = None
    # Key-policy reservation: enforced in _setup_generation, reconciled by the
    # generation driver with actual usage (None = legacy keyless path).
    request_id: str | None = None
    key_ctx: key_engine.KeyContext | None = None
    key_org_cap: Decimal | None = None


async def _setup_generation(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None,
    user_id: uuid.UUID | None,
    client_ip: str | None = None,
) -> _Setup:
    """Resolve, enforce key policy, create conv if needed, assemble history.

    Raises 404/422/403/429 before any row exists. Row creation happens after
    the policy gate (409 on active generation stays in start_generation under
    the conversation lock). Pre-existing conversations are validated up front;
    new ones are created only once the key policy allows the generation.
    """
    api_key = _require_chat_key(db, data.key_id, user_id)
    provider, model = _resolve(db, data.provider_id, data.model_id, user_id)
    _enforce_key_model(db, api_key, model.id)
    # Ownership check for a pre-existing conversation (no rows touched).
    if data.conversation_id is not None:
        get_conversation(db, data.conversation_id, user_id)
    credentials = decrypted_credentials(provider)
    adapter = build_adapter(provider, model, credentials, transport)
    adapter.reasoning_level = _adapter_reasoning_level(provider, model, data.reasoning_level)
    adapter.max_output_tokens = model.max_output_tokens
    adapter.image_output = bool(model.supports_image_generation)
    transcriber = _transcriber(provider, credentials)
    rows = attachment_service.get_many(db, data.attachment_ids, user_id)
    # History/reference lookups use the existing conversation only; a new
    # conversation has no history by construction.
    lookup_conv_id = data.conversation_id
    history = _history(db, lookup_conv_id, data.system, user_id, adapter, model)
    media_endpoint = model.primary_endpoint if _is_media_model(model) else None
    media_opts: dict | None = None
    media_cost: CostEstimate | None = None
    operation, final_prompt, count = "generate", data.message, 1
    ref_id, ref_message_id, prior_excerpt, ref_bytes, lineage = None, None, "", None, {}
    if media_endpoint:
        # Media models take the prompt directly; long text history and document
        # text injection do not apply. Uploaded rows stay available as reference.
        media_opts = media_options(media_endpoint)
        operation, final_prompt, count = "generate", data.message, 1
        ref_id, ref_message_id, prior_excerpt, ref_bytes, lineage = None, None, "", None, {}
        if media_endpoint == "images/generations":
            # Prompt-only sends: no size/quality params are invented. The
            # count drives the per-image loop; everything else stays in the
            # prompt prose for the model to interpret. Cost is estimated on
            # the default rate-card tier and flagged estimated downstream.
            count, count_source = _parse_image_intent(data.message)
            media_opts = {}
            media_cost = media_cost_estimate(db, provider, model, media_endpoint, {"n": count})
            # Explicit uploads first, else the most recent prior image in this
            # conversation — history is resolved, not discarded.
            ref_row = next((row for row in rows if row.kind == "image"), None)
            if ref_row is None and lookup_conv_id is not None:
                stored = list_messages(db, lookup_conv_id, user_id)
                grouped = attachment_service.attachments_for_messages(
                    db, [m.id for m in stored], user_id
                )
                resolved = _resolve_image_reference(stored, grouped, user_id, lookup_conv_id)
                if resolved is not None:
                    ref_row, ref_message_id, prior_excerpt = resolved
            if ref_row is not None:
                try:
                    ref_bytes = attachment_engine.read_bytes(ref_row.storage_path)
                except Exception:
                    logger.warning("media reference unreadable, generating fresh: ref=%s", ref_row.id)
                    ref_row, ref_message_id, ref_bytes = None, None, None
            operation, final_prompt, note = _select_media_operation(
                supports_edit=provider.provider_type in _EDIT_CAPABLE_TYPES,
                has_reference=ref_row is not None,
                prior_excerpt=prior_excerpt,
                prompt=data.message,
            )
            ref_id = ref_row.id if ref_row is not None else None
            lineage = {"intent": {"count_source": count_source}}
            if ref_id is not None:
                lineage["reference_attachment_id"] = str(ref_id)
            if ref_message_id is not None:
                lineage["reference_message_id"] = str(ref_message_id)
            if prior_excerpt:
                lineage["prior_prompt_excerpt"] = prior_excerpt
            if note is not None:
                lineage["note"] = note
                if note == "edit_unsupported":
                    lineage["edit_unsupported"] = True
            logger.info(
                "gateway stream: media model %s endpoint=%s operation=%s count=%d ref=%s cost=%s",
                model.model_id, media_endpoint, operation, count, ref_id, media_cost.estimated_cost,
            )
        else:
            media_cost = media_cost_estimate(db, provider, model, media_endpoint, media_opts)
            seconds, seconds_source = _parse_video_intent(data.message)
            media_opts = {**media_opts, "seconds": seconds}
            # Image-to-video: explicit uploads first, else the most recent
            # prior image in this conversation — same rule as stills.
            ref_row = next((row for row in rows if row.kind == "image"), None)
            if ref_row is None and lookup_conv_id is not None:
                stored = list_messages(db, lookup_conv_id, user_id)
                grouped = attachment_service.attachments_for_messages(
                    db, [m.id for m in stored], user_id
                )
                resolved = _resolve_image_reference(stored, grouped, user_id, lookup_conv_id)
                if resolved is not None:
                    ref_row, ref_message_id, prior_excerpt = resolved
            if ref_row is not None:
                try:
                    ref_bytes = attachment_engine.read_bytes(ref_row.storage_path)
                except Exception:
                    logger.warning("media reference unreadable, generating fresh: ref=%s", ref_row.id)
                    ref_row, ref_message_id, ref_bytes = None, None, None
            ref_id = ref_row.id if ref_row is not None else None
            lineage = {"intent": {"seconds_source": seconds_source}}
            if ref_id is not None:
                lineage["reference_attachment_id"] = str(ref_id)
            if ref_message_id is not None:
                lineage["reference_message_id"] = str(ref_message_id)
            if rows:
                lineage.setdefault("reference_attachment_id", str(rows[0].id))
            logger.info(
                "gateway stream: media model %s endpoint=%s cost=%s",
                model.model_id, media_endpoint, media_cost.estimated_cost,
            )
        history = [ChatMessage(role="user", content=final_prompt)]
        texts, media = [], []
    else:
        texts, media = await _assemble_attachments(
            db, rows=rows, model=model, adapter=adapter,
            transcriber=transcriber, transport=transport, strict=True,
        )
        content = "\n\n".join([data.message, *texts]) if (data.message or texts) else ""
        history.append(ChatMessage(role="user", content=content, media=media))
        logger.info(
            "gateway stream: provider=%s model=%s conv=%s attachments=%d media=%d",
            provider.provider_type, model.model_id, lookup_conv_id, len(rows), len(media),
        )
    history_text = "".join(m.content for m in history)
    if media_endpoint is not None and media_cost is not None:
        est_tokens, est_cost = max(1, len(history_text) // 4), media_cost.estimated_cost
    else:
        est_tokens, est_cost = _chat_estimate(db, provider, model, history_text)
    # Policy gate BEFORE row creation (raises 404-oracle/403/429 on deny).
    # Attachment content prep above is not provider I/O for the generation
    # itself; the expensive call and every row happen strictly after this.
    request_id = data.client_key or (
        str(data.conversation_id) if data.conversation_id is not None else uuid.uuid4().hex
    )
    ctx, org_cap = _enforce_chat_key(
        db, api_key, provider, model,
        estimated_tokens=est_tokens, estimated_cost=est_cost,
        request_id=request_id, client_ip=client_ip,
        pre_text=history_text, pre_user_id=user_id,
    )
    if data.conversation_id is None:
        title = data.message[:60] or (f"Attachment: {rows[0].filename}"[:60] if rows else "New conversation")
        conv = create_conversation(
            db, ConversationCreate(title=title, provider_id=provider.id, model_id=model.id),
            user_id,
        )
        conv_id = conv.id
    else:
        conv_id = data.conversation_id
    # Prompt caching is planned once the conversation id is known (OpenAI uses
    # it as the cache key). Disabled plans leave the request body untouched.
    adapter.prompt_cache = caching_for_model(db, provider, model, conv_id)
    return _Setup(
        conv_id=conv_id, provider=provider, model=model, adapter=adapter,
        api_key_id=api_key.id if api_key is not None else None,
        rows=rows, history=history, history_text=history_text,
        media_endpoint=media_endpoint, media_options=media_opts, media_cost=media_cost,
        media_operation=operation, media_prompt=final_prompt, media_count=count,
        media_ref_id=ref_id, media_ref_message_id=ref_message_id,
        media_prior_excerpt=prior_excerpt, media_ref_bytes=ref_bytes,
        media_lineage=lineage or None,
        request_id=request_id, key_ctx=ctx, key_org_cap=org_cap,
    )


async def start_generation(
    db: Session,
    data: ChatRequest,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
    session_factory=None,
    session_id: str | None = None,
    client_ip: str | None = None,
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
    setup = await _setup_generation(db, data, transport, user_id, client_ip)
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
                api_key_id=setup.api_key_id,
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
            if setup.api_key_id is not None:
                user_msg.api_key_id = setup.api_key_id
                assistant.api_key_id = setup.api_key_id
            if data.client_key:
                assistant.client_key = data.client_key
            if setup.api_key_id is not None or data.client_key:
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
    except ConflictError:
        # Gate already reserved but no generation proceeds — refund so the
        # 409 leaves no phantom spend (fail-closed direction, not a bypass).
        db.rollback()
        _release_chat_reservation(setup.key_ctx, provider, model, setup.request_id, setup.key_org_cap)
        raise
    except IntegrityError:
        # Lost a same-key/in-flight race: adopt the winner, never duplicate.
        db.rollback()
        if data.client_key:
            winner = find_assistant_by_client_key(db, user_id, data.client_key)
            if winner is not None:
                # Winner proceeds under its own reservation (same request_id
                # slot when the client_key matches); the duplicate INCR stays
                # reserved and is reconciled by the winner's finish path, so
                # nothing is released here.
                logger.info("generation race adopted by client_key: %s", winner.id)
                return GenerationStarted(
                    conversation_id=winner.conversation_id,
                    generation_id=winner.id,
                    message_id=winner.id,
                    status=winner.status.value,
                )
        if active_assistant_message(db, conv_id, user_id) is not None:
            _release_chat_reservation(setup.key_ctx, provider, model, setup.request_id, setup.key_org_cap)
            raise ConflictError(f"conversation {conv_id} already has an active generation")
        _release_chat_reservation(setup.key_ctx, provider, model, setup.request_id, setup.key_org_cap)
        raise
    except Exception:
        # Any other post-gate failure before spawn: refund the reservation.
        db.rollback()
        _release_chat_reservation(setup.key_ctx, provider, model, setup.request_id, setup.key_org_cap)
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
        provider_name=provider.name,
        model_name=model.name,
        input_price=str(model.input_price),
        output_price=str(model.output_price),
        cache_read_price=str(model.cache_read_price),
        cache_write_price=str(model.cache_write_price),
        session_id=session_id,
        provider_id=provider.id,
        model_id=model.id,
        org_id=org_attribution(db, provider, user_id),
        api_key_id=setup.api_key_id,
        run_id=run.id,
        key_ctx=setup.key_ctx,
        key_request_id=setup.request_id,
        key_org_cap=str(setup.key_org_cap) if setup.key_org_cap is not None else None,
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
            prompt=setup.media_prompt or data.message,
            provider_type=provider.provider_type.value,
            reference_attachment_id=setup.media_ref_id or (
                setup.rows[0].id if setup.media_endpoint == "video/generations" and setup.rows else None
            ),
            reference_bytes=setup.media_ref_bytes,
            operation=setup.media_operation,
            count=setup.media_count,
            lineage=setup.media_lineage,
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
        yield f"data: {json.dumps(_terminal_from_row(db, msg, _message_attachments(db, msg.id, user_id)))}\n\n"
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
        yield f"data: {json.dumps(_terminal_from_row(db, msg, _message_attachments(db, msg.id, user_id)))}\n\n"
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


def _display_names(db, msg) -> tuple[str | None, str | None]:
    """(provider_name, model_name) for a message row. Never raises: unknown
    rows yield None and the caller falls back to a non-null placeholder."""
    provider_name, model_name = None, None
    try:
        if msg.provider_id is not None:
            provider = db.get(Provider, msg.provider_id)
            if provider is not None:
                provider_name = provider.name
        if msg.model_id is not None:
            model = db.get(AIModel, msg.model_id)
            if model is not None:
                model_name = model.name
    except Exception:
        logger.warning("terminal display-name lookup failed: %s", msg.id, exc_info=True)
    return provider_name, model_name


def _terminal_from_row(db, msg, attachments: list | None = None) -> dict:
    provider_name, model_name = _display_names(db, msg)
    return {
        "done": True,
        "generation_id": str(msg.id),
        "message_id": str(msg.id),
        "status": msg.status.value,
        "provider_name": provider_name or "Unknown",
        "model_name": model_name or "Unknown",
        "content": msg.content,
        **({"error": msg.error} if msg.error else {}),
        "attachments": [
            a.model_dump(mode="json") if hasattr(a, "model_dump") else a
            for a in (attachments or [])
        ],
    }


def _message_attachments(db, message_id, user_id) -> list:
    """Attachment reads for one message. Empty on any failure (never break SSE)."""
    try:
        grouped = attachment_service.attachments_for_messages(db, [message_id], user_id)
        return [AttachmentRead.model_validate(a) for a in grouped.get(message_id, [])]
    except Exception:
        logger.warning("terminal attachments lookup failed: %s", message_id, exc_info=True)
        return []


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
    key_id: uuid.UUID | None = None,
    reasoning_level: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    session_factory=None,
    session_id: str | None = None,
    client_ip: str | None = None,
) -> GenerationStarted:
    """Regenerate an assistant message in place, preserving every prior run.

    The message row always mirrors the active generation; `generation_runs`
    keeps the full history for ◀ 1 of N ▶ navigation. Key-gated exactly like
    chat send: a session user without `key_id` gets 422 KEY_REQUIRED, and the
    requested model must sit in the key's allow-list (403 otherwise).
    """
    assistant = get_message(db, message_id, user_id)
    if assistant.role != Role.ASSISTANT:
        raise ValidationError("only assistant messages can be regenerated")
    if assistant.status not in TERMINAL_STATUSES:
        raise ConflictError("message is still generating")
    api_key = _require_chat_key(db, key_id, user_id)

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
    _enforce_key_model(db, api_key, model.id)
    api_key_id = api_key.id if api_key is not None else None
    credentials = decrypted_credentials(provider)
    adapter = build_adapter(provider, model, credentials, transport)
    adapter.reasoning_level = _adapter_reasoning_level(provider, model, reasoning_level)
    adapter.max_output_tokens = model.max_output_tokens
    adapter.image_output = bool(model.supports_image_generation)
    history = _history_until(db, conv_id, preceding, user_id, adapter, model)
    adapter.prompt_cache = caching_for_model(db, provider, model, conv_id)
    if not history:
        raise ValidationError("no conversation history to regenerate from")
    history_text = "".join(m.content for m in history)
    if _is_media_model(model):
        regen_est_cost = media_cost_estimate(
            db, provider, model, model.primary_endpoint,
            {} if model.primary_endpoint == "images/generations"
            else media_options(model.primary_endpoint),
        ).estimated_cost
        est_tokens, est_cost = max(1, len(history_text) // 4), regen_est_cost
    else:
        est_tokens, est_cost = _chat_estimate(db, provider, model, history_text)
    # Policy gate BEFORE row writes (raises 404-oracle/403/429 on deny).
    request_id = uuid.uuid4().hex
    ctx, org_cap = _enforce_chat_key(
        db, api_key, provider, model,
        estimated_tokens=est_tokens, estimated_cost=est_cost,
        request_id=request_id, client_ip=client_ip,
        pre_text=history_text, pre_user_id=user_id,
    )

    started_at = datetime.now(timezone.utc)
    try:
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
                api_key_id=api_key_id,
                generation_number=int(last_number or 0) + 1,
                provider_id=provider.id,
                model_id=model.id,
                content="",
                status=MessageStatus.RUNNING.value,
                is_active=False,
            )
            db.add(run)
            _reset_assistant_for_regeneration(assistant, started_at)
            if api_key_id is not None:
                assistant.api_key_id = api_key_id
            db.commit()
            db.refresh(assistant)
            db.refresh(run)
    except ConflictError:
        # Gate already reserved but no generation proceeds — refund so the
        # 409 leaves no phantom spend (fail-closed direction, not a bypass).
        _release_chat_reservation(ctx, provider, model, request_id, org_cap)
        raise
    except Exception:
        # Any other post-gate failure before spawn: refund the reservation.
        db.rollback()
        _release_chat_reservation(ctx, provider, model, request_id, org_cap)
        raise

    spec = GenerationSpec(
        generation_id=assistant.id,
        conversation_id=conv_id,
        user_id=user_id,
        adapter=adapter,
        history=history,
        history_text="".join(m.content for m in history),
        provider_type=provider.provider_type.value,
        model_label=model.model_id,
        provider_name=provider.name,
        model_name=model.name,
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
        api_key_id=api_key_id,
        key_ctx=ctx,
        key_request_id=request_id,
        key_org_cap=str(org_cap) if org_cap is not None else None,
    )
    if _is_media_model(model):
        # Retry/regenerate reuses the preceding user prompt, no duplicate rows.
        # Image retries stay prompt-only (no invented size/quality); video
        # keeps its duration default.
        regen_endpoint = model.primary_endpoint
        regen_options = (
            {} if regen_endpoint == "images/generations" else media_options(regen_endpoint)
        )
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
            operation="generate",
            lineage={"intent": {"count_source": "default"}}
            if regen_endpoint == "images/generations"
            else None,
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
