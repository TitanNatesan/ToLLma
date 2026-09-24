"""Daily usage rollups into ``usage_daily_aggregates``.

One row per (day, user, provider, model) scope; NULL dimensions collapse into
platform-wide buckets. ``rebuild_day`` is authoritative and idempotent: it
replaces the day's rows inside one transaction, then upserts with
``ON CONFLICT ON CONSTRAINT uq_usage_daily_scope`` so concurrent rebuilds
cannot double-write non-null scopes. Days are UTC calendar days and the fact
scan mirrors the admin engines (live assistant generations only).

Media sizes come from image/video attachment rows linked to their message;
counts come from ``metadata.generation_type``. No content is read.
"""

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from tollms.models.attachment import Attachment
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.usage_aggregate import UsageDailyAggregate

logger = logging.getLogger(__name__)

_MEDIA_KINDS = ("image", "video")

_UPSERT_COLUMNS = (
    "requests",
    "failed_requests",
    "cancelled_requests",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "images",
    "videos",
    "media_bytes",
    "input_cost",
    "output_cost",
    "total_cost",
    "cache_read_cost",
    "cache_write_cost",
    "reasoning_cost",
)


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC [start, end) instants for one calendar day."""
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def _daily_rows(db: Session, day: date) -> list[dict[str, Any]]:
    """One grouped aggregate row per (user, provider, model) for the day."""
    start, end = _day_bounds(day)
    kind = Message.metadata_["generation_type"].astext
    sizes = (
        select(
            Attachment.message_id.label("message_id"),
            func.sum(Attachment.file_size).label("bytes"),
        )
        .where(
            Attachment.message_id.is_not(None),
            Attachment.is_deleted.is_(False),
            Attachment.kind.in_(_MEDIA_KINDS),
        )
        .group_by(Attachment.message_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Message.user_id,
            Message.provider_id,
            Message.model_id,
            func.count(Message.id).label("requests"),
            func.count(Message.id)
            .filter(Message.status == MessageStatus.FAILED)
            .label("failed_requests"),
            func.count(Message.id)
            .filter(Message.status == MessageStatus.CANCELLED)
            .label("cancelled_requests"),
            func.coalesce(func.sum(Message.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(Message.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(Message.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.sum(Message.cache_read_tokens), 0).label("cache_read_tokens"),
            func.coalesce(func.sum(Message.cache_write_tokens), 0).label("cache_write_tokens"),
            func.coalesce(func.sum(Message.reasoning_tokens), 0).label("reasoning_tokens"),
            func.count(Message.id).filter(kind == "image").label("images"),
            func.count(Message.id).filter(kind == "video").label("videos"),
            func.coalesce(func.sum(sizes.c.bytes), 0).label("media_bytes"),
            func.coalesce(func.sum(Message.input_cost), 0).label("input_cost"),
            func.coalesce(func.sum(Message.output_cost), 0).label("output_cost"),
            func.coalesce(func.sum(Message.total_cost), 0).label("total_cost"),
            func.coalesce(func.sum(Message.cache_read_cost), 0).label("cache_read_cost"),
            func.coalesce(func.sum(Message.cache_write_cost), 0).label("cache_write_cost"),
            func.coalesce(func.sum(Message.reasoning_cost), 0).label("reasoning_cost"),
        )
        .select_from(Message)
        .outerjoin(sizes, sizes.c.message_id == Message.id)
        .where(
            Message.is_deleted.is_(False),
            Message.role == Role.ASSISTANT,
            Message.created_at >= start,
            Message.created_at < end,
        )
        .group_by(Message.user_id, Message.provider_id, Message.model_id)
    ).all()
    payload = []
    for row in rows:
        values = tuple(row)
        payload.append(
            {
                "day": day,
                "user_id": values[0],
                "provider_id": values[1],
                "model_id": values[2],
                **dict(zip(_UPSERT_COLUMNS, values[3:], strict=True)),
            }
        )
    return payload


def rebuild_day(db: Session, day: date) -> int:
    """Replace one UTC day's aggregate rows; returns the rows written."""
    try:
        rows = _daily_rows(db, day)
        db.execute(delete(UsageDailyAggregate).where(UsageDailyAggregate.day == day))
        if rows:
            statement = pg_insert(UsageDailyAggregate).values(rows)
            updates = {column: getattr(statement.excluded, column) for column in _UPSERT_COLUMNS}
            updates["updated_at"] = func.now()
            db.execute(
                statement.on_conflict_do_update(
                    constraint="uq_usage_daily_scope", set_=updates
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("admin rollup: rebuild failed for day %s", day)
        raise
    return len(rows)


def rebuild_range(db: Session, start: date, end: date) -> int:
    """Rebuild every day in ``[start, end]``; returns total rows written."""
    if end < start:
        return 0
    total = 0
    current = start
    while current <= end:
        total += rebuild_day(db, current)
        current += timedelta(days=1)
    return total
