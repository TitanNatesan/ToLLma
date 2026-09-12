"""Conversations, messages, usage + cost calculation. Prices are per 1M tokens."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from tollms.core.exceptions import NotFoundError
from tollms.modules.conversations.models import Conversation, Message, Role
from tollms.modules.conversations.schemas import ConversationCreate, UsageTotals
from tollms.modules.models.models import AIModel

logger = logging.getLogger(__name__)


def calc_cost(model: AIModel, prompt_tokens: int, completion_tokens: int) -> tuple[Decimal, Decimal, Decimal]:
    unit = Decimal(1_000_000)
    input_cost = Decimal(prompt_tokens) * model.input_price / unit
    output_cost = Decimal(completion_tokens) * model.output_price / unit
    return input_cost, output_cost, input_cost + output_cost


def get_conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.is_deleted:
        raise NotFoundError(f"conversation {conversation_id} not found")
    return conv


def list_conversations(db: Session, *, search: str | None = None) -> list[Conversation]:
    stmt = select(Conversation).where(Conversation.is_deleted.is_(False)).order_by(Conversation.updated_at.desc())
    if search:
        stmt = stmt.where(Conversation.title.ilike(f"%{search}%"))
    return list(db.scalars(stmt))


def get_conversation_with_messages(db: Session, conversation_id: uuid.UUID) -> Conversation:
    stmt = (
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.is_deleted.is_(False))
        .options(selectinload(Conversation.messages))
    )
    conv = db.scalar(stmt)
    if conv is None:
        raise NotFoundError(f"conversation {conversation_id} not found")
    conv.messages = [m for m in conv.messages if not m.is_deleted]
    return conv


def create_conversation(db: Session, data: ConversationCreate) -> Conversation:
    conv = Conversation(title=data.title or "New conversation", provider_id=data.provider_id, model_id=data.model_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    logger.info("conversation created: %s", conv.id)
    return conv


def rename_conversation(db: Session, conversation_id: uuid.UUID, title: str) -> Conversation:
    conv = get_conversation(db, conversation_id)
    conv.title = title
    db.commit()
    db.refresh(conv)
    return conv


def delete_conversation(db: Session, conversation_id: uuid.UUID) -> None:
    conv = get_conversation(db, conversation_id)
    conv.is_deleted = True
    conv.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("conversation soft-deleted: %s", conversation_id)


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
    latency_ms: float | None = None,
) -> Message:
    msg = Message(
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
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def list_messages(db: Session, conversation_id: uuid.UUID) -> list[Message]:
    get_conversation(db, conversation_id)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.created_at)
    )
    return list(db.scalars(stmt))


def usage_totals(db: Session, conversation_id: uuid.UUID) -> UsageTotals:
    get_conversation(db, conversation_id)
    row = db.execute(
        select(
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.input_cost), 0),
            func.coalesce(func.sum(Message.output_cost), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
        ).where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
    ).one()
    return UsageTotals(
        prompt_tokens=int(row[0]),
        completion_tokens=int(row[1]),
        total_tokens=int(row[2]),
        input_cost=row[3],
        output_cost=row[4],
        total_cost=row[5],
    )


def touch(db: Session, conv: Conversation, *, title: str | None = None) -> None:
    conv.updated_at = datetime.now(timezone.utc)
    if title and conv.title == "New conversation":
        conv.title = title
    db.commit()
