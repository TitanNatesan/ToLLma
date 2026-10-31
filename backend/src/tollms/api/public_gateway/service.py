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
    AccountPendingDeletionError,
    AuthenticationError,
    ErrorCode,
    ForbiddenError,
    NotFoundError,
    ProviderError,
    ValidationError,
    classify_provider_failure,
)
from tollms.core.sessions import client_meta as _request_client_meta
from tollms.core.sessions import gateway_client_ip
from tollms.services.gateway import key_policy
from tollms.api.providers.service import decrypted_credentials, request_revalidation
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
from tollms.services.gateway.adapters.base import (
    BaseProviderAdapter,
    ChatResult,
    StreamChunk,
    _accumulate_tool_call,
)
from tollms.services.gateway.api_logs import ApiLogEntry, log_request
from tollms.services.gateway.costing import (
    CostBreakdown,
    UsageTokens,
    calculate,
    prices_for_model,
)
from tollms.services.gateway.factory import build_adapter
from tollms.services.gateway.limits import LimitsDecision, check_request, record_usage
from tollms.services.gateway import key_policy as key_policy_engine
from tollms.services.gateway.model_resolution import ResolvedModel, resolve_model
from tollms.services.gateway.unified import UnifiedRequest
from tollms.services.model_repository.lookup import find_for_model
from tollms.services.observability.events import emit, incr_counter

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


def policy_client_ip(request: Request) -> str | None:
    """Policy-grade client IP for key checks (XFF only behind a trusted peer)."""
    return gateway_client_ip(request) or None


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
    # Normalized tool calls [{"id", "name", "arguments"}] + provider stop reason.
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    finish_reason: str | None = None


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


def _ip_allowed(ctx: KeyContext, ip_text: str | None) -> bool:
    """Shared deny-wins IP rules (see `services.gateway.key_policy`)."""
    return key_policy.ip_allowed(ctx, ip_text)


def _deny_event(
    *,
    reason: str,
    key_prefix: str | None = None,
    endpoint: str | None = None,
    retry_after: bool = False,
    status_code: int | None = None,
) -> None:
    """One structured pre-call deny event + metrics counter (no behavior change)."""
    emit(
        "gateway.denied",
        reason=reason,
        key_prefix=key_prefix or "unknown",
        endpoint=endpoint or "unknown",
        retry_after=retry_after,
        status_code=status_code,
    )
    incr_counter("gateway.denied", {"reason": reason})


def _provider_error_event(
    *, code: str, endpoint: str | None, key_prefix: str | None = None
) -> None:
    """One structured provider-failure event + counter (code + endpoint, no prompts)."""
    emit(
        "gateway.provider_error",
        code=code,
        endpoint=endpoint or "unknown",
        key_prefix=key_prefix or "unknown",
    )
    incr_counter("gateway.provider_error", {"code": code})


def api_key_required(request: Request, db: Session = Depends(get_db)) -> KeyContext:
    """Authenticate `Authorization: Bearer` / `x-api-key` into a KeyContext."""
    raw = parse_bearer(request.headers.get("authorization"), request.headers.get("x-api-key"))
    if not raw:
        _deny_event(reason="auth", status_code=401)
        raise AuthenticationError("missing API key")
    ctx = authenticate(db, raw)
    if ctx is None:
        _deny_event(reason="auth", status_code=401)
        raise AuthenticationError("invalid API key")
    if ctx.owner_is_deleted or not ctx.owner_is_active:
        _deny_event(reason="owner", key_prefix=ctx.key_prefix, status_code=403)
        raise ForbiddenError("API key owner account is disabled")
    if ctx.owner_pending_deletion:
        _deny_event(reason="pending", key_prefix=ctx.key_prefix, status_code=403)
        raise AccountPendingDeletionError("Account scheduled for deletion.")
    if not ctx.enabled:
        _deny_event(reason="disabled", key_prefix=ctx.key_prefix, status_code=403)
        raise ForbiddenError("API key is disabled")
    if ctx.is_expired():
        _deny_event(reason="expired", key_prefix=ctx.key_prefix, status_code=403)
        raise ForbiddenError("API key is expired")
    if not _ip_allowed(ctx, policy_client_ip(request)):
        _deny_event(reason="ip", key_prefix=ctx.key_prefix, status_code=403)
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
    usage_estimated: bool = False,
) -> None:
    entry = ApiLogEntry(
        request_id=meta.request_id,
        api_key_id=ctx.key_id,
        user_id=ctx.user_id,
        # Server-derived attribution: the resolving key's org (None = personal).
        org_id=getattr(ctx, "org_id", None),
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
        usage_estimated=usage_estimated,
    )
    try:
        log_request(db, entry)
    except Exception:
        logger.warning("public gateway: log_request failed", exc_info=True)
    # Metrics-only request counter per plane + status (fail-open; the DB row above is the record).
    incr_counter("gateway.request", {"plane": "public", "status": status})


def _org_cap_usd(db: Session, ctx: KeyContext) -> Decimal | None:
    """Live org spend cap (shared helper; None = personal key or uncapped)."""
    return key_policy.org_cap_usd(db, ctx)


def _record_usage(
    ctx: KeyContext,
    provider: Provider,
    model: AIModel,
    *,
    tokens: int,
    cost: Decimal,
    request_id: str | None = None,
    org_cap: Decimal | None = None,
) -> None:
    try:
        record_usage(
            ctx,
            tokens=tokens,
            cost=cost,
            provider_id=provider.id,
            model_id=model.id,
            request_id=request_id,
            org_max_spend_usd=org_cap,
        )
    except Exception:
        logger.warning("public gateway: record_usage failed", exc_info=True)


def _release_reservation(prepared: "_Prepared") -> None:
    """Refund the pre-flight reservation when a call ends with no billable usage."""
    _record_usage(
        prepared.ctx, prepared.provider, prepared.model,
        tokens=0, cost=Decimal(0), request_id=prepared.meta.request_id,
        org_cap=prepared.org_cap,
    )


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
    org_cap: Decimal | None = None

    def __post_init__(self) -> None:
        self.provider_label = self.provider.provider_type.value.lower()
        self.model_label = self.model.model_id


# Endpoint -> required model capability. Chat endpoints require nothing
# beyond text (default True); media endpoints are gated on their flag.
ENDPOINT_CAPABILITY: dict[str, str] = {
    "images": "supports_image_generation",
    "image_edits": "supports_image_generation",
    "videos": "supports_video_generation",
}


def _require_capability(model, endpoint: str) -> None:
    flag = ENDPOINT_CAPABILITY.get(endpoint)
    if flag is not None and not getattr(model, flag, False):
        raise ForbiddenError(f"model_not_allowed: {model.model_id} lacks {flag} for {endpoint}")


# Reasoning request markers that mean "thinking off" (adapters omit thinking
# fields for these, so they must not trip the supports_reasoning gate).
_REASONING_OFF_LEVELS = frozenset({"none", "default"})


def _reasoning_requested(unified: UnifiedRequest) -> bool:
    """True when the client asked for reasoning output on this chat call."""
    level = unified.reasoning_level or (unified.raw or {}).get("reasoning_level")
    if isinstance(level, str) and level.strip() and level.strip().lower() not in _REASONING_OFF_LEVELS:
        return True
    raw = unified.raw or {}
    for key in ("reasoning_effort", "reasoning", "thinking", "effort"):
        value = raw.get(key)
        if value:
            return True
    return False


def _require_chat_capabilities(model, unified: UnifiedRequest) -> None:
    """Gate chat features on model flags. Same 403 shape as the media gate.

    Defaults keep existing callers working: text and streaming are assumed
    unless the model opts out; tools/vision/reasoning are assumed absent
    unless the model declares them.
    """
    if not getattr(model, "supports_text", True):
        raise ForbiddenError(
            f"model_not_allowed: {model.model_id} lacks supports_text for {unified.endpoint}"
        )
    # Tools gate: explicit 403, never a silent strip. Fail-open was considered
    # and rejected: an incapable model must surface model_not_allowed here
    # instead of a downstream provider 400. Models that serve tools declare
    # supports_tool_calling (flipping the flag re-allows them, locked by the
    # tool-gate hardening test); the provider always decides the final shape.
    if unified.tools and not getattr(model, "supports_tool_calling", False):
        raise ForbiddenError(
            f"model_not_allowed: {model.model_id} lacks supports_tool_calling for {unified.endpoint}"
        )
    if any(part.kind == "image" for message in unified.messages for part in message.media):
        if not getattr(model, "supports_vision", False):
            raise ForbiddenError(
                f"model_not_allowed: {model.model_id} lacks supports_vision for {unified.endpoint}"
            )
    if _reasoning_requested(unified) and not getattr(model, "supports_reasoning", False):
        raise ForbiddenError(
            f"model_not_allowed: {model.model_id} lacks supports_reasoning for {unified.endpoint}"
        )
    if unified.stream and not getattr(model, "supports_streaming", True):
        raise ForbiddenError(
            f"model_not_allowed: {model.model_id} lacks supports_streaming for {unified.endpoint}"
        )


def _caller_org_ids(db: Session, ctx: KeyContext) -> list:
    """Org scope for model resolution, pinned to the key itself.

    Personal key -> [] (personal scope only). Org key -> exactly
    [ctx.org_id] (the key's own org ONLY — never the assignee's other ACTIVE
    orgs). `authenticate` already 401s org keys whose assignee lost ACTIVE
    membership, so the pin needs no live membership re-check here.
    """
    if getattr(ctx, "org_id", None) is None:
        return []
    return [ctx.org_id]


def _prepare(
    db: Session, ctx: KeyContext, unified: UnifiedRequest, meta: ClientMeta
) -> _Prepared:
    """Resolve, authorize, rate-limit and build the adapter before any I/O."""
    resolved: ResolvedModel = resolve_model(
        db, unified.model_identifier, ctx.user_id, org_ids=_caller_org_ids(db, ctx) or None,
    )
    provider, model = resolved.provider, resolved.model
    # Scope pin (404, no existence oracle beyond scope): org keys serve only
    # their own org's providers; personal keys serve only their own personal
    # rows. The resolver already scopes this way — the pin holds even if
    # resolution ever widens.
    if ctx.org_id is not None:
        if provider.org_id != ctx.org_id:
            raise NotFoundError(f"model not found: {unified.model_identifier}")
    elif provider.org_id is not None or provider.user_id != ctx.user_id:
        raise NotFoundError(f"model not found: {unified.model_identifier}")
    if not ctx.model_allowed(provider.id, model.id):
        raise ForbiddenError("model_not_allowed")
    _require_capability(model, unified.endpoint)
    if unified.endpoint in CHAT_ENDPOINTS:
        _require_chat_capabilities(model, unified)
    # Guardrail pre: after capability gates, before limits.check_request.
    # Blocks raise 403; warns are logged+emitted (no response metadata field).
    _guardrail_pre(db, ctx, unified, provider, model, meta)
    org_cap = _org_cap_usd(db, ctx)
    estimated_cost = _estimated_cost(db, provider, model, unified)
    # Same stored-spend truth as the in-app gate: deny when Postgres already
    # covers a cap even if the Valkey counters are cold (flush/restart) or
    # behind. Identical rule on both planes — no bypass by switching surface.
    pg_deny = key_policy_engine.postgres_deny(db, ctx, estimated_cost)
    if pg_deny is not None:
        reason, retry_after = pg_deny
        # Same observability as a Valkey denial (`check_request` counts via
        # `_count_denied`; this path never reaches it, so count here — the
        # `_LimitsDenied` handler below emits the event but does not count).
        incr_counter("gateway.denied", {"reason": reason})
        raise _LimitsDenied(
            _denied_result(LimitsDecision(allowed=False, reason=reason, status_code=403, retry_after=retry_after))
        )
    decision = check_request(
        ctx,
        provider_id=provider.id,
        model_id=model.id,
        estimated_tokens=_prompt_tokens(unified),
        estimated_cost=estimated_cost,
        request_id=meta.request_id,
        org_max_spend_usd=org_cap,
    )
    if not decision.allowed:
        raise _LimitsDenied(_denied_result(decision))
    try:
        credentials = decrypted_credentials(provider)
        adapter = build_adapter(provider, model, credentials)
    except Exception:
        # Reservation is stashed but no provider call happens — refund so a
        # credential/adapter failure leaves no phantom spend. Deny paths above
        # roll back inside `check_request` and never reach here.
        _record_usage(
            ctx, provider, model,
            tokens=0, cost=Decimal(0), request_id=meta.request_id,
            org_cap=org_cap,
        )
        raise
    adapter.max_output_tokens = model.max_output_tokens
    # Prompt-cache plan, same engine as internal Chat: Bedrock Claude ids get
    # cachePoints when the model declares support; OpenAI gets a stable
    # per-(provider,model) key shared with the internal plane (cross-plane
    # prefix reuse); implicit families stay byte-identical.
    from tollms.api.gateway.service import caching_for_model as _plan_for

    adapter.prompt_cache = _plan_for(db, provider, model, None)
    messages = unified.as_chat_messages()
    prepared = _Prepared(
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
    prepared.org_cap = org_cap
    return prepared




def _guardrail_invocation_parts(unified: UnifiedRequest) -> list[str]:
    """Invocation names/inputs from message extras (all roles).

    Shared by the full scan text and the tool-action corpus: tool_calls
    names/arguments, tool_use names/inputs, response function_call
    names/arguments. Tool DEFINITIONS are never included here.
    """
    parts: list[str] = []
    for message in unified.messages:
        extra = message.extra or {}
        for call in extra.get("tool_calls") or []:
            function = call.get("function") or {}
            if function.get("name"):
                parts.append(f"tool_call:{function['name']}")
            if function.get("arguments"):
                parts.append(str(function["arguments"])[:2000])
        for block in extra.get("blocks") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("name"):
                parts.append(f"tool_call:{block['name']}")
            if block.get("input") is not None:
                parts.append(json.dumps(block["input"], sort_keys=True, default=str)[:2000])
        item = extra.get("response_item")
        if isinstance(item, dict) and item.get("type") == "function_call":
            if item.get("name"):
                parts.append(f"tool_call:{item['name']}")
            if item.get("arguments"):
                parts.append(str(item["arguments"])[:2000])
    return parts


def _guardrail_action_text(unified: UnifiedRequest) -> str:
    """Tool-action corpus: user content + invocation names/inputs only.

    Tool Action governs attempted ACTIONS, never static capability
    declarations: tool definitions/descriptions/schemas, system prompts and
    assistant text are excluded. The gateway never executes tools (execution
    is client-side); a risky chain is killed when the user requests it (pre)
    or the model emits/instructs it (post). Definitions/summaries never match.
    """
    parts = [message.content for message in unified.messages
             if (message.role or "").lower() == "user" and message.content]
    parts.extend(_guardrail_invocation_parts(unified))
    return "\n".join(part for part in parts if part)


def _guardrail_post_action_text(text: str, tool_calls: list[dict] | None) -> str:
    """Post-stage action corpus: assistant output text + emitted tool_use.

    An emitted tool_use IS an invocation attempt, so its name/inputs join
    the corpus. Tool definitions never exist post-side.
    """
    parts = [text] if (text or "").strip() else []
    for call in tool_calls or []:
        if not isinstance(call, dict):
            continue
        if call.get("name"):
            parts.append(f"tool_call:{call['name']}")
        if call.get("arguments"):
            parts.append(str(call["arguments"])[:2000])
    return "\n".join(part for part in parts if part)


def _guardrail_text(unified: UnifiedRequest) -> str:
    """Scannable pre-check text: message content plus tool names and inputs.

    Tool definitions and tool_use/tool_calls arguments ride along as plain
    text so injection and policy scans see them. The forwarded request itself
    is untouched: tools are never stripped here.
    """
    parts = [message.content for message in unified.as_chat_messages() if message.content]
    for tool in unified.tools or []:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function") if isinstance(tool.get("function"), dict) else {}
        name = tool.get("name") or function.get("name")
        if name:
            parts.append(f"tool:{name}")
        description = tool.get("description") or function.get("description")
        if description:
            parts.append(str(description)[:2000])
        schema = tool.get("input_schema") or function.get("parameters")
        if schema is not None:
            parts.append(json.dumps(schema, sort_keys=True, default=str)[:2000])
    parts.extend(_guardrail_invocation_parts(unified))
    return "\n".join(part for part in parts if part)


def _guardrail_pre(db: Session, ctx: KeyContext, unified: UnifiedRequest,
                   provider: Provider, model: AIModel, meta: ClientMeta) -> None:
    """Public-plane pre hook. Lazy import: guardrail engines never import api."""
    try:
        from tollms.services.guardrails import enforcement as guardrail_enforcement

        guardrail_enforcement.check_pre_sync(
            db, text=_guardrail_text(unified),
            action_text=_guardrail_action_text(unified),
            user_id=ctx.user_id, org_id=getattr(ctx, "org_id", None),
            provider_id=provider.id, model_id=model.id, api_key_id=ctx.key_id,
            source="external", endpoint=unified.endpoint,
            request_id=meta.request_id)
    except (ForbiddenError, NotFoundError):
        raise
    except Exception:
        logger.warning("public gateway guardrail pre failed (fail-open)", exc_info=True)


def _guardrail_post(db: Session, prepared: "_Prepared", text: str, *,
                    allow_block: bool,
                    tool_calls: list[dict[str, Any]] | None = None) -> str:
    """Public-plane post hook: audit-first, never raises, never touches Valkey
    usage counters. Streaming callers pass allow_block=False (delivery already
    happened — a blocked verdict is still recorded as blocked, never
    downgraded)."""
    try:
        from tollms.services.guardrails import enforcement as guardrail_enforcement

        return guardrail_enforcement.record_post_sync(
            db, text=text or "",
            action_text=_guardrail_post_action_text(text or "", tool_calls),
            user_id=prepared.ctx.user_id,
            org_id=getattr(prepared.ctx, "org_id", None),
            provider_id=prepared.provider.id, model_id=prepared.model.id,
            api_key_id=prepared.ctx.key_id, source="external",
            endpoint=prepared.unified.endpoint,
            request_id=prepared.meta.request_id, generation_id=None,
            allow_block=allow_block)
    except Exception:
        logger.warning("public gateway guardrail post failed", exc_info=True)
        return "allowed"


async def _promptlog_capture(db: Session, prepared: _Prepared, *,
                       input_text: str | None, output_text: str | None,
                       status: str, error_code: str | None = None,
                       latency_ms: float | None = None,
                       tokens: UsageTokens | None = None) -> None:
    """Prompt-log hook: immutable ledger write, fail-open always. Never raises,
    never touches Valkey usage counters, never logs content or raw keys."""
    try:
        from tollms.services.prompt_logging import queue as promptlog_queue

        ctx = prepared.ctx
        promptlog_queue.enqueue_post(
            db, input_text=input_text, output_text=output_text,
            user_id=ctx.user_id, org_id=getattr(ctx, "org_id", None),
            api_key_id=ctx.key_id,
            key_provenance=("organization" if getattr(ctx, "org_id", None)
                            is not None else "personal"),
            provider_id=prepared.provider.id, model_id=prepared.model.id,
            conversation_id=None, endpoint=prepared.unified.endpoint,
            source="external", request_id=prepared.meta.request_id,
            generation_id=None, status=status,
            tokens=({"prompt": tokens.prompt, "completion": tokens.completion}
                    if tokens is not None else None),
            latency_ms=latency_ms, error_code=error_code, allow_store=True)
    except Exception:
        logger.warning("public gateway promptlog hook failed", exc_info=True)


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
        error = denied.result.payload.get("error", {})
        emit(
            "gateway.denied",
            reason=str(error.get("message") or "rate_limited"),
            key_prefix=ctx.key_prefix,
            endpoint=unified.endpoint,
            retry_after=bool(denied.result.headers),
            status_code=denied.result.status_code,
        )
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
        if isinstance(exc, ForbiddenError):
            # Model/capability policy deny from _prepare (limits denies return above).
            message = getattr(exc, "message", "") or ""
            reason = "model" if message == "model_not_allowed" else "capability"
            _deny_event(
                reason=reason, key_prefix=ctx.key_prefix,
                endpoint=unified.endpoint, status_code=exc.status_code,
            )
        raise
    if unified.stream and unified.endpoint in CHAT_ENDPOINTS:
        # Eager tool-shape check: _stream_chat recomputes the same kwargs
        # lazily on first iteration (status already 200 there), so validate
        # here to keep the 403 model_not_allowed shape identical to the
        # non-streaming path.
        _tool_kwargs(prepared.adapter.chat_stream, prepared.unified)
        return StreamResult(iterator=_stream_chat(prepared, db))
    if unified.endpoint in CHAT_ENDPOINTS:
        return await _execute_chat(db, prepared)
    return await _execute_media(db, prepared)


def _tool_kwargs(method: Any, unified: UnifiedRequest) -> dict[str, Any]:
    """Tool passthrough for adapters that declare it; older doubles keep working.

    Explicit 403, never a silent strip: tools requested of an adapter with
    no tools param (Bedrock/Gemini/Vertex chat_stream) raise the same
    model_not_allowed ForbiddenError as the capability gate instead of
    returning text-only success with the tools dropped.
    """
    try:
        params = inspect.signature(method).parameters
    except (TypeError, ValueError):
        params = {}
    if "tools" not in params:
        if unified.tools:
            raise ForbiddenError(
                f"model_not_allowed: {unified.model_identifier} adapter lacks "
                f"tools support for {unified.endpoint}"
            )
        return {}
    return {"tools": unified.tools, "tool_choice": unified.tool_choice}


async def _execute_chat(db: Session, prepared: _Prepared) -> ChatOutcome:
    started = prepared.started
    try:
        result = await prepared.adapter.chat(
            prepared.messages, **_tool_kwargs(prepared.adapter.chat, prepared.unified)
        )
        latency_ms = (time.monotonic() - started) * 1000
        tokens, total, breakdown, estimated = _finalize_usage(
            db, prepared.provider, prepared.model, prepared.history_text, result.text, result
        )
        _record_usage(
            prepared.ctx, prepared.provider, prepared.model,
            tokens=total, cost=breakdown.total_cost,
            request_id=prepared.meta.request_id,
            org_cap=prepared.org_cap,
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
            usage_estimated=estimated,
        )
        logger.info(
            "public gateway chat: key=%s model=%s tokens=%s cost=%s latency=%.0fms",
            prepared.ctx.key_prefix, prepared.model_label, total, breakdown.total_cost, latency_ms,
        )
        # Guardrail rule: this non-streaming path withholds delivery on a
        # blocked buffer_then_inspect verdict, so the ledger stores the same
        # marker — never the blocked text (verdict threaded through, not
        # re-evaluated). Streaming paths capture delivered bytes instead.
        guard_action = _guardrail_post(db, prepared, result.text, allow_block=True,
                                       tool_calls=result.tool_calls)
        text = "[withheld by guardrail policy]" if guard_action == "blocked" else result.text
        await _promptlog_capture(db, prepared, input_text=prepared.history_text,
                           output_text=text, status="completed",
                           latency_ms=latency_ms, tokens=tokens)
        return ChatOutcome(
            request_id=prepared.meta.request_id,
            model_identifier=prepared.unified.model_identifier,
            provider_label=prepared.provider_label,
            text=text,
            usage=tokens,
            total_tokens=total,
            breakdown=breakdown,
            latency_ms=latency_ms,
            estimated=estimated,
            tool_calls=result.tool_calls,
            finish_reason=result.finish_reason,
        )
    except Exception as exc:
        latency_ms = (time.monotonic() - started) * 1000
        classified = classify_provider_failure(exc)
        _release_reservation(prepared)
        _provider_error_event(
            code=classified.code.value, endpoint=prepared.unified.endpoint,
            key_prefix=prepared.ctx.key_prefix,
        )
        _log_request(
            db, prepared.ctx, prepared.meta, prepared.unified,
            status="failed",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            error_code=classified.code.value,
            latency_ms=latency_ms,
        )
        await _promptlog_capture(db, prepared, input_text=prepared.history_text,
                           output_text="", status="failed",
                           error_code=classified.code.value,
                           latency_ms=latency_ms)
        # Failure-triggered revalidation: only INVALID_CREDENTIALS / TIMEOUT /
        # MODEL_UNAVAILABLE actually probe (throttled per provider). Never raises.
        try:
            await request_revalidation(db, prepared.provider.id, classified.code)
        except Exception:
            logger.warning("provider revalidation failed", exc_info=True)
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
                kwargs["image_bytes"] = edit_image
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
            request_id=prepared.meta.request_id,
            org_cap=prepared.org_cap,
        )
        latency_ms = (time.monotonic() - started) * 1000
        _log_request(
            db, prepared.ctx, prepared.meta, unified,
            status="success",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            latency_ms=latency_ms,
            cost=cost,
            usage_estimated=estimated,
        )
        logger.info(
            "public gateway media: key=%s model=%s endpoint=%s cost=%s latency=%.0fms",
            prepared.ctx.key_prefix, prepared.model_label, unified.endpoint, cost, latency_ms,
        )
        # Media bytes are never captured: text prompt only, when present.
        await _promptlog_capture(db, prepared, input_text=unified.prompt or "",
                           output_text="", status="completed",
                           latency_ms=latency_ms)
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
        _release_reservation(prepared)
        _provider_error_event(
            code=classified.code.value, endpoint=unified.endpoint,
            key_prefix=prepared.ctx.key_prefix,
        )
        _log_request(
            db, prepared.ctx, prepared.meta, unified,
            status="failed",
            provider_label=prepared.provider_label,
            model_label=prepared.model_label,
            error_code=classified.code.value,
            latency_ms=latency_ms,
        )
        await _promptlog_capture(db, prepared, input_text=prepared.unified.prompt or "",
                           output_text="", status="failed",
                           error_code=classified.code.value,
                           latency_ms=latency_ms)
        # Failure-triggered revalidation: only INVALID_CREDENTIALS / TIMEOUT /
        # MODEL_UNAVAILABLE actually probe (throttled per provider). Never raises.
        try:
            await request_revalidation(db, prepared.provider.id, classified.code)
        except Exception:
            logger.warning("provider revalidation failed", exc_info=True)
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
    if chunk.finish_reason is not None:
        target.finish_reason = chunk.finish_reason
    if chunk.tool_call_delta:
        _accumulate_tool_call(target.tool_calls, chunk.tool_call_delta)
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
    if tokens.cache_read:
        usage["prompt_tokens_details"] = {"cached_tokens": tokens.cache_read}
    if tokens.reasoning:
        usage["completion_tokens_details"] = {"reasoning_tokens": tokens.reasoning}
    return usage


def _responses_usage_details(tokens: UsageTokens, total: int) -> dict[str, Any]:
    usage: dict[str, Any] = {
        "input_tokens": tokens.prompt,
        "output_tokens": tokens.completion,
        "total_tokens": total,
    }
    if tokens.cache_read:
        usage["input_tokens_details"] = {"cached_tokens": tokens.cache_read}
    if tokens.reasoning:
        usage["output_tokens_details"] = {"reasoning_tokens": tokens.reasoning}
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

    def _tool_calls() -> list[dict[str, Any]]:
        calls = []
        for pos, entry in enumerate(result.tool_calls):
            call_id = entry.get("id") or (tool_blocks[pos]["id"] if pos < len(tool_blocks) else "") or f"call_{pos}"
            calls.append({
                "id": call_id,
                "name": entry.get("name") or (tool_blocks[pos]["name"] if pos < len(tool_blocks) else ""),
                "arguments": entry.get("arguments") or "",
            })
        return calls

    def _close(tokens: UsageTokens, total: int) -> list[str]:
        nonlocal sequence
        if fmt == "anthropic":
            anthropic_usage: dict[str, Any] = {
                "input_tokens": tokens.prompt,
                "output_tokens": tokens.completion,
            }
            if tokens.cache_write:
                anthropic_usage["cache_creation_input_tokens"] = tokens.cache_write
            if tokens.cache_read:
                anthropic_usage["cache_read_input_tokens"] = tokens.cache_read
            frames = []
            if text_open:
                frames.append(_sse({"type": "content_block_stop", "index": 0}, "content_block_stop"))
            for pos in range(len(tool_blocks)):
                frames.append(_sse({"type": "content_block_stop", "index": 1 + pos}, "content_block_stop"))
            frames.extend([
                _sse(
                    {
                        "type": "message_delta",
                        "delta": {
                            "stop_reason": "tool_use" if tool_blocks else "end_turn",
                            "stop_sequence": None,
                        },
                        "usage": anthropic_usage,
                    },
                    "message_delta",
                ),
                _sse({"type": "message_stop"}, "message_stop"),
            ])
            return frames
        if fmt == "responses":
            frames = []
            for pos, call in enumerate(_tool_calls()):
                done = {
                    "type": "response.function_call_arguments.done",
                    "sequence_number": sequence,
                    "item_id": call["id"],
                    "output_index": pos,
                    "arguments": call["arguments"],
                }
                sequence += 1
                frames.append(_sse(done, "response.function_call_arguments.done"))
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
                        },
                        *[
                            {
                                "type": "function_call",
                                "id": call["id"],
                                "call_id": call["id"],
                                "name": call["name"],
                                "arguments": call["arguments"],
                            }
                            for call in _tool_calls()
                        ],
                    ],
                    "usage": _responses_usage_details(tokens, total),
                },
            }
            sequence += 1
            frames.append(_sse(payload, "response.completed"))
            return frames
        frames = []
        if tool_blocks:
            reason = result.finish_reason or "tool_calls"
            if reason == "tool_use":
                reason = "tool_calls"
            frames.append(_sse(
                {
                    "id": stream_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": reason}],
                }
            ))
        frames.extend([
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
        ])
        return frames

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

    def _tool_key(delta: dict[str, Any]) -> str:
        if delta.get("id"):
            return str(delta["id"])
        index = delta.get("index")
        return f"index:{index if index is not None else len(tool_blocks)}"

    def _tool_frame(delta: dict[str, Any]) -> list[str]:
        nonlocal sequence, text_open
        key = _tool_key(delta)
        is_new = key not in tool_index
        if is_new:
            tool_index[key] = len(tool_blocks)
            tool_blocks.append({"id": delta.get("id") or "", "name": delta.get("name") or ""})
        pos = tool_index[key]
        if delta.get("id"):
            tool_blocks[pos]["id"] = delta["id"]
        if delta.get("name") and not tool_blocks[pos]["name"]:
            tool_blocks[pos]["name"] = delta["name"]
        args = delta.get("arguments_delta") or ""
        if fmt == "anthropic":
            frames = []
            if is_new:
                if text_open:
                    frames.append(_sse({"type": "content_block_stop", "index": 0}, "content_block_stop"))
                    text_open = False
                frames.append(_sse(
                    {
                        "type": "content_block_start",
                        "index": 1 + pos,
                        "content_block": {
                            "type": "tool_use",
                            "id": tool_blocks[pos]["id"],
                            "name": tool_blocks[pos]["name"],
                        },
                    },
                    "content_block_start",
                ))
            if args:
                frames.append(_sse(
                    {
                        "type": "content_block_delta",
                        "index": 1 + pos,
                        "delta": {"type": "input_json_delta", "partial_json": args},
                    },
                    "content_block_delta",
                ))
            return frames
        if fmt == "responses":
            frames = []
            call_id = tool_blocks[pos]["id"] or f"call_{pos}"
            if is_new:
                added = {
                    "type": "response.output_item.added",
                    "sequence_number": sequence,
                    "output_index": pos,
                    "item": {
                        "type": "function_call",
                        "id": call_id,
                        "call_id": call_id,
                        "name": tool_blocks[pos]["name"],
                        "arguments": "",
                    },
                }
                sequence += 1
                frames.append(_sse(added, "response.output_item.added"))
            if args:
                frames.append(_sse(
                    {
                        "type": "response.function_call_arguments.delta",
                        "sequence_number": sequence,
                        "item_id": call_id,
                        "output_index": pos,
                        "delta": args,
                    },
                    "response.function_call_arguments.delta",
                ))
                sequence += 1
            return frames
        entry: dict[str, Any] = {"index": pos}
        if delta.get("id"):
            entry["id"] = delta["id"]
        function: dict[str, Any] = {}
        if delta.get("name"):
            function["name"] = delta["name"]
        if args:
            function["arguments"] = args
        if function:
            entry["function"] = function
        delta_payload: dict[str, Any] = {"tool_calls": [entry]}
        if is_new:
            delta_payload["role"] = "assistant"
        return [_sse(
            {
                "id": stream_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{"index": 0, "delta": delta_payload, "finish_reason": None}],
            }
        )]

    model = prepared.unified.model_identifier
    tool_kwargs = _tool_kwargs(prepared.adapter.chat_stream, prepared.unified)
    tool_blocks: list[dict[str, Any]] = []
    tool_index: dict[str, int] = {}
    text_open = True
    for frame in _open():
        yield frame
    try:
        async for chunk in prepared.adapter.chat_stream(prepared.messages, **tool_kwargs):
            _absorb(result, chunk)
            if chunk.tool_call_delta:
                for frame in _tool_frame(chunk.tool_call_delta):
                    yield frame
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
            request_id=prepared.meta.request_id,
            org_cap=prepared.org_cap,
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
            usage_estimated=estimated,
        )
        logged = True
        logger.info(
            "public gateway stream done: key=%s model=%s tokens=%s cost=%s latency=%.0fms",
            prepared.ctx.key_prefix, prepared.model_label, total, breakdown.total_cost, latency_ms,
        )
        await _promptlog_capture(db, prepared, input_text=prepared.history_text,
                           output_text=result.text, status="completed",
                           latency_ms=latency_ms, tokens=tokens)
        # Guardrail post on streams is audit-only (delivery already happened).
        _guardrail_post(db, prepared, result.text, allow_block=False,
                            tool_calls=result.tool_calls)
        for frame in _close(tokens, total):
            yield frame
    except asyncio.CancelledError:
        if not logged:
            _release_reservation(prepared)
            await _promptlog_capture(
                db, prepared, input_text=prepared.history_text,
                output_text=result.text,
                status="partial" if (result.text or "").strip() else "cancelled",
                latency_ms=(time.monotonic() - prepared.started) * 1000)
            _guardrail_post(db, prepared, result.text, allow_block=False,
                                tool_calls=result.tool_calls)
            _log_request(
                db, prepared.ctx, prepared.meta, prepared.unified,
                status="cancelled",
                provider_label=prepared.provider_label,
                model_label=prepared.model_label,
                latency_ms=(time.monotonic() - prepared.started) * 1000,
                is_streaming=True,
            )
        raise
    except GeneratorExit:
        # Client went away while suspended on yield (aclose without cancel):
        # no frames may be emitted here, but the terminal row still applies.
        if not logged:
            _release_reservation(prepared)
            await _promptlog_capture(
                db, prepared, input_text=prepared.history_text,
                output_text=result.text,
                status="partial" if (result.text or "").strip() else "cancelled",
                latency_ms=(time.monotonic() - prepared.started) * 1000)
            _guardrail_post(db, prepared, result.text, allow_block=False,
                                tool_calls=result.tool_calls)
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
            _release_reservation(prepared)
            _provider_error_event(
                code=classified.code.value, endpoint=prepared.unified.endpoint,
                key_prefix=prepared.ctx.key_prefix,
            )
            _log_request(
                db, prepared.ctx, prepared.meta, prepared.unified,
                status="failed",
                provider_label=prepared.provider_label,
                model_label=prepared.model_label,
                error_code=classified.code.value,
                latency_ms=(time.monotonic() - prepared.started) * 1000,
                is_streaming=True,
            )
            await _promptlog_capture(
                db, prepared, input_text=prepared.history_text,
                output_text=result.text, status="failed",
                error_code=classified.code.value,
                latency_ms=(time.monotonic() - prepared.started) * 1000)
            logged = True
        # Failure-triggered revalidation: prepared.provider is always set here
        # (resolved in _prepare before any I/O). Throttled; never raises.
        try:
            await request_revalidation(db, prepared.provider.id, classified.code)
        except Exception:
            logger.warning("provider revalidation failed", exc_info=True)
        logger.warning(
            "public gateway stream failed: key=%s model=%s error=%s",
            prepared.ctx.key_prefix, prepared.model_label, classified.message,
        )
        for frame in _error(classified):
            yield frame


# --- model listing ------------------------------------------------------------------


def key_identity(db: Session, ctx: KeyContext) -> dict:
    """Identity + budget snapshot for `GET /v1/me`. No provider I/O."""
    from tollms.services.gateway.limits import current_spend

    models = list_public_models(db, ctx)
    return {
        "object": "api_key",
        "id": ctx.key_prefix,
        "name": ctx.name,
        "enabled": ctx.enabled,
        "models": [f"{provider.name}/{model.model_id}" for provider, model in models],
        "model_count": len(models),
        "spend_usd": str(current_spend(ctx)),
        "budget_usd": str(ctx.policy.max_budget_usd) if ctx.policy.max_budget_usd is not None else None,
    }


def list_public_models(db: Session, ctx: KeyContext) -> list[tuple[Provider, AIModel]]:
    """Active models the key is allowed to call: the assignee's personal rows
    (personal key) or exactly the key's own org rows (org key)."""
    from sqlalchemy import and_

    if ctx.org_id is not None:
        scope = (Provider.org_id == ctx.org_id)
    else:
        scope = and_(Provider.org_id.is_(None), Provider.user_id == ctx.user_id)
    rows = db.execute(
        select(Provider, AIModel)
        .join(AIModel, AIModel.provider_id == Provider.id)
        .where(
            scope,
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
