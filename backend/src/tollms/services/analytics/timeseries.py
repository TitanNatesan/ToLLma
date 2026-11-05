"""Bucketed time series for one API key.

Three grouped queries per call (points, latency, stacked tokens); the ``dual``
cost/token series is derived from the request buckets, so no extra scan.
Buckets follow the window granularity and timezone (hour/day/week). Stacked
rows keep the frozen flat shape ``{bucket, <model|provider|endpoint>: tokens}``
so a chart can pivot directly; unknown labels are grouped under ``unknown``.

Key-scoped calls merge the in-app-chat ledger (``request_logs``,
``api_key_id = :key``) into every section: per-bucket points sum both ledgers,
latency merges exactly over the ``UNION ALL`` of bucketed latencies, and stacked
tokens merge per (bucket, label) with in-app rows under their registry
provider/model names — or ``"chat"`` when grouped by endpoint (``request_logs``
has no endpoint column, same label as ``api/keys/analytics.py``). The ledgers
have disjoint writers, so merged buckets never double-count. UTC half-open
``[start, end)`` windows; errors propagate (raise, never silent-empty).
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, union_all
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services.analytics.aggregations import (
    CHAT_CANCELLED_STATUSES,
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

#: In-app-chat endpoint label (``request_logs`` has no endpoint column).
CHAT_ENDPOINT = "chat"


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


def _chat_conditions(window: Any, *, key_id: Any) -> list[Any]:
    """In-app-chat conditions: same UTC half-open window on ``created_at``."""
    return [
        RequestLog.api_key_id == key_id,
        RequestLog.created_at >= window.start,
        RequestLog.created_at < window.end,
    ]


def _combined_latency_map(
    db: Session, conditions: list[Any], bucket: Any, chat_conditions: list[Any], chat_bucket: Any
) -> dict[Any, tuple[Any, Any]]:
    """Exact per-bucket avg/p95 over the UNION ALL of gateway + chat latencies."""
    union = union_all(
        select(bucket.label("b"), ApiRequestLog.latency_ms.label("lat")).where(
            *conditions, ApiRequestLog.latency_ms.is_not(None)
        ),
        select(chat_bucket.label("b"), RequestLog.latency_ms.label("lat")).where(
            *chat_conditions, RequestLog.latency_ms.is_not(None)
        ),
    ).subquery()
    rows = db.execute(
        select(
            union.c.b,
            func.avg(union.c.lat),
            func.percentile_cont(0.95).within_group(union.c.lat),
        ).group_by(union.c.b)
    ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def _chat_stacked(
    db: Session, chat_conditions: list[Any], chat_bucket: Any, group_by: str
) -> list[dict[str, Any]]:
    """Per-bucket chat token stacks (registry names; ``"chat"`` for endpoint)."""
    if group_by == "endpoint":
        rows = db.execute(
            select(chat_bucket, func.coalesce(func.sum(RequestLog.total_tokens), 0))
            .where(*chat_conditions)
            .group_by(chat_bucket)
            .order_by(chat_bucket)
        ).all()
        return [{"bucket": moment, CHAT_ENDPOINT: int(tokens or 0)} for moment, tokens in rows]
    if group_by == "provider":
        rows = db.execute(
            select(chat_bucket, Provider.name, func.coalesce(func.sum(RequestLog.total_tokens), 0))
            .select_from(RequestLog)
            .outerjoin(Provider, Provider.id == RequestLog.provider_id)
            .where(*chat_conditions)
            .group_by(chat_bucket, Provider.name)
            .order_by(chat_bucket)
        ).all()
    else:
        rows = db.execute(
            select(chat_bucket, AIModel.model_id, func.coalesce(func.sum(RequestLog.total_tokens), 0))
            .select_from(RequestLog)
            .outerjoin(AIModel, AIModel.id == RequestLog.model_id)
            .where(*chat_conditions)
            .group_by(chat_bucket, AIModel.model_id)
            .order_by(chat_bucket)
        ).all()
    grouped: dict[Any, dict[str, int]] = {}
    for moment, label, tokens in rows:
        cell = grouped.setdefault(moment, {})
        cell[label or "unknown"] = cell.get(label or "unknown", 0) + int(tokens or 0)
    return [{"bucket": moment, **labels} for moment, labels in grouped.items()]


def _merge_stacked(
    gateway: list[dict[str, Any]], chat: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Sum per (bucket, label) token stacks across both ledgers."""
    merged: dict[Any, dict[str, int]] = {}
    for entry in list(gateway) + list(chat):
        moment = entry["bucket"]
        cell = merged.setdefault(moment, {})
        for label, tokens in entry.items():
            if label == "bucket":
                continue
            cell[label] = cell.get(label, 0) + int(tokens or 0)
    return [{"bucket": moment, **labels} for moment, labels in sorted(merged.items())]


def series(
    db: Session,
    window: Any,
    *,
    key_id: Any = None,
    group_by: str = "model",
) -> dict[str, Any]:
    """Points, stacked tokens, dual cost/token and latency buckets.

    Gateway-only (3 queries); key-scoped merges the in-app-chat ledger
    (points + exact latency union + merged stacks).
    """
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
    if key_id is None:
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
    # Key-scoped: merge gateway + in-app-chat buckets in Python (disjoint writers).
    chat_conditions = _chat_conditions(window, key_id=key_id)
    chat_bucket = bucket_expr(db, window, RequestLog.created_at)
    chat_rows = db.execute(
        select(
            chat_bucket,
            func.count(RequestLog.id),
            func.count(RequestLog.id).filter(RequestLog.status == STATUS_SUCCESS),
            func.count(RequestLog.id).filter(RequestLog.status == STATUS_FAILED),
            func.count(RequestLog.id).filter(RequestLog.status.in_(CHAT_CANCELLED_STATUSES)),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
        )
        .where(*chat_conditions)
        .group_by(chat_bucket)
        .order_by(chat_bucket)
    ).all()
    merged: dict[Any, list[Any]] = {}
    for row in list(point_rows) + list(chat_rows):
        cell = merged.setdefault(row[0], [0, 0, 0, 0, Decimal(0), 0])
        cell[0] += int(row[1] or 0)
        cell[1] += int(row[2] or 0)
        cell[2] += int(row[3] or 0)
        cell[3] += int(row[4] or 0)
        cell[4] += Decimal(str(row[5] or 0))
        cell[5] += int(row[6] or 0)
    latency = _combined_latency_map(db, conditions, bucket, chat_conditions, chat_bucket)
    points = []
    dual = []
    latency_series = []
    for moment, cell in sorted(merged.items()):
        cost = cell[4]
        tokens = cell[5]
        points.append(
            {
                "bucket": moment,
                "requests": cell[0],
                "success": cell[1],
                "failed": cell[2],
                "cancelled": cell[3],
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
        "stacked": _merge_stacked(
            _stacked(db, conditions, bucket, GROUP_EXPRS.get(group_by, ApiRequestLog.model)),
            _chat_stacked(db, chat_conditions, chat_bucket, group_by),
        ),
        "dual": dual,
        "latency": latency_series,
    }
