"""Conversations, messages, usage + cost calculation. Prices are per 1M tokens."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from tollms.core.exceptions import NotFoundError
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_delete_sync, cache_get_sync, cache_set_sync
from tollms.models.conversation import Conversation
from tollms.models.message import Message, Role
from tollms.api.conversations.schemas import (
    ConversationCreate,
    ModelUsageBreakdown,
    ProviderUsageBreakdown,
    UsageTotals,
)
from tollms.models.registered_model import AIModel
from tollms.models.provider import Provider

logger = logging.getLogger(__name__)


def calc_cost(model: AIModel, prompt_tokens: int, completion_tokens: int) -> tuple[Decimal, Decimal, Decimal]:
    unit = Decimal(1_000_000)
    input_cost = Decimal(prompt_tokens) * model.input_price / unit
    output_cost = Decimal(completion_tokens) * model.output_price / unit
    return input_cost, output_cost, input_cost + output_cost


def get_conversation(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.is_deleted:
        raise NotFoundError(f"conversation {conversation_id} not found")
    if user_id is not None and conv.user_id != user_id:
        raise NotFoundError(f"conversation {conversation_id} not found")
    return conv


def list_conversations(
    db: Session, *, search: str | None = None, user_id: uuid.UUID | None = None
) -> list[Conversation]:
    stmt = (
        select(Conversation)
        .where(Conversation.is_deleted.is_(False))
        .order_by(Conversation.is_pinned.desc(), Conversation.updated_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(Conversation.user_id == user_id)
    if search:
        # Search title OR message content via EXISTS subquery
        content_match = select(Message.id).where(
            Message.conversation_id == Conversation.id,
            Message.is_deleted.is_(False),
            Message.content.ilike(f"%{search}%"),
        ).exists()
        stmt = stmt.where(or_(Conversation.title.ilike(f"%{search}%"), content_match))
    return list(db.scalars(stmt))


def get_conversation_with_messages(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> Conversation:
    stmt = (
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.is_deleted.is_(False))
        .options(selectinload(Conversation.messages))
    )
    conv = db.scalar(stmt)
    if conv is None:
        raise NotFoundError(f"conversation {conversation_id} not found")
    if user_id is not None and conv.user_id != user_id:
        raise NotFoundError(f"conversation {conversation_id} not found")
    conv.messages = [m for m in conv.messages if not m.is_deleted]
    return conv


def create_conversation(
    db: Session, data: ConversationCreate, user_id: uuid.UUID | None = None
) -> Conversation:
    conv = Conversation(
        user_id=user_id,
        title=data.title or "New conversation",
        provider_id=data.provider_id,
        model_id=data.model_id,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    logger.info("conversation created: %s", conv.id)
    return conv


def rename_conversation(
    db: Session, conversation_id: uuid.UUID, title: str, user_id: uuid.UUID | None = None
) -> Conversation:
    conv = get_conversation(db, conversation_id, user_id)
    conv.title = title
    db.commit()
    db.refresh(conv)
    return conv


def delete_conversation(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> None:
    conv = get_conversation(db, conversation_id, user_id)
    conv.is_deleted = True
    conv.deleted_at = datetime.now(timezone.utc)
    db.commit()
    cache_delete_sync(cache_keys.usage_totals(conversation_id, user_id))
    logger.info("conversation soft-deleted: %s", conversation_id)


def pin_conversation(
    db: Session, conversation_id: uuid.UUID, *, pinned: bool, user_id: uuid.UUID | None = None
) -> Conversation:
    conv = get_conversation(db, conversation_id, user_id)
    conv.is_pinned = pinned
    db.commit()
    db.refresh(conv)
    logger.info("conversation %s pinned=%s", conversation_id, pinned)
    return conv


def add_message(
    db: Session,
    conversation_id: uuid.UUID,
    role: Role,
    content: str,
    *,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    usage: tuple[int, int, int] | None = None,
    cost: tuple[Decimal, Decimal, Decimal] | None = None,
    extra_usage: tuple[int, int, int] | None = None,
    extra_cost: tuple[Decimal, Decimal, Decimal] | None = None,
    latency_ms: float | None = None,
    user_id: uuid.UUID | None = None,
) -> Message:
    msg = Message(
        user_id=user_id,
        conversation_id=conversation_id,
        role=role,
        content=content,
        provider_id=provider_id,
        model_id=model_id,
        latency_ms=latency_ms,
    )
    if usage is not None:
        msg.prompt_tokens, msg.completion_tokens, msg.total_tokens = usage
    if cost is not None:
        msg.input_cost, msg.output_cost, msg.total_cost = cost
    if extra_usage is not None:
        msg.cache_read_tokens, msg.cache_write_tokens, msg.reasoning_tokens = extra_usage
    if extra_cost is not None:
        msg.cache_read_cost, msg.cache_write_cost, msg.reasoning_cost = extra_cost
    db.add(msg)
    db.commit()
    db.refresh(msg)
    cache_delete_sync(cache_keys.usage_totals(conversation_id, user_id))
    return msg


def list_messages(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> list[Message]:
    get_conversation(db, conversation_id, user_id)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.created_at)
    )
    return list(db.scalars(stmt))


def usage_totals(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> UsageTotals:
    """Aggregate message usage + cost. Cached for cache_ttl.CONVERSATION;
    invalidated by add_message/delete_conversation."""
    get_conversation(db, conversation_id, user_id)  # 404 semantics preserved; cheap PK get
    key = cache_keys.usage_totals(conversation_id, user_id)
    hit = cache_get_sync(key)
    if isinstance(hit, dict):
        try:
            return UsageTotals(**hit)
        except Exception:
            logger.warning("conversation %s usage: corrupt cache entry", conversation_id, exc_info=True)
    result = _usage_totals_uncached(db, conversation_id)
    cache_set_sync(key, _decimal_safe(result.model_dump()), ttl=cache_ttl.CONVERSATION)
    return result


def _decimal_safe(value):  # pydantic may emit Decimal; cache stores exact strings
    if isinstance(value, dict):
        return {k: _decimal_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_decimal_safe(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    return value


def _usage_totals_uncached(db: Session, conversation_id: uuid.UUID) -> UsageTotals:
    scope = [Message.conversation_id == conversation_id, Message.is_deleted.is_(False)]
    row = db.execute(
        select(
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.reasoning_tokens), 0),
            func.coalesce(func.sum(Message.input_cost), 0),
            func.coalesce(func.sum(Message.output_cost), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.cache_read_cost), 0),
            func.coalesce(func.sum(Message.cache_write_cost), 0),
            func.coalesce(func.sum(Message.reasoning_cost), 0),
        ).where(*scope)
    ).one()
    by_model = [
        ModelUsageBreakdown(
            model_id=r[0], model_name=r[1] or "unknown model",
            prompt_tokens=int(r[2]), completion_tokens=int(r[3]),
            total_tokens=int(r[4]), total_cost=r[5],
        )
        for r in db.execute(
            select(
                Message.model_id, AIModel.name,
                func.coalesce(func.sum(Message.prompt_tokens), 0),
                func.coalesce(func.sum(Message.completion_tokens), 0),
                func.coalesce(func.sum(Message.total_tokens), 0),
                func.coalesce(func.sum(Message.total_cost), 0),
            )
            .outerjoin(AIModel, AIModel.id == Message.model_id)
            .where(*scope)
            .group_by(Message.model_id, AIModel.name)
            .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        )
    ]
    by_provider = [
        ProviderUsageBreakdown(
            provider_id=r[0], provider_name=r[1] or "unknown provider",
            prompt_tokens=int(r[2]), completion_tokens=int(r[3]),
            total_tokens=int(r[4]), total_cost=r[5],
        )
        for r in db.execute(
            select(
                Message.provider_id, Provider.name,
                func.coalesce(func.sum(Message.prompt_tokens), 0),
                func.coalesce(func.sum(Message.completion_tokens), 0),
                func.coalesce(func.sum(Message.total_tokens), 0),
                func.coalesce(func.sum(Message.total_cost), 0),
            )
            .outerjoin(Provider, Provider.id == Message.provider_id)
            .where(*scope)
            .group_by(Message.provider_id, Provider.name)
            .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        )
    ]
    return UsageTotals(
        prompt_tokens=int(row[0]),
        completion_tokens=int(row[1]),
        total_tokens=int(row[2]),
        cache_read_tokens=int(row[3]),
        cache_write_tokens=int(row[4]),
        reasoning_tokens=int(row[5]),
        input_cost=row[6],
        output_cost=row[7],
        total_cost=row[8],
        cache_read_cost=row[9],
        cache_write_cost=row[10],
        reasoning_cost=row[11],
        by_model=by_model,
        by_provider=by_provider,
    )


def touch(db: Session, conv: Conversation, *, title: str | None = None) -> None:
    conv.updated_at = datetime.now(timezone.utc)
    if title and conv.title == "New conversation":
        conv.title = title
    db.commit()
