"""Public API gateway core: key auth, policy checks, routing, usage, logging.

The public surface (``/v1/*``) never creates conversations or messages: each
request resolves its model through `model_resolution`, is authorized against
the API key policy (`services.api_keys.keys` + `services.gateway.limits`),
routes through the shared provider adapters, and lands in `api_request_logs`
(exactly one row per request, success, stream or failure).
"""

import asyncio
import base64
import inspect
import ipaddress
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.exceptions import (
    ApplicationException,
    AuthenticationError,
    ErrorCode,
    ForbiddenError,
    ProviderError,
    ValidationError,
    classify_provider_failure,
)
from tollms.core.security import client_meta as _request_client_meta
from tollms.api.providers.service import decrypted_credentials
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services.api_keys.keys import KeyContext, authenticate, parse_bearer
from tollms.services.cost_estimator import (
    actual_image_cost,
    estimate_image_cost,
    estimate_video_cost,
    media_rate_card,
)
from tollms.services.gateway import dispatch
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatResult, StreamChunk
from tollms.services.gateway.api_logs import ApiLogEntry, log_request
from tollms.services.gateway.costing import (
    CostBreakdown,
    UsageTokens,
    calculate,
    prices_for_model,
)
from tollms.services.gateway.factory import build_adapter
from tollms.services.gateway.limits import check_request, record_usage
from tollms.services.gateway.model_resolution import ResolvedModel, resolve_model
from tollms.services.gateway.unified import UnifiedRequest
from tollms.services.model_repository.lookup import find_for_model

logger = logging.getLogger(__name__)

CHAT_ENDPOINTS = frozenset({"chat_completions", "responses", "messages"})
MEDIA_ENDPOINTS = frozenset({"images", "image_edits", "videos"})
_STATUS_CODES = {
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}


# --- request metadata --------------------------------------------------------


@dataclass(frozen=True)
class ClientMeta:
    """Per-request client facts recorded in the API log."""

    request_id: str
    ip_address: str | None = None
    user_agent: str | None = None


def client_meta(request: Request) -> ClientMeta:
    """Build ClientMeta from the incoming request (never trusted for auth)."""
    info = _request_client_meta(request)
    return ClientMeta(
        request_id=uuid.uuid4().hex,
        ip_address=info.get("ip") or None,
        user_agent=info.get("user_agent") or None,
    )


# --- outcomes returned to the router -----------------------------------------


@dataclass
class ChatOutcome:
    """One completed chat call (non-streaming)."""

    request_id: str
    model_identifier: str
    provider_label: str
    text: str
    usage: UsageTokens
    total_tokens: int
    breakdown: CostBreakdown
    latency_ms: float
    estimated: bool


@dataclass
class MediaOutcome:
    """One completed media generation (images/videos)."""

    request_id: str
    model_identifier: str
    provider_label: str
    endpoint: str
    payloads: list[bytes]
    is_video: bool
    cost: Decimal
    estimated: bool
    latency_ms: float


@dataclass
class StreamResult:
    """An SSE body plus the media type the router should stream it with."""

    iterator: AsyncIterator[str]
    media_type: str = "text/event-stream"


@dataclass
class DeniedResult:
    """A policy denial the router serializes verbatim (headers included).

    Returned instead of raised because the global exception handler rebuilds
    HTTP responses and would drop `Retry-After`.
    """

    status_code: int
    payload: dict[str, Any]
    headers: dict[str, str] | None = None


class _LimitsDenied(Exception):
    """Internal carrier: `check_request` denied the request."""

    def __init__(self, result: DeniedResult) -> None:
        super().__init__(result.payload["error"]["message"])
        self.result = result


def _denied_result(decision) -> DeniedResult:
    if decision.status_code == 403:
        error: ApplicationException = ForbiddenError(
            decision.reason or "request not allowed by key policy"
        )
    else:
        error = ApplicationException(
            decision.reason or "rate limit exceeded", code=ErrorCode.RATE_LIMITED
        )
        error.status_code = decision.status_code
    headers = {"Retry-After": str(decision.retry_after)} if decision.retry_after else None
    return DeniedResult(status_code=decision.status_code, payload=error.to_payload(), headers=headers)


# --- auth dependency ----------------------------------------------------------


def _match_network(address: ipaddress.IPv4Address | ipaddress.IPv6Address, cidr: str) -> bool:
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return False
    try:
        return address in network
    except TypeError:
        return False


def _ip_allowed(ctx: KeyContext, ip_text: str | None) -> bool:
    """Deny rules win; an empty allow list allows every address."""
    if not ip_text:
        return True
    try:
        address = ipaddress.ip_address(ip_text)
    except ValueError:
        return True  # unparseable client address cannot be evaluated
    if any(_match_network(address, rule) for rule in ctx.deny_rules):
        return False
    if not ctx.allow_rules:
        return True
    return any(_match_network(address, rule) for rule in ctx.allow_rules)


def api_key_required(request: Request, db: Session = Depends(get_db)) -> KeyContext:
    """Authenticate `Authorization: Bearer` / `x-api-key` into a KeyContext."""
    raw = parse_bearer(request.headers.get("authorization"), request.headers.get("x-api-key"))
    if not raw:
        raise AuthenticationError("missing API key")
    ctx = authenticate(db, raw)
    if ctx is None:
        raise AuthenticationError("invalid API key")
    if not ctx.enabled:
        raise ForbiddenError("API key is disabled")
    if ctx.is_expired():
        raise ForbiddenError("API key is expired")
    if not _ip_allowed(ctx, _request_client_meta(request).get("ip")):
        raise ForbiddenError("request blocked by API key IP rules")
    return ctx


# --- shared estimation ---------------------------------------------------------


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _prompt_tokens(unified: UnifiedRequest) -> int:
    text = "\n".join(message.content for message in unified.as_chat_messages())
    return _estimate_tokens(text)


def _media_rate_card_for(db: Session, provider: Provider, model: AIModel):
    return media_rate_card(model, find_for_model(db, provider.provider_type.value, model.model_id))


def _estimated_cost(db: Session, provider: Provider, model: AIModel, unified: UnifiedRequest) -> Decimal:
    """Conservative pre-flight estimate for the key policy check."""
    if unified.endpoint == "videos":
        card = _media_rate_card_for(db, provider, model)
        return estimate_video_cost(
            model_id=model.model_id,
            seconds=unified.media_options.get("seconds"),
            size=unified.media_options.get("size"),
            price_per_second=card.video_per_second,
        ).estimated_cost
    if unified.endpoint in ("images", "image_edits"):
        card = _media_rate_card_for(db, provider, model)
        return estimate_image_cost(
            model_id=model.model_id,
            quality=unified.media_options.get("quality"),
            size=unified.media_options.get("size"),
            count=int(unified.media_options.get("n") or 1),
            low=card.image_low,
            medium=card.image_medium,
            high=card.image_high,
        ).estimated_cost
    tokens = UsageTokens(prompt=_prompt_tokens(unified))
    repo = find_for_model(db, provider.provider_type.value, model.model_id)
    return calculate(tokens, prices_for_model(model, repo)).total_cost


def _finalize_usage(
    db: Session, provider: Provider, model: AIModel, history_text: str, text: str, usage: ChatResult
) -> tuple[UsageTokens, int, CostBreakdown, bool]:
    """Estimate missing tokens, then price via the shared cost engine.

    Same rules as the internal gateway, minus conversation persistence.
    """
    estimated = False
    prompt, completion = usage.prompt_tokens, usage.completion_tokens
    if not prompt and not completion:
        prompt, completion = _estimate_tokens(history_text), _estimate_tokens(text)
        estimated = True
    total = usage.total_tokens or (prompt + completion)
    tokens = UsageTokens(
        prompt=prompt,
        completion=completion,
        cache_read=usage.cache_read_tokens or 0,
        cache_write=usage.cache_write_tokens or 0,
        reasoning=usage.reasoning_tokens or 0,
    )
    repo = find_for_model(db, provider.provider_type.value, model.model_id)
    breakdown = calculate(tokens, prices_for_model(model, repo))
    return tokens, total, breakdown, estimated


# --- logging / usage helpers -----------------------------------------------------


def _error_code(exc: BaseException) -> str:
    if isinstance(exc, ApplicationException):
        return exc.code.value
    if isinstance(exc, HTTPException):
        return _STATUS_CODES.get(exc.status_code, "UNKNOWN_ERROR")
    return "UNKNOWN_ERROR"


def _log_request(
    db: Session,
    ctx: KeyContext,
    meta: ClientMeta,
    unified: UnifiedRequest,
    *,
    status: str,
    provider_label: str | None = None,
    model_label: str | None = None,
    error_code: str | None = None,
    latency_ms: float | None = None,
    cost: Decimal | None = None,
    tokens: UsageTokens | None = None,
    total_tokens: int | None = None,
    is_streaming: bool = False,
) -> None:
    entry = ApiLogEntry(
        request_id=meta.request_id,
        api_key_id=ctx.key_id,
        user_id=ctx.user_id,
        provider=provider_label,
        model=model_label,
        endpoint=unified.endpoint,
        status=status,
        error_code=error_code,
        latency_ms=latency_ms,
        cost=cost,
        input_tokens=tokens.prompt if tokens else None,
        output_tokens=tokens.completion if tokens else None,
        cache_read_tokens=tokens.cache_read if tokens else None,
        cache_write_tokens=tokens.cache_write if tokens else None,
        reasoning_tokens=tokens.reasoning if tokens else None,
        total_tokens=total_tokens,
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
        is_streaming=is_streaming,
    )
    try:
        log_request(db, entry)
    except Exception:
        logger.warning("public gateway: log_request failed", exc_info=True)


def _record_usage(
    ctx: KeyContext, provider: Provider, model: AIModel, *, tokens: int, cost: Decimal
) -> None:
    try:
        record_usage(
            ctx,
            tokens=tokens,
            cost=cost,
            provider_id=provider.id,
            model_id=model.id,
        )
    except Exception:
        logger.warning("public gateway: record_usage failed", exc_info=True)


# --- request preparation -----------------------------------------------------------


@dataclass
class _Prepared:
    ctx: KeyContext
    meta: ClientMeta
    unified: UnifiedRequest
    provider: Provider
    model: AIModel
    adapter: BaseProviderAdapter
    messages: list[Any]
    history_text: str
    started: float
    provider_label: str = field(init=False)
    model_label: str = field(init=False)

    def __post_init__(self) -> None:
        self.provider_label = self.provider.provider_type.value.lower()
        self.model_label = self.model.model_id


def _prepare(
    db: Session, ctx: KeyContext, unified: UnifiedRequest, meta: ClientMeta
) -> _Prepared:
    """Resolve, authorize, rate-limit and build the adapter before any I/O."""
    resolved: ResolvedModel = resolve_model(db, unified.model_identifier, ctx.user_id)
    provider, model = resolved.provider, resolved.model
    if not ctx.model_allowed(provider.id, model.id):
        raise ForbiddenError("model_not_allowed")
    decision = check_request(
        ctx,
        provider_id=provider.id,
        model_id=model.id,
        estimated_tokens=_prompt_tokens(unified),
        estimated_cost=_estimated_cost(db, provider, model, unified),
    )
    if not decision.allowed:
        raise _LimitsDenied(_denied_result(decision))
    credentials = decrypted_credentials(provider)
    adapter = build_adapter(provider, model, credentials)
    adapter.max_output_tokens = model.max_output_tokens
    messages = unified.as_chat_messages()
    return _Prepared(
        ctx=ctx,
        meta=meta,
        unified=unified,
        provider=provider,
        model=model,
        adapter=adapter,
        messages=messages,
        history_text="".join(message.content for message in messages),
        started=time.monotonic(),
    )


# --- non-streaming execution ----------------------------------------------------------


async def execute_unified(
    db: Session,
    ctx: KeyContext,
    unified: UnifiedRequest,
    meta: ClientMeta,
) -> ChatOutcome | MediaOutcome | StreamResult | DeniedResult:
    """Authorize and run one public request, or return its SSE iterator.

    Always records one API log row: success, stream end, disconnect or failure.
    """
    started = time.monotonic()
    try:
        prepared = _prepare(db, ctx, unified, meta)
    except _LimitsDenied as denied:
        _log_request(
            db, ctx, meta, unified,
            status="failed",
            model_label=unified.model_identifier or None,
            error_code=denied.result.payload["error"]["code"],
            latency_ms=(time.monotonic() - started) * 1000,
        )
        return denied.result
    except Exception as exc:
        _log_request(
            db, ctx, meta, unified,
            status="failed",
            model_label=unified.model_identifier or None,
            error_code=_error_code(exc),
            latency_ms=(time.monotonic() - started) * 1000,
        )
        raise
    if unified.stream and unified.endpoint in CHAT_ENDPOINTS:
        return StreamResult(iterator=_stream_chat(prepared, db))
    if unified.endpoint in CHAT_ENDPOINTS:
        return await _execute_chat(db, prepared)
    return await _execute_media(db, prepared)


async def _execute_chat(db: Session, prepared: _Prepared) -> ChatOutcome:
    started = prepared.started
    try:
        result = await prepared.adapter.chat(prepared.messages)
        latency_ms = (time.monotonic() - started) * 1000
        tokens, total, breakdown, estimated = _finalize_usage(
            db, prepared.provider, prepared.model, prepared.history_text, result.text, result
        )
        _record_usage(
            prepared.ctx, prepared.provider, prepared.model,
            tokens=total, cost=breakdown.total_cost,
        )
        _log_request(
            db, prepared.ctx, prepared.meta, prepared.unified,
            status="success",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            latency_ms=latency_ms,
            cost=breakdown.total_cost,
            tokens=tokens,
            total_tokens=total,
        )
        logger.info(
            "public gateway chat: key=%s model=%s tokens=%s cost=%s latency=%.0fms",
            prepared.ctx.key_prefix, prepared.model_label, total, breakdown.total_cost, latency_ms,
        )
        return ChatOutcome(
            request_id=prepared.meta.request_id,
            model_identifier=prepared.unified.model_identifier,
            provider_label=prepared.provider_label,
            text=result.text,
            usage=tokens,
            total_tokens=total,
            breakdown=breakdown,
            latency_ms=latency_ms,
            estimated=estimated,
        )
    except Exception as exc:
        latency_ms = (time.monotonic() - started) * 1000
        classified = classify_provider_failure(exc)
        _log_request(
            db, prepared.ctx, prepared.meta, prepared.unified,
            status="failed",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            error_code=classified.code.value,
            latency_ms=latency_ms,
        )
        raise classified from exc


def _pick_options(method: Any, options: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    parameters = inspect.signature(method).parameters
    return {
        key: options[key]
        for key in keys
        if key in parameters and options.get(key) is not None
    }


async def _execute_media(db: Session, prepared: _Prepared) -> MediaOutcome:
    started = prepared.started
    unified = prepared.unified
    options = dict(unified.media_options)
    adapter = prepared.adapter
    try:
        if unified.endpoint == "videos":
            payload = await dispatch.call_endpoint(
                adapter,
                "video/generations",
                prompt=unified.prompt,
                options=_pick_options(adapter.generate_video, options, ("size", "seconds")),
            )
            payloads = [payload]
            is_video = True
        else:
            edit_image: bytes | None = None
            if unified.endpoint == "image_edits":
                raw_image = options.get("image")
                if "image" not in inspect.signature(adapter.generate_image).parameters:
                    raise ProviderError(
                        f"model {prepared.model_label} does not support image editing"
                    )
                try:
                    edit_image = base64.b64decode(str(raw_image or ""), validate=True)
                except Exception:
                    raise ValidationError("image must be valid base64") from None
            kwargs = _pick_options(adapter.generate_image, options, ("size", "quality"))
            if edit_image is not None:
                kwargs["image"] = edit_image
            count = max(1, int(options.get("n") or 1))
            payloads = [
                await dispatch.call_endpoint(
                    adapter, "images/generations", prompt=unified.prompt, options=kwargs
                )
                for _ in range(count)
            ]
            is_video = False
        cost, estimated = _media_cost(db, prepared, options, payloads)
        _record_usage(
            prepared.ctx, prepared.provider, prepared.model,
            tokens=0, cost=cost,
        )
        latency_ms = (time.monotonic() - started) * 1000
        _log_request(
            db, prepared.ctx, prepared.meta, unified,
            status="success",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            latency_ms=latency_ms,
            cost=cost,
        )
        logger.info(
            "public gateway media: key=%s model=%s endpoint=%s cost=%s latency=%.0fms",
            prepared.ctx.key_prefix, prepared.model_label, unified.endpoint, cost, latency_ms,
        )
        return MediaOutcome(
            request_id=prepared.meta.request_id,
            model_identifier=unified.model_identifier,
            provider_label=prepared.provider_label,
            endpoint=unified.endpoint,
            payloads=payloads,
            is_video=is_video,
            cost=cost,
            estimated=estimated,
            latency_ms=latency_ms,
        )
    except Exception as exc:
        latency_ms = (time.monotonic() - started) * 1000
        classified = classify_provider_failure(exc)
        _log_request(
            db, prepared.ctx, prepared.meta, unified,
            status="failed",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            error_code=classified.code.value,
            latency_ms=latency_ms,
        )
        raise classified from exc


def _media_cost(
    db: Session, prepared: _Prepared, options: dict[str, Any], payloads: list[bytes]
) -> tuple[Decimal, bool]:
    """Provider-reported cost when available, else the rate-card estimate."""
    provider, model = prepared.provider, prepared.model
    if prepared.unified.endpoint == "videos":
        card = _media_rate_card_for(db, provider, model)
        estimate = estimate_video_cost(
            model_id=model.model_id,
            seconds=options.get("seconds"),
            size=options.get("size"),
            price_per_second=card.video_per_second,
        )
        return estimate.estimated_cost, True
    usage = getattr(prepared.adapter, "last_media_usage", None)
    count = max(1, len(payloads))
    if isinstance(usage, dict) and usage.get("output_tokens"):
        details = usage.get("input_tokens_details") or {}
        actual = actual_image_cost(
            model_id=model.model_id,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            text_input_tokens=details.get("text_tokens"),
            image_input_tokens=details.get("image_tokens"),
        )
        if actual is not None:
            return actual.estimated_cost * count, False
    card = _media_rate_card_for(db, provider, model)
    estimate = estimate_image_cost(
        model_id=model.model_id,
        quality=options.get("quality"),
        size=options.get("size"),
        count=count,
        low=card.image_low,
        medium=card.image_medium,
        high=card.image_high,
    )
    return estimate.estimated_cost, True


# --- streaming ----------------------------------------------------------------------


def _sse(payload: dict, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _absorb(target: ChatResult, chunk: StreamChunk) -> None:
    if chunk.prompt_tokens is not None:
        target.prompt_tokens = chunk.prompt_tokens
    if chunk.completion_tokens is not None:
        target.completion_tokens = chunk.completion_tokens
    if chunk.total_tokens is not None:
        target.total_tokens = chunk.total_tokens
    if chunk.cache_read_tokens is not None:
        target.cache_read_tokens = chunk.cache_read_tokens
    if chunk.cache_write_tokens is not None:
        target.cache_write_tokens = chunk.cache_write_tokens
    if chunk.reasoning_tokens is not None:
        target.reasoning_tokens = chunk.reasoning_tokens


def _usage_details(tokens: UsageTokens, total: int) -> dict[str, Any]:
    usage: dict[str, Any] = {
        "prompt_tokens": tokens.prompt,
        "completion_tokens": tokens.completion,
        "total_tokens": total,
    }
    if tokens.cache_read or tokens.cache_write:
        usage["prompt_tokens_details"] = {"cached_tokens": tokens.cache_read}
    if tokens.reasoning:
        usage["completion_tokens_details"] = {"reasoning_tokens": tokens.reasoning}
    return usage


async def _stream_chat(prepared: _Prepared, db: Session) -> AsyncIterator[str]:
    """Streaming chat: immediate SSE, usage from the terminal chunk, one log."""
    fmt = prepared.unified.response_format or "openai"
    created = int(time.time())
    prefixes = {"openai": "chatcmpl-", "responses": "resp_", "anthropic": "msg_"}
    stream_id = prefixes.get(fmt, "chatcmpl-") + uuid.uuid4().hex[:24]
    item_id = "msg_" + uuid.uuid4().hex[:24]
    result = ChatResult(text="")
    logged = False
    sequence = 0

    def _delta(text: str) -> list[str]:
        nonlocal sequence
        if fmt == "anthropic":
            return [
                _sse(
                    {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": text},
                    },
                    "content_block_delta",
                )
            ]
        if fmt == "responses":
            payload = {
                "type": "response.output_text.delta",
                "sequence_number": sequence,
                "item_id": item_id,
                "output_index": 0,
                "content_index": 0,
                "delta": text,
            }
            sequence += 1
            return [_sse(payload, "response.output_text.delta")]
        return [
            _sse(
                {
                    "id": stream_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [
                        {"index": 0, "delta": {"content": text}, "finish_reason": None}
                    ],
                }
            )
        ]

    def _open() -> list[str]:
        nonlocal sequence
        if fmt == "anthropic":
            return [
                _sse(
                    {
                        "type": "message_start",
                        "message": {
                            "id": stream_id,
                            "type": "message",
                            "role": "assistant",
                            "model": model,
                            "content": [],
                            "stop_reason": None,
                            "stop_sequence": None,
                            "usage": {"input_tokens": 0, "output_tokens": 0},
                        },
                    },
                    "message_start",
                ),
                _sse(
                    {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {"type": "text", "text": ""},
                    },
                    "content_block_start",
                ),
            ]
        if fmt == "responses":
            payload = {
                "type": "response.created",
                "sequence_number": sequence,
                "response": {
                    "id": stream_id,
                    "object": "response",
                    "created_at": created,
                    "status": "in_progress",
                    "model": model,
                },
            }
            sequence += 1
            return [_sse(payload, "response.created")]
        return []

    def _close(tokens: UsageTokens, total: int) -> list[str]:
        nonlocal sequence
        if fmt == "anthropic":
            return [
                _sse({"type": "content_block_stop", "index": 0}, "content_block_stop"),
                _sse(
                    {
                        "type": "message_delta",
                        "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                        "usage": {
                            "input_tokens": tokens.prompt,
                            "output_tokens": tokens.completion,
                        },
                    },
                    "message_delta",
                ),
                _sse({"type": "message_stop"}, "message_stop"),
            ]
        if fmt == "responses":
            payload = {
                "type": "response.completed",
                "sequence_number": sequence,
                "response": {
                    "id": stream_id,
                    "object": "response",
                    "created_at": created,
                    "status": "completed",
                    "model": model,
                    "output": [
                        {
                            "type": "message",
                            "id": item_id,
                            "status": "completed",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": result.text, "annotations": []}],
                        }
                    ],
                    "usage": {
                        "input_tokens": tokens.prompt,
                        "output_tokens": tokens.completion,
                        "total_tokens": total,
                    },
                },
            }
            sequence += 1
            return [_sse(payload, "response.completed")]
        return [
            _sse(
                {
                    "id": stream_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [],
                    "usage": _usage_details(tokens, total),
                }
            ),
            "data: [DONE]\n\n",
        ]

    def _error(classified: ApplicationException) -> list[str]:
        if fmt == "anthropic":
            payload = {
                "type": "error",
                "error": {"type": "api_error", "message": classified.message},
            }
            return [_sse(payload, "error")]
        if fmt == "responses":
            payload = {"type": "error", "code": classified.code.value, "message": classified.message}
            return [_sse(payload, "error")]
        payload = {
            "error": {
                "message": classified.message,
                "type": classified.code.value.lower(),
                "code": classified.code.value,
            }
        }
        return [_sse(payload), "data: [DONE]\n\n"]

    model = prepared.unified.model_identifier
    for frame in _open():
        yield frame
    try:
        async for chunk in prepared.adapter.chat_stream(prepared.messages):
            _absorb(result, chunk)
            if chunk.delta:
                result.text += chunk.delta
                for frame in _delta(chunk.delta):
                    yield frame
        tokens, total, breakdown, estimated = _finalize_usage(
            db, prepared.provider, prepared.model, prepared.history_text, result.text, result
        )
        _record_usage(
            prepared.ctx, prepared.provider, prepared.model,
            tokens=total, cost=breakdown.total_cost,
        )
        latency_ms = (time.monotonic() - prepared.started) * 1000
        _log_request(
            db, prepared.ctx, prepared.meta, prepared.unified,
            status="success",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            latency_ms=latency_ms,
            cost=breakdown.total_cost,
            tokens=tokens,
            total_tokens=total,
            is_streaming=True,
        )
        logged = True
        logger.info(
            "public gateway stream done: key=%s model=%s tokens=%s cost=%s latency=%.0fms",
            prepared.ctx.key_prefix, prepared.model_label, total, breakdown.total_cost, latency_ms,
        )
        for frame in _close(tokens, total):
            yield frame
    except asyncio.CancelledError:
        if not logged:
            _log_request(
                db, prepared.ctx, prepared.meta, prepared.unified,
                status="cancelled",
                provider_label=prepared.provider_label,
                model_label=prepared.model_label,
                latency_ms=(time.monotonic() - prepared.started) * 1000,
                is_streaming=True,
            )
        raise
    except Exception as exc:
        classified = classify_provider_failure(exc)
        if not logged:
            _log_request(
                db, prepared.ctx, prepared.meta, prepared.unified,
                status="failed",
                provider_label=prepared.provider_label,
                model_label=prepared.model_label,
                error_code=classified.code.value,
                latency_ms=(time.monotonic() - prepared.started) * 1000,
                is_streaming=True,
            )
            logged = True
        logger.warning(
            "public gateway stream failed: key=%s model=%s error=%s",
            prepared.ctx.key_prefix, prepared.model_label, classified.message,
        )
        for frame in _error(classified):
            yield frame


# --- model listing ------------------------------------------------------------------


def list_public_models(db: Session, ctx: KeyContext) -> list[tuple[Provider, AIModel]]:
    """Active models owned by the key's user that the key is allowed to call."""
    rows = db.execute(
        select(Provider, AIModel)
        .join(AIModel, AIModel.provider_id == Provider.id)
        .where(
            Provider.user_id == ctx.user_id,
            Provider.is_deleted.is_(False),
            Provider.is_active.is_(True),
            AIModel.is_deleted.is_(False),
            AIModel.is_active.is_(True),
        )
        .order_by(Provider.name, AIModel.model_id)
    )
    return [
        (provider, model)
        for provider, model in rows
        if ctx.model_allowed(provider.id, model.id)
    ]
