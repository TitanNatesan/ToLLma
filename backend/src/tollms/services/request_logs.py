"""Request-log engine: one durable row per AI request.

Used by the gateway (streaming + non-streaming), the generation driver and the
export service. Analytics reads the same rows so charts, latency and provider
comparisons share one ledger with `messages`.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiKey
from tollms.models.request_log import ExportEvent, RequestLog, RequestStatus

logger = logging.getLogger(__name__)


@dataclass
class RequestLogEntry:
    """Plain-data input so the generation driver can log without ORM objects."""

    user_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    api_key_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None
    message_id: uuid.UUID | None = None
    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None
    request_started_at: datetime | None = None
    request_completed_at: datetime | None = None
    latency_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None
    input_cost: Decimal | None = None
    output_cost: Decimal | None = None
    total_cost: Decimal | None = None
    status: RequestStatus = RequestStatus.SUCCESS
    error_code: str | None = None
    is_regeneration: bool = False
    is_streaming: bool = False


def touch_key_last_used(
    db: Session, api_key_id: uuid.UUID | None, *, completed_at: datetime | None = None
) -> None:
    """Stamp `ApiKey.last_used_at` = most recent SUCCESSFULLY COMPLETED request.

    Callers gate on success-only; this just stamps. Never raises (freshness must
    never fail the request it annotates) and never touches `enabled`/`is_deleted`.
    The max-guard keeps out-of-order commits (streaming drivers) from moving the
    stamp backwards. Joins the caller's commit — no commit here.
    """
    if api_key_id is None:
        return
    try:
        key = db.get(ApiKey, api_key_id)
        if key is None or key.is_deleted:
            return
        stamp = completed_at or datetime.now(timezone.utc)
        if key.last_used_at is None or stamp > key.last_used_at:
            key.last_used_at = stamp
    except Exception:
        logger.warning("request_logs: last_used_at touch failed (key=%s)", api_key_id, exc_info=True)


def record(db: Session, entry: RequestLogEntry) -> RequestLog:
    """Insert one request-log row. Caller owns the transaction/commit."""
    row = RequestLog(
        user_id=entry.user_id,
        org_id=entry.org_id,
        api_key_id=entry.api_key_id,
        conversation_id=entry.conversation_id,
        message_id=entry.message_id,
        provider_id=entry.provider_id,
        model_id=entry.model_id,
        request_started_at=entry.request_started_at,
        request_completed_at=entry.request_completed_at or datetime.now(timezone.utc),
        latency_ms=entry.latency_ms,
        prompt_tokens=entry.prompt_tokens,
        completion_tokens=entry.completion_tokens,
        total_tokens=entry.total_tokens,
        cache_read_tokens=entry.cache_read_tokens,
        cache_write_tokens=entry.cache_write_tokens,
        reasoning_tokens=entry.reasoning_tokens,
        input_cost=entry.input_cost,
        output_cost=entry.output_cost,
        total_cost=entry.total_cost,
        status=entry.status.value,
        error_code=entry.error_code,
        is_regeneration=entry.is_regeneration,
        is_streaming=entry.is_streaming,
    )
    db.add(row)
    if entry.status == RequestStatus.SUCCESS:
        touch_key_last_used(db, entry.api_key_id, completed_at=row.request_completed_at)
    return row


def record_export(
    db: Session,
    user_id: uuid.UUID | None,
    dataset: str,
    export_format: str,
    item_count: int,
    detail: str | None = None,
) -> ExportEvent:
    """Insert one export audit row (powers the export-count widget)."""
    row = ExportEvent(
        user_id=user_id, dataset=dataset, format=export_format, item_count=item_count, detail=detail
    )
    db.add(row)
    return row


def totals(db: Session, user_id: uuid.UUID | None, start: datetime, end: datetime) -> dict:
    """Aggregate spend/tokens/latency from request logs for one window."""
    stmt = (
        select(
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.avg(RequestLog.latency_ms), 0),
            func.count(RequestLog.id).filter(RequestLog.status == RequestStatus.FAILED.value),
            func.count(RequestLog.id).filter(RequestLog.status == RequestStatus.CANCELLED.value),
        )
        .where(RequestLog.created_at >= start, RequestLog.created_at < end)
        .where(RequestLog.user_id == user_id if user_id is not None else RequestLog.user_id.is_(None))
    )
    requests, cost, tokens, avg_latency, failed, cancelled = db.execute(stmt).one()
    return {
        "requests": int(requests or 0),
        "cost": Decimal(cost or 0),
        "tokens": int(tokens or 0),
        "avg_latency_ms": float(avg_latency or 0),
        "failed": int(failed or 0),
        "cancelled": int(cancelled or 0),
    }


def by_provider(db: Session, user_id: uuid.UUID | None, start: datetime, end: datetime) -> list[dict]:
    """Provider comparison from request logs (requests, tokens, cost, errors)."""
    from tollms.models.provider import Provider

    stmt = (
        select(
            RequestLog.provider_id,
            Provider.name,
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.coalesce(func.avg(RequestLog.latency_ms), 0),
            func.count(RequestLog.id).filter(RequestLog.status == RequestStatus.FAILED.value),
        )
        .join(Provider, Provider.id == RequestLog.provider_id, isouter=True)
        .where(RequestLog.created_at >= start, RequestLog.created_at < end)
        .where(RequestLog.user_id == user_id if user_id is not None else RequestLog.user_id.is_(None))
        .group_by(RequestLog.provider_id, Provider.name)
        .order_by(func.coalesce(func.sum(RequestLog.total_cost), 0).desc())
    )
    return [
        {
            "provider_id": provider_id,
            "provider_name": name or "Unknown",
            "requests": int(requests or 0),
            "tokens": int(tokens or 0),
            "cost": Decimal(cost or 0),
            "avg_latency_ms": float(avg_latency or 0),
            "failed": int(failed or 0),
        }
        for provider_id, name, requests, tokens, cost, avg_latency, failed in db.execute(stmt).all()
    ]
