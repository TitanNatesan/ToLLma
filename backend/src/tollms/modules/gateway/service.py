"""Unified gateway: route -> stream -> usage/cost -> persist. All adapters behave the same."""

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal

import httpx
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ProviderError, ValidationError
from tollms.modules.conversations.models import Role
from tollms.modules.conversations.service import (
    add_message,
    create_conversation,
    get_conversation,
    list_messages,
    touch,
)
from tollms.modules.conversations.schemas import ConversationCreate
from tollms.modules.gateway.adapters.base import ChatMessage, ChatResult
from tollms.modules.gateway.costing import CostBreakdown, UsageTokens, calculate, prices_for_model
from tollms.modules.gateway.factory import build_adapter
from tollms.modules.gateway.schemas import ChatRequest, ChatResponse
from tollms.modules.model_repository.service import find_for_model
from tollms.modules.models.service import get_model
from tollms.modules.providers.service import decrypted_credentials, get_provider

logger = logging.getLogger(__name__)


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _resolve(db: Session, provider_id: uuid.UUID, model_id: uuid.UUID):
    provider = get_provider(db, provider_id)
    if not provider.is_active:
        raise ValidationError(f"provider {provider_id} is not active")
    model = get_model(db, model_id)
    if not model.is_active:
        raise ValidationError(f"model {model_id} is not active")
    if model.provider_id != provider.id:
        raise ValidationError("model does not belong to provider")
    return provider, model


def _history(db: Session, conv_id: uuid.UUID | None, system: str | None) -> tuple[list[ChatMessage], uuid.UUID | None]:
    messages: list[ChatMessage] = []
    if system:
        messages.append(ChatMessage(role="system", content=system))
    if conv_id is not None:
        for m in list_messages(db, conv_id):
            messages.append(ChatMessage(role=m.role.value, content=m.content))
    return messages, conv_id


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
) -> ChatResponse:
    """Non-streaming chat. Persists user + assistant messages, usage, cost."""
    provider, model = _resolve(db, data.provider_id, data.model_id)
    start = time.monotonic()
    try:
        if data.conversation_id is None:
            conv = create_conversation(
                db,
                ConversationCreate(
                    title=data.message[:60], provider_id=provider.id, model_id=model.id
                ),
            )
            conv_id = conv.id
        else:
            conv = get_conversation(db, data.conversation_id)
            conv_id = conv.id
        history, _ = _history(db, conv_id, data.system)
        history.append(ChatMessage(role="user", content=data.message))
        adapter = build_adapter(provider, model, decrypted_credentials(provider), transport)
        logger.info("gateway chat: provider=%s model=%s conv=%s", provider.provider_type, model.model_id, conv_id)
        result = await adapter.chat(history)
        latency_ms = (time.monotonic() - start) * 1000
        tokens, total, breakdown, estimated = _finalize_usage(
            db, provider, model, "".join(m.content for m in history), result
        )
        usage = (tokens.prompt, tokens.completion, total)
        cost = breakdown.legacy_triplet()
        extra_usage = (tokens.cache_read, tokens.cache_write, tokens.reasoning)
        extra_cost = (breakdown.cache_read_cost, breakdown.cache_write_cost, breakdown.reasoning_cost)
        add_message(db, conv_id, Role.USER, data.message, provider_id=provider.id, model_id=model.id)
        assistant = add_message(
            db, conv_id, Role.ASSISTANT, result.text,
            provider_id=provider.id, model_id=model.id, usage=usage, cost=cost,
            extra_usage=extra_usage, extra_cost=extra_cost, latency_ms=latency_ms,
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
    db: Session, data: ChatRequest, transport: httpx.AsyncBaseTransport | None = None
) -> AsyncIterator[str]:
    """SSE stream. Persists messages once the stream completes (or partial text on error)."""
    provider, model = _resolve(db, data.provider_id, data.model_id)
    start = time.monotonic()
    if data.conversation_id is None:
        conv = create_conversation(
            db, ConversationCreate(title=data.message[:60], provider_id=provider.id, model_id=model.id)
        )
        conv_id = conv.id
    else:
        conv = get_conversation(db, data.conversation_id)
        conv_id = conv.id
    history, _ = _history(db, conv_id, data.system)
    history.append(ChatMessage(role="user", content=data.message))
    yield f"data: {json.dumps({'conversation_id': str(conv_id)})}\n\n"
    adapter = build_adapter(provider, model, decrypted_credentials(provider), transport)
    logger.info("gateway stream: provider=%s model=%s conv=%s", provider.provider_type, model.model_id, conv_id)
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
        add_message(db, conv_id, Role.USER, data.message, provider_id=provider.id, model_id=model.id)
        assistant = add_message(
            db, conv_id, Role.ASSISTANT, result.text,
            provider_id=provider.id, model_id=model.id, usage=usage, cost=cost,
            extra_usage=(tokens.cache_read, tokens.cache_write, tokens.reasoning),
            extra_cost=(breakdown.cache_read_cost, breakdown.cache_write_cost, breakdown.reasoning_cost),
            latency_ms=latency_ms,
        )
        touch(db, conv)
        logger.info("gateway stream done: conv=%s tokens=%s/%s cost=%s", conv_id, usage[0], usage[1], cost[2])
        yield f"data: {json.dumps({'done': True, 'message_id': str(assistant.id), 'usage': {'prompt_tokens': usage[0], 'completion_tokens': usage[1], 'total_tokens': usage[2], 'cache_read_tokens': tokens.cache_read, 'cache_write_tokens': tokens.cache_write, 'reasoning_tokens': tokens.reasoning}, 'cost': {'input_cost': str(cost[0]), 'output_cost': str(cost[1]), 'total_cost': str(cost[2]), 'cache_read_cost': str(breakdown.cache_read_cost), 'cache_write_cost': str(breakdown.cache_write_cost), 'reasoning_cost': str(breakdown.reasoning_cost)}, 'usage_estimated': estimated, 'latency_ms': latency_ms})}\n\n"
    else:
        yield f"data: {json.dumps({'done': True, 'empty': True})}\n\n"
