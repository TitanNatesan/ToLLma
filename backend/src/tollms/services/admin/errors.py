"""Platform error analytics over request logs and assistant generation rows.

Sources (aggregates only — never content): ``RequestLog`` (status,
error_code, completion time, route ids) and assistant ``Message`` rows
FAILED/CANCELLED with no matching request log (stale sweeps). Failures
present in both tables are deduped by ``message_id``; ``error_rate`` is
``(failed + cancelled) / request events`` in percent. Trend buckets follow
the shared window granularity/timezone helpers, so charts line up with the
other admin engines. Returns plain mappings validated by the router's
``AdminErrors`` model; this package never imports from ``tollms.api``.
"""

import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import String, cast, func, select, union_all
from sqlalchemy.orm import Session
from sqlalchemy.sql.selectable import Subquery

from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services.admin import AdminWindow
from tollms.services.admin.usage import bucket_expr, scope_conditions, window_range

logger = logging.getLogger(__name__)

_ERROR_STATUSES = ("failed", "cancelled")


def _request_events(window: AdminWindow) -> Subquery:
    """Union of request-log rows and generation failures it did not log."""
    logged = select(
        func.lower(RequestLog.status).label("status"),
        RequestLog.error_code.label("error_code"),
        RequestLog.provider_id.label("provider_id"),
        RequestLog.model_id.label("model_id"),
        RequestLog.request_completed_at.label("seen_at"),
    ).where(
        RequestLog.request_completed_at >= window.start,
        RequestLog.request_completed_at < window.end,
    )
    unlogged = select(
        func.lower(cast(Message.status, String)).label("status"),
        Message.error_code.label("error_code"),
        Message.provider_id.label("provider_id"),
        Message.model_id.label("model_id"),
        Message.created_at.label("seen_at"),
    ).where(
        Message.role == Role.ASSISTANT,
        Message.is_deleted.is_(False),
        Message.status.in_((MessageStatus.FAILED, MessageStatus.CANCELLED)),
        Message.created_at >= window.start,
        Message.created_at < window.end,
        ~select(RequestLog.id).where(RequestLog.message_id == Message.id).exists(),
    )
    return union_all(logged, unlogged).subquery("request_events")


def _totals(db: Session, events: Subquery) -> tuple[int, int, int]:
    """(total requests, failed, cancelled) over the deduped event stream."""
    failed = func.count().filter(events.c.status == "failed").label("failed")
    cancelled = func.count().filter(events.c.status == "cancelled").label("cancelled")
    row = db.execute(select(func.count(), failed, cancelled).select_from(events)).one()
    return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)


def _signature(
    code: Any, status: Any, count: Any, last_seen: Any,
    provider_name: str | None = None, model_name: str | None = None,
) -> dict[str, Any]:
    return {
        "error_code": str(code or "unknown"),
        "status": str(status),
        "provider_name": provider_name,
        "model_name": model_name,
        "count": int(count),
        "last_seen_at": last_seen,
    }


def _name_lookup(db: Session, ids: set[uuid.UUID], *, models: bool) -> dict[uuid.UUID, tuple[str | None, str | None]]:
    """Route names for the given ids in a single IN query."""
    if models:
        rows = db.execute(
            select(AIModel.id, AIModel.name, Provider.name)
            .outerjoin(Provider, Provider.id == AIModel.provider_id)
            .where(AIModel.id.in_(ids))
        ).all()
        return {row[0]: (row[1], row[2]) for row in rows}
    rows = db.execute(select(Provider.id, Provider.name).where(Provider.id.in_(ids))).all()
    return {row[0]: (row[1], None) for row in rows}


def _by_route(
    db: Session,
    events: Subquery,
    dimension: Any | None,
    limit: int,
    names: Callable[[Session, set[uuid.UUID]], dict[uuid.UUID, tuple[str | None, str | None]]] | None = None,
) -> list[dict[str, Any]]:
    """Top (route, error_code, status) signatures; ``dimension=None`` groups by code."""
    code = func.coalesce(events.c.error_code, "unknown").label("error_code")
    count = func.count().label("count")
    last_seen = func.max(events.c.seen_at)
    columns: list[Any] = [code, events.c.status, count, last_seen]
    group: list[Any] = [code, events.c.status]
    filters: list[Any] = [events.c.status.in_(_ERROR_STATUSES)]
    if dimension is not None:
        columns.insert(0, dimension)
        group.insert(0, dimension)
        filters.append(dimension.is_not(None))
    rows = db.execute(
        select(*columns).where(*filters).group_by(*group).order_by(count.desc(), last_seen.desc()).limit(limit)
    ).all()
    if dimension is None:
        return [_signature(row[0], row[1], row[2], row[3]) for row in rows]
    lookup = names(db, {row[0] for row in rows}) if names else {}
    return [
        _signature(
            row[1], row[2], row[3], row[4],
            lookup.get(row[0], (None, None))[1], lookup.get(row[0], (None, None))[0],
        )
        for row in rows
    ]


def _series(db: Session, window: AdminWindow, events: Subquery) -> list[dict[str, Any]]:
    """Bucketed trend: errors from the ledger, usage from assistant messages.

    Buckets follow the window granularity/timezone via the shared helper (day
    by default), so this series lines up with the other admin engines.
    """
    error_bucket = bucket_expr(db, window, events.c.seen_at).label("bucket")
    error_rows = db.execute(
        select(error_bucket, func.count().label("errors"))
        .where(events.c.status.in_(_ERROR_STATUSES))
        .group_by(error_bucket)
        .order_by(error_bucket)
    ).all()

    usage_bucket = bucket_expr(db, window).label("bucket")
    usage_rows = db.execute(
        select(
            usage_bucket,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
        )
        .where(*scope_conditions(window))
        .group_by(usage_bucket)
        .order_by(usage_bucket)
    ).all()

    points: dict[datetime, dict[str, Any]] = {}

    def point(bucket: datetime) -> dict[str, Any]:
        return points.setdefault(bucket, {
            "bucket": bucket, "requests": 0, "total_tokens": 0,
            "total_cost": Decimal(0), "errors": 0, "cache_read_tokens": 0,
        })

    for bucket, errors in error_rows:
        point(bucket)["errors"] = int(errors)
    for bucket, requests, tokens, cost, cache_read in usage_rows:
        usage = point(bucket)
        usage["requests"] = int(requests or 0)
        usage["total_tokens"] = int(tokens or 0)
        usage["total_cost"] = Decimal(str(cost or 0))
        usage["cache_read_tokens"] = int(cache_read or 0)
    return [points[bucket] for bucket in sorted(points)]


def errors(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Error analytics for one window (matches ``AdminErrors``)."""
    events = _request_events(window)
    total, failed, cancelled = _totals(db, events)
    error_rate = round((failed + cancelled) / total * 100, 2) if total else 0.0
    return {
        "range": window_range(window),
        "failed_requests": failed,
        "cancelled_requests": cancelled,
        "error_rate": error_rate,
        "by_code": _by_route(db, events, None, limit),
        "by_model": _by_route(
            db, events, events.c.model_id, limit, lambda d, ids: _name_lookup(d, ids, models=True)
        ),
        "by_provider": _by_route(
            db, events, events.c.provider_id, limit, lambda d, ids: _name_lookup(d, ids, models=False)
        ),
        "series": _series(db, window, events),
    }
