"""Conversations, messages, usage + cost calculation. Prices are per 1M tokens."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from tollms.api.attachments import service as attachment_service
from tollms.api.attachments.schemas import AttachmentRead
from tollms.core.exceptions import NotFoundError
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_delete_sync, cache_get_sync, cache_set_sync
from tollms.services import search as search_engine
from tollms.services.observability.events import emit
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.api.conversations.schemas import (
    ConversationCreate,
    ConversationRead,
    MessageRead,
    ModelUsageBreakdown,
    ProviderUsageBreakdown,
    UsageTotals,
)
from tollms.models.registered_model import AIModel
from tollms.models.provider import Provider

_MILLION = Decimal(1_000_000)

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
    rows = list(db.scalars(stmt))
    # Transient count (serialized as message_count) so clients can hide drafts.
    counts = dict(
        db.execute(
            select(Message.conversation_id, func.count(Message.id))
            .where(
                Message.conversation_id.in_([c.id for c in rows] or [None]),
                Message.is_deleted.is_(False),
            )
            .group_by(Message.conversation_id)
        ).all()
    )
    for conv in rows:
        conv.message_count = int(counts.get(conv.id, 0))
    return rows


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
    if data.provider_id is not None:
        from tollms.api.providers.service import get_provider as _get_provider

        _get_provider(db, data.provider_id, user_id)  # 404 unless visible
    if data.model_id is not None:
        from tollms.api.models.service import get_model as _get_model

        _get_model(db, data.model_id, user_id)  # 404 unless visible
    conv = Conversation(
        user_id=user_id,
        title=data.title or "New conversation",
        provider_id=data.provider_id,
        model_id=data.model_id,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    search_engine.index_conversation(db, conv)
    db.commit()
    logger.info("conversation created: %s", conv.id)
    return conv


def rename_conversation(
    db: Session, conversation_id: uuid.UUID, title: str, user_id: uuid.UUID | None = None
) -> Conversation:
    conv = get_conversation(db, conversation_id, user_id)
    conv.title = title
    db.commit()
    db.refresh(conv)
    search_engine.index_conversation(db, conv)
    db.commit()
    return conv


def delete_conversation(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> None:
    conv = get_conversation(db, conversation_id, user_id)
    conv.is_deleted = True
    conv.deleted_at = datetime.now(timezone.utc)
    db.commit()
    search_engine.remove_conversation(db, conversation_id)
    db.commit()
    cache_delete_sync(cache_keys.usage_totals(conversation_id, user_id))
    logger.info("conversation soft-deleted: %s", conversation_id)
    emit("conversation.deleted", conversation_id=str(conversation_id), user_id=str(user_id))


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
    status: MessageStatus = MessageStatus.COMPLETED,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
    user_id: uuid.UUID | None = None,
    session_id: str | None = None,
    usage_estimated: bool = False,
) -> Message:
    msg = Message(
        user_id=user_id,
        conversation_id=conversation_id,
        role=role,
        content=content,
        provider_id=provider_id,
        model_id=model_id,
        latency_ms=latency_ms,
        status=status,
        started_at=started_at,
        completed_at=completed_at,
        session_id=session_id,
        usage_estimated=usage_estimated,
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
    if content.strip():
        _index_message(db, msg)
    return msg


def _index_message(db: Session, message: Message) -> None:
    """Keep the FTS document in sync (title + provider/model labels included)."""
    try:
        title = db.execute(
            select(Conversation.title).where(Conversation.id == message.conversation_id)
        ).scalar_one_or_none()
        provider_name = (
            db.execute(select(Provider.name).where(Provider.id == message.provider_id)).scalar_one_or_none()
            if message.provider_id
            else None
        )
        model_name = (
            db.execute(select(AIModel.name).where(AIModel.id == message.model_id)).scalar_one_or_none()
            if message.model_id
            else None
        )
        search_engine.index_message(
            db,
            message,
            conversation_title=title,
            provider_name=provider_name,
            model_name=model_name,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("search index update failed for message %s", message.id, exc_info=True)


def get_message(db: Session, message_id: uuid.UUID, user_id: uuid.UUID | None = None) -> Message:
    """Single message, ownership-checked. Cross-owner reads 404 (no oracle)."""
    msg = db.get(Message, message_id)
    if msg is None or msg.is_deleted:
        raise NotFoundError(f"message {message_id} not found")
    if user_id is not None and msg.user_id != user_id:
        raise NotFoundError(f"message {message_id} not found")
    return msg


def active_assistant_message(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> Message | None:
    """The conversation's non-terminal assistant message, if any."""
    get_conversation(db, conversation_id, user_id)
    return db.scalar(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.is_deleted.is_(False),
            Message.role == Role.ASSISTANT,
            Message.status.in_([MessageStatus.QUEUED, MessageStatus.RUNNING]),
        )
        .order_by(Message.created_at.desc())
    )


def find_assistant_by_client_key(
    db: Session, user_id: uuid.UUID | None, client_key: str
) -> Message | None:
    """Idempotency lookup: the assistant row a same-key send created before.

    Ownership-checked like everything else (None user = unscoped, tests only).
    """
    stmt = select(Message).where(
        Message.client_key == client_key,
        Message.is_deleted.is_(False),
        Message.role == Role.ASSISTANT,
    )
    if user_id is not None:
        stmt = stmt.where(Message.user_id == user_id)
    else:
        stmt = stmt.where(Message.user_id.is_(None))
    return db.scalar(stmt)


def list_messages(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> list[Message]:
    get_conversation(db, conversation_id, user_id)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.created_at, Message.id)
    )
    return list(db.scalars(stmt))


def conversation_read(
    db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> ConversationRead:
    """Conversation + messages with attachments, ownership-checked."""
    conv = get_conversation_with_messages(db, conversation_id, user_id)
    read = ConversationRead.model_validate(conv)
    read.messages = message_reads(db, conv.messages, user_id)
    return read


def message_reads(
    db: Session, messages: list[Message], user_id: uuid.UUID | None = None
) -> list[MessageRead]:
    """Message rows -> read models with attachments + generation history.

    Three grouped queries total, independent of message count.
    """
    from tollms.api.messages.service import run_reads
    from tollms.models.message_history import GenerationRun, MessageVersion

    ids = [m.id for m in messages]
    grouped = attachment_service.attachments_for_messages(db, ids, user_id)
    run_rows = list(
        db.execute(
            select(GenerationRun)
            .where(GenerationRun.message_id.in_(ids or [None]))
            .order_by(GenerationRun.generation_number.asc())
        ).scalars()
    )
    runs_by_message: dict[uuid.UUID, list] = {}
    for run in run_rows:
        runs_by_message.setdefault(run.message_id, []).append(run)
    runs_read = {run.id: read for run, read in zip(run_rows, run_reads(db, run_rows))}
    version_counts = dict(
        db.execute(
            select(MessageVersion.message_id, func.count())
            .where(MessageVersion.message_id.in_(ids or [None]))
            .group_by(MessageVersion.message_id)
        ).all()
    )

    out = []
    for m in messages:
        read = MessageRead.model_validate(m)
        read.attachments = [AttachmentRead.model_validate(a) for a in grouped.get(m.id, [])]
        message_runs = runs_by_message.get(m.id, [])
        read.generations = [runs_read[run.id] for run in message_runs]
        active = next((run for run in message_runs if run.is_active), None)
        read.active_generation_id = active.id if active else None
        read.versions_count = int(version_counts.get(m.id, 0))
        out.append(read)
    return out


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
            cache_read_tokens=int(r[6]), cache_write_tokens=int(r[7]),
        )
        for r in db.execute(
            select(
                Message.model_id, AIModel.name,
                func.coalesce(func.sum(Message.prompt_tokens), 0),
                func.coalesce(func.sum(Message.completion_tokens), 0),
                func.coalesce(func.sum(Message.total_tokens), 0),
                func.coalesce(func.sum(Message.total_cost), 0),
                func.coalesce(func.sum(Message.cache_read_tokens), 0),
                func.coalesce(func.sum(Message.cache_write_tokens), 0),
                AIModel.input_price,
                AIModel.cache_read_price,
                AIModel.cache_write_price,
            )
            .outerjoin(AIModel, AIModel.id == Message.model_id)
            .where(*scope)
            .group_by(
                Message.model_id,
                AIModel.name,
                AIModel.input_price,
                AIModel.cache_read_price,
                AIModel.cache_write_price,
            )
            .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        )
    ]
    # Net cache savings: reads bill below input, writes bill at a premium.
    # Only counted when the model publishes the relevant rate (else 0).
    cache_savings = Decimal(0)
    for r in db.execute(
        select(
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            AIModel.input_price,
            AIModel.cache_read_price,
            AIModel.cache_write_price,
        )
        .outerjoin(AIModel, AIModel.id == Message.model_id)
        .where(*scope)
        .group_by(
            Message.model_id,
            AIModel.input_price,
            AIModel.cache_read_price,
            AIModel.cache_write_price,
        )
    ):
        read_tokens, write_tokens = int(r[0]), int(r[1])
        input_price, read_price, write_price = (r[2] or 0), (r[3] or 0), (r[4] or 0)
        if read_price and input_price:
            cache_savings += Decimal(read_tokens) * (Decimal(input_price) - Decimal(read_price)) / _MILLION
        if write_price and input_price:
            cache_savings += Decimal(write_tokens) * (Decimal(input_price) - Decimal(write_price)) / _MILLION
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
        cache_savings=cache_savings,
        by_model=by_model,
        by_provider=by_provider,
    )


def touch(db: Session, conv: Conversation, *, title: str | None = None) -> None:
    conv.updated_at = datetime.now(timezone.utc)
    if title and conv.title == "New conversation":
        conv.title = title
    db.commit()
