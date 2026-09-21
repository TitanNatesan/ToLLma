"""Request-log API: durable per-request observability and log-based analytics."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.request_logs.schemas import (
    ProviderLogRow,
    RequestLogPage,
    RequestLogRead,
    RequestLogSummary,
)
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services import request_logs as engine


def list_logs(
    db: Session,
    user_id: uuid.UUID | None,
    *,
    conversation_id: uuid.UUID | None = None,
    status: str | None = None,
    error_code: str | None = None,
    regenerations_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> RequestLogPage:
    filters = [
        RequestLog.user_id == user_id if user_id is not None else RequestLog.user_id.is_(None)
    ]
    if conversation_id is not None:
        filters.append(RequestLog.conversation_id == conversation_id)
    if status is not None:
        filters.append(RequestLog.status == status)
    if error_code is not None:
        filters.append(RequestLog.error_code == error_code)
    if regenerations_only:
        filters.append(RequestLog.is_regeneration.is_(True))

    total = db.execute(select(func.count(RequestLog.id)).where(*filters)).scalar_one()
    rows = list(
        db.execute(
            select(RequestLog)
            .where(*filters)
            .order_by(RequestLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).scalars()
    )
    model_names = dict(
        db.execute(
            select(AIModel.id, AIModel.name).where(AIModel.id.in_([r.model_id for r in rows if r.model_id] or [None]))
        ).all()
    )
    provider_names = dict(
        db.execute(
            select(Provider.id, Provider.name).where(
                Provider.id.in_([r.provider_id for r in rows if r.provider_id] or [None])
            )
        ).all()
    )

    return RequestLogPage(
        total=int(total or 0),
        limit=limit,
        offset=offset,
        items=[
            RequestLogRead(
                id=row.id,
                user_id=row.user_id,
                conversation_id=row.conversation_id,
                message_id=row.message_id,
                provider_id=row.provider_id,
                provider_name=provider_names.get(row.provider_id),
                model_id=row.model_id,
                model_name=model_names.get(row.model_id),
                request_started_at=row.request_started_at,
                request_completed_at=row.request_completed_at,
                latency_ms=row.latency_ms,
                prompt_tokens=row.prompt_tokens,
                completion_tokens=row.completion_tokens,
                total_tokens=row.total_tokens,
                input_cost=row.input_cost,
                output_cost=row.output_cost,
                total_cost=row.total_cost,
                status=row.status,
                error_code=row.error_code,
                is_regeneration=row.is_regeneration,
                is_streaming=row.is_streaming,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


def summary(db: Session, user_id: uuid.UUID | None, start, end) -> RequestLogSummary:
    totals = engine.totals(db, user_id, start, end)
    by_provider = engine.by_provider(db, user_id, start, end)
    regenerations = db.execute(
        select(func.count(RequestLog.id)).where(
            RequestLog.created_at >= start,
            RequestLog.created_at < end,
            RequestLog.is_regeneration.is_(True),
            RequestLog.user_id == user_id if user_id is not None else RequestLog.user_id.is_(None),
        )
    ).scalar_one()
    return RequestLogSummary(
        range_start=start,
        range_end=end,
        requests=totals["requests"],
        total_cost=totals["cost"],
        total_tokens=totals["tokens"],
        avg_latency_ms=totals["avg_latency_ms"],
        failed=totals["failed"],
        cancelled=totals["cancelled"],
        regenerations=int(regenerations or 0),
        by_provider=[ProviderLogRow(**row) for row in by_provider],
    )

