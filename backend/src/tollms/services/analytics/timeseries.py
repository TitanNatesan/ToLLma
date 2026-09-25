"""Bucketed time series for one API key.

Three grouped queries per call (points, latency, stacked tokens); the ``dual``
cost/token series is derived from the request buckets, so no extra scan.
Buckets follow the window granularity and timezone (hour/day/week). Stacked
rows keep the frozen flat shape ``{bucket, <model|provider|endpoint>: tokens}``
so a chart can pivot directly; unknown labels are grouped under ``unknown``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog
from tollms.services.analytics.aggregations import (
    STATUS_CANCELLED,
    STATUS_FAILED,
    STATUS_SUCCESS,
    bucket_expr,
    scope,
)

logger = logging.getLogger(__name__)

GROUP_COLUMNS = ("model", "provider", "endpoint")
GROUP_EXPRS: dict[str, Any] = {
    "model": ApiRequestLog.model,
    "provider": ApiRequestLog.provider,
    "endpoint": ApiRequestLog.endpoint,
}


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def _latency_map(db: Session, conditions: list[Any], bucket: Any) -> dict[Any, tuple[Any, Any]]:
    rows = db.execute(
        select(
            bucket,
            func.avg(ApiRequestLog.latency_ms),
            func.percentile_cont(0.95).within_group(ApiRequestLog.latency_ms),
        )
        .where(*conditions)
        .group_by(bucket)
    ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def _stacked(
    db: Session,
    conditions: list[Any],
    bucket: Any,
    column: Any,
) -> list[dict[str, Any]]:
    rows = db.execute(
        select(bucket, column, func.coalesce(func.sum(ApiRequestLog.total_tokens), 0))
        .where(*conditions)
        .group_by(bucket, column)
        .order_by(bucket)
    ).all()
    grouped: dict[Any, dict[str, int]] = {}
    for moment, label, tokens in rows:
        grouped.setdefault(moment, {})[label or "unknown"] = int(tokens or 0)
    return [{"bucket": moment, **labels} for moment, labels in grouped.items()]


def series(
    db: Session,
    window: Any,
    *,
    key_id: Any = None,
    group_by: str = "model",
) -> dict[str, Any]:
    """Points, stacked tokens, dual cost/token and latency buckets (3 queries)."""
    conditions = scope(window, key_id=key_id)
    bucket = bucket_expr(db, window)
    point_rows = db.execute(
        select(
            bucket,
            func.count(ApiRequestLog.id),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_SUCCESS),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_FAILED),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_CANCELLED),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
        )
        .where(*conditions)
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    latency = _latency_map(db, conditions, bucket)
    points: list[dict[str, Any]] = []
    dual: list[dict[str, Any]] = []
    latency_series: list[dict[str, Any]] = []
    for row in point_rows:
        moment = row[0]
        cost = Decimal(str(row[5] or 0))
        tokens = int(row[6] or 0)
        points.append(
            {
                "bucket": moment,
                "requests": int(row[1] or 0),
                "success": int(row[2] or 0),
                "failed": int(row[3] or 0),
                "cancelled": int(row[4] or 0),
                "cost": cost,
                "tokens": tokens,
            }
        )
        dual.append({"bucket": moment, "cost": cost, "tokens": tokens})
        avg_latency, p95 = latency.get(moment, (None, None))
        latency_series.append(
            {"bucket": moment, "avg_latency_ms": _f(avg_latency), "p95_ms": _f(p95)}
        )
    return {
        "points": points,
        "stacked": _stacked(db, conditions, bucket, GROUP_EXPRS.get(group_by, ApiRequestLog.model)),
        "dual": dual,
        "latency": latency_series,
    }
