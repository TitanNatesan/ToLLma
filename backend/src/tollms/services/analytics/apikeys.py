"""API-key inventory and per-key aggregates over keys + request logs.

Covers both audiences:

* platform sections (``inventory``, ``key_breakdown``, ``key_metrics``)
  consumed by ``/api/analytics/platform`` and the admin API-key section;
* user-scoped helpers (``require_owned_key``, ``list_keys``) where a foreign or
  soft-deleted key raises ``NotFoundError`` (no existence oracle).

Grouped SQL only. ``inventory`` returns the all-time key counts and the
window's daily creation series in one ``ROLLUP`` scan (the grand-total row is
identified by ``grouping()``, so only window days form the growth series).
``key_breakdown`` folds per (key, model) groups, including the registered
per-model price needed for cache savings.

Definitions (documented approximations): ``active`` = enabled; ``disabled`` =
not enabled; ``expired`` = ``expires_at`` in the past; ``rotated`` =
``rotation_count > 0``.
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session, selectinload

from tollms.core.exceptions import NotFoundError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.services.analytics.aggregations import (
    STATUS_CANCELLED,
    STATUS_FAILED,
    TOP_LIMIT,
    scope,
    sql_timezone,
)
from tollms.services.analytics.costs import row_savings
from tollms.services.analytics.providers import price_subquery

logger = logging.getLogger(__name__)


def require_owned_key(
    db: Session,
    key_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    with_rules: bool = False,
) -> ApiKey:
    """Owned, live key or ``NotFoundError`` (cross-owner access is never a 403)."""
    stmt = select(ApiKey).where(
        ApiKey.id == key_id,
        ApiKey.user_id == user_id,
        ApiKey.is_deleted.is_(False),
    )
    if with_rules:
        stmt = stmt.options(selectinload(ApiKey.ip_rules))
    key = db.scalar(stmt)
    if key is None:
        raise NotFoundError("API key not found")
    return key


def key_payload(key: ApiKey) -> dict[str, Any]:
    """Metadata subset for the detail header."""
    return {
        "key_id": key.id,
        "name": key.name,
        "key_prefix": key.key_prefix,
        "enabled": key.enabled,
        "expires_at": key.expires_at,
    }


def inventory(db: Session, window: Any) -> dict[str, Any]:
    """All-time key counts + the window's daily creation series (one scan)."""
    bucket = func.date_trunc(
        "day",
        func.timezone(sql_timezone(db, window.timezone), ApiKey.created_at),
    )
    in_window = and_(ApiKey.created_at >= window.start, ApiKey.created_at < window.end)
    window_bucket = case((in_window, bucket), else_=None)
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(
            window_bucket,
            func.grouping(window_bucket),
            func.count(ApiKey.id),
            func.count(ApiKey.id).filter(ApiKey.enabled.is_(True)),
            func.count(ApiKey.id).filter(ApiKey.enabled.is_(False)),
            func.count(ApiKey.id).filter(
                ApiKey.expires_at.is_not(None), ApiKey.expires_at < now
            ),
            func.count(ApiKey.id).filter(ApiKey.rotation_count > 0),
        )
        .where(ApiKey.is_deleted.is_(False))
        .group_by(func.rollup(window_bucket))
        .order_by(window_bucket)
    ).all()
    counts = {"total": 0, "active": 0, "disabled": 0, "expired": 0, "rotated": 0}
    growth: list[dict[str, Any]] = []
    for row in rows:
        if int(row[1] or 0) == 1:  # grand total: grouping(window_bucket) = 1
            counts = {
                "total": int(row[2] or 0),
                "active": int(row[3] or 0),
                "disabled": int(row[4] or 0),
                "expired": int(row[5] or 0),
                "rotated": int(row[6] or 0),
            }
        elif row[0] is not None:
            growth.append({"bucket": row[0], "created": int(row[2] or 0)})
    return {**counts, "growth": growth}


def key_breakdown(
    db: Session,
    window: Any,
    *,
    user_id: Any = None,
    key_id: Any = None,
) -> list[dict[str, Any]]:
    """Per (key, model) request/spend/token/cache aggregates with model prices."""
    prices = price_subquery()
    conditions = scope(window, user_id=user_id, key_id=key_id)
    rows = db.execute(
        select(
            ApiRequestLog.api_key_id,
            ApiKey.name,
            ApiRequestLog.model,
            func.count(ApiRequestLog.id),
            func.count(ApiRequestLog.id).filter(
                ApiRequestLog.status.in_((STATUS_FAILED, STATUS_CANCELLED))
            ),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cache_read_tokens), 0),
            func.max(prices.c.input_price),
            func.max(prices.c.cache_read_price),
        )
        .select_from(ApiRequestLog)
        .join(ApiKey, ApiKey.id == ApiRequestLog.api_key_id)
        .outerjoin(prices, prices.c.model_id == ApiRequestLog.model)
        .where(*conditions, ApiKey.is_deleted.is_(False))
        .group_by(ApiRequestLog.api_key_id, ApiKey.name, ApiRequestLog.model)
    ).all()
    return [
        {
            "key_id": row[0],
            "name": row[1] or "unknown",
            "model": row[2],
            "requests": int(row[3] or 0),
            "errors": int(row[4] or 0),
            "spend": Decimal(str(row[5] or 0)),
            "tokens": int(row[6] or 0),
            "cache_read_tokens": int(row[7] or 0),
            "input_price": row[8],
            "cache_read_price": row[9],
        }
        for row in rows
    ]


def _fold(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold per-(key, model) groups into per-key totals."""
    buckets: dict[Any, dict[str, Any]] = {}
    for row in rows:
        bucket = buckets.setdefault(
            row["key_id"],
            {
                "key_id": row["key_id"],
                "name": row["name"],
                "requests": 0,
                "errors": 0,
                "spend": Decimal(0),
                "tokens": 0,
                "savings": Decimal(0),
            },
        )
        bucket["requests"] += row["requests"]
        bucket["errors"] += row["errors"]
        bucket["spend"] += row["spend"]
        bucket["tokens"] += row["tokens"]
        bucket["savings"] += row_savings(row)
    return list(buckets.values())


def key_metrics(rows: list[dict[str, Any]], *, limit: int = TOP_LIMIT) -> dict[str, Any]:
    """Top/spend/error/cache-savings key sections from the folded breakdown."""
    folded = _fold(rows)
    total_spend = sum((bucket["spend"] for bucket in folded), Decimal(0))

    def spend_share(bucket: dict[str, Any]) -> float:
        return round(float(bucket["spend"] / total_spend), 4) if total_spend else 0.0

    top = sorted(folded, key=lambda b: (b["requests"], b["spend"]), reverse=True)[:limit]
    spend = sorted(folded, key=lambda b: b["spend"], reverse=True)[:limit]
    errors = sorted(folded, key=lambda b: b["errors"], reverse=True)[:limit]
    savings = sorted(folded, key=lambda b: b["savings"], reverse=True)[:limit]
    return {
        "top_keys": [
            {
                "key_id": b["key_id"],
                "name": b["name"],
                "requests": b["requests"],
                "spend": b["spend"],
                "tokens": b["tokens"],
            }
            for b in top
        ],
        "key_spend": [
            {"key_id": b["key_id"], "name": b["name"], "spend": b["spend"], "share": spend_share(b)}
            for b in spend
        ],
        "key_errors": [
            {
                "key_id": b["key_id"],
                "name": b["name"],
                "errors": b["errors"],
                "error_rate": round(b["errors"] / b["requests"], 4) if b["requests"] else 0.0,
            }
            for b in errors
        ],
        "key_cache_savings": [
            {"key_id": b["key_id"], "name": b["name"], "savings": b["savings"]} for b in savings
        ],
    }


def list_keys(db: Session, user_id: uuid.UUID, window: Any) -> list[dict[str, Any]]:
    """One outer-join scan: live keys of one user with window aggregates."""
    join_condition = and_(
        ApiRequestLog.api_key_id == ApiKey.id,
        ApiRequestLog.created_at >= window.start,
        ApiRequestLog.created_at < window.end,
    )
    rows = db.execute(
        select(
            ApiKey.id,
            ApiKey.name,
            ApiKey.key_prefix,
            ApiKey.enabled,
            ApiKey.last_used_at,
            func.count(ApiRequestLog.id),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == "success"),
            func.count(ApiRequestLog.id).filter(
                ApiRequestLog.status.in_((STATUS_FAILED, STATUS_CANCELLED))
            ),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.avg(ApiRequestLog.latency_ms),
        )
        .select_from(ApiKey)
        .outerjoin(ApiRequestLog, join_condition)
        .where(ApiKey.user_id == user_id, ApiKey.is_deleted.is_(False))
        .group_by(
            ApiKey.id,
            ApiKey.name,
            ApiKey.key_prefix,
            ApiKey.enabled,
            ApiKey.last_used_at,
        )
        .order_by(func.count(ApiRequestLog.id).desc(), ApiKey.created_at.desc())
    ).all()
    return [
        {
            "key_id": row[0],
            "name": row[1],
            "key_prefix": row[2],
            "enabled": bool(row[3]),
            "requests": int(row[5] or 0),
            "success_rate": round(int(row[6] or 0) / int(row[5]), 4) if int(row[5] or 0) else 0.0,
            "error_rate": round(int(row[7] or 0) / int(row[5]), 4) if int(row[5] or 0) else 0.0,
            "spend": Decimal(str(row[8] or 0)),
            "tokens": int(row[9] or 0),
            "avg_latency_ms": float(row[10]) if row[10] is not None else None,
            "last_used_at": row[4],
        }
        for row in rows
    ]
