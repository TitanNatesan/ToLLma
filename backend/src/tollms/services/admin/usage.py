"""Platform-wide usage analytics and the shared window/bucket primitives.

Fact table: ``messages`` (assistant generations). Aggregates are counts,
tokens, costs and latencies only — never content. The model/provider
breakdowns reuse the dedicated engines so every admin page reports the same
numbers for the same window.

``sql_timezone`` / ``bucket_expr`` / ``scope_conditions`` are shared with the
token, cost and media engines: series buckets are ``date_trunc`` over the
window timezone, so daily charts line up with the resolved range.

Engines return plain mappings (validated by the router's ``AdminUsage``
response model); this package never imports from ``tollms.api``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message, MessageStatus, Role
from tollms.models.user import User
from tollms.services.admin import AdminWindow
from tollms.services.admin import models as models_service
from tollms.services.admin import providers as providers_service

logger = logging.getLogger(__name__)

_GRANULARITIES = frozenset({"hour", "day", "week", "month"})
_TOP_LIMIT = 10
_TZ_CACHE: dict[str, str] = {}


def window_range(window: AdminWindow) -> dict[str, Any]:
    """AdminRange payload for the resolved window."""
    return {
        "preset": window.preset,
        "timezone": window.timezone,
        "start": window.start,
        "end": window.end,
        "prev_start": window.prev_start,
        "prev_end": window.prev_end,
    }


def sql_timezone(db: Session, name: str) -> str:
    """A timezone name PostgreSQL accepts for ``timezone()``, else UTC.

    Browsers report CLDR ids PostgreSQL's tzdata may not carry; validation is
    memoized per process so a bad name degrades to UTC instead of failing.
    """
    candidate = name or "UTC"
    cached = _TZ_CACHE.get(candidate)
    if cached is not None:
        return cached
    try:
        db.execute(select(func.timezone(candidate, func.now()))).scalar()
    except Exception:
        db.rollback()
        logger.warning("admin usage: PostgreSQL rejected timezone %r; using UTC", candidate)
        _TZ_CACHE[candidate] = "UTC"
        return "UTC"
    _TZ_CACHE[candidate] = candidate
    return candidate


def bucket_expr(db: Session, window: AdminWindow, column: Any = None) -> Any:
    """``date_trunc`` bucket for the window granularity in its timezone."""
    granularity = window.granularity if window.granularity in _GRANULARITIES else "day"
    target = Message.created_at if column is None else column
    return func.date_trunc(granularity, func.timezone(sql_timezone(db, window.timezone), target))


def scope_conditions(window: AdminWindow, *, previous: bool = False) -> list[Any]:
    """Fact-table filters: live assistant generations in the window."""
    start, end = (window.prev_start, window.prev_end) if previous else (window.start, window.end)
    return [
        Message.is_deleted.is_(False),
        Message.role == Role.ASSISTANT,
        Message.created_at >= start,
        Message.created_at < end,
    ]


def _series(db: Session, window: AdminWindow) -> list[dict[str, Any]]:
    """Usage per bucket for the window's granularity, ordered by bucket."""
    bucket = bucket_expr(db, window)
    rows = db.execute(
        select(
            bucket,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
        )
        .select_from(Message)
        .where(*scope_conditions(window))
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        {
            "bucket": row[0],
            "requests": int(row[1] or 0),
            "total_tokens": int(row[2] or 0),
            "total_cost": Decimal(str(row[3] or 0)),
            "errors": int(row[4] or 0),
            "cache_read_tokens": int(row[5] or 0),
        }
        for row in rows
        if row[0] is not None
    ]


def usage(db: Session, window: AdminWindow) -> dict[str, Any]:
    """Usage totals, trend and top model/provider rows (matches ``AdminUsage``)."""
    requests, failed, active_users, total_tokens, total_cost, conversations = db.execute(
        select(
            func.count(Message.id),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
            func.count(func.distinct(Message.user_id)),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.count(func.distinct(Message.conversation_id)),
        )
        .select_from(Message)
        .where(*scope_conditions(window))
    ).one()
    new_users = db.execute(
        select(func.count(User.id)).where(
            User.is_deleted.is_(False),
            User.created_at >= window.start,
            User.created_at < window.end,
        )
    ).scalar_one()
    return {
        "range": window_range(window),
        "requests": int(requests or 0),
        "failed_requests": int(failed or 0),
        "active_users": int(active_users or 0),
        "new_users": int(new_users or 0),
        "conversations": int(conversations or 0),
        "total_tokens": int(total_tokens or 0),
        "total_cost": Decimal(str(total_cost or 0)),
        "series": _series(db, window),
        "by_model": models_service.models(db, window, limit=_TOP_LIMIT)["rows"],
        "by_provider": providers_service.providers(db, window, limit=_TOP_LIMIT)["rows"],
    }
