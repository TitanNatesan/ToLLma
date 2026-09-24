"""Spend analytics: totals, projection, trend and top spenders.

Costs come from assistant message cost columns (provider-reported or
estimated), so they match the per-conversation usage engine. Cache savings
reuse the cache engine's per-model price math. ``estimated_share`` is the
0..1 fraction of requests whose usage was estimated rather than reported.

Engines return plain mappings (validated by the router's ``AdminCosts``
response model); this package never imports from ``tollms.api``.
"""

import calendar
import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message
from tollms.services.admin import AdminWindow
from tollms.services.admin import cache as cache_service
from tollms.services.admin import models as models_service
from tollms.services.admin import providers as providers_service
from tollms.services.admin import users as users_service
from tollms.services.admin.usage import bucket_expr, scope_conditions, window_range

logger = logging.getLogger(__name__)

_QUANTUM = Decimal("0.0001")


def _change_pct(current: Decimal, previous: Decimal) -> float | None:
    """Percent change vs. the preceding window (None when both are zero)."""
    current_value, previous_value = float(current), float(previous)
    if previous_value == 0:
        return None if current_value == 0 else 100.0
    return round((current_value - previous_value) / previous_value * 100, 1)


def _series(db: Session, window: AdminWindow) -> list[dict[str, Any]]:
    """Cost sums per bucket for the window's granularity, ordered by bucket."""
    bucket = bucket_expr(db, window)
    rows = db.execute(
        select(
            bucket,
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.input_cost), 0),
            func.coalesce(func.sum(Message.output_cost), 0),
            func.coalesce(func.sum(Message.cache_read_cost), 0),
            func.coalesce(func.sum(Message.cache_write_cost), 0),
            func.coalesce(func.sum(Message.reasoning_cost), 0),
        )
        .select_from(Message)
        .where(*scope_conditions(window))
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        {
            "bucket": row[0],
            "total_cost": Decimal(str(row[1] or 0)),
            "input_cost": Decimal(str(row[2] or 0)),
            "output_cost": Decimal(str(row[3] or 0)),
            "cache_read_cost": Decimal(str(row[4] or 0)),
            "cache_write_cost": Decimal(str(row[5] or 0)),
            "reasoning_cost": Decimal(str(row[6] or 0)),
        }
        for row in rows
        if row[0] is not None
    ]


def costs(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Spend totals, projection, trend and top rows (matches ``AdminCosts``)."""
    requests, input_cost, output_cost, total_cost, read_cost, write_cost, reasoning, estimated = (
        db.execute(
            select(
                func.count(Message.id),
                func.coalesce(func.sum(Message.input_cost), 0),
                func.coalesce(func.sum(Message.output_cost), 0),
                func.coalesce(func.sum(Message.total_cost), 0),
                func.coalesce(func.sum(Message.cache_read_cost), 0),
                func.coalesce(func.sum(Message.cache_write_cost), 0),
                func.coalesce(func.sum(Message.reasoning_cost), 0),
                func.count(Message.id).filter(Message.usage_estimated.is_(True)),
            )
            .select_from(Message)
            .where(*scope_conditions(window))
        ).one()
    )
    previous = db.execute(
        select(func.coalesce(func.sum(Message.total_cost), 0))
        .select_from(Message)
        .where(*scope_conditions(window, previous=True))
    ).scalar_one()
    requests = int(requests or 0)
    total_cost = Decimal(str(total_cost or 0))
    previous_cost = Decimal(str(previous or 0))
    days = max((window.end - window.start).total_seconds() / 86400, 1.0)
    month_days = calendar.monthrange(window.end.year, window.end.month)[1]
    projected = (total_cost / Decimal(str(days)) * month_days).quantize(_QUANTUM)
    return {
        "range": window_range(window),
        "total_cost": total_cost,
        "previous_cost": previous_cost,
        "change_pct": _change_pct(total_cost, previous_cost),
        "projected_month_cost": projected,
        "input_cost": Decimal(str(input_cost or 0)),
        "output_cost": Decimal(str(output_cost or 0)),
        "cache_cost": Decimal(str(read_cost or 0)) + Decimal(str(write_cost or 0)),
        "reasoning_cost": Decimal(str(reasoning or 0)),
        "cache_savings": cache_service.savings_for(db, window),
        "estimated_share": round(int(estimated or 0) / requests, 4) if requests else 0.0,
        "series": _series(db, window),
        "by_model": models_service.models(db, window, limit=limit)["rows"],
        "by_provider": providers_service.providers(db, window, limit=limit)["rows"],
        "top_users": users_service.users(db, window, limit=limit)["rows"],
    }
