"""Provider + model dimension rows from one grouped scan of the request log.

A single ``GROUPING SETS`` query produces both dimensions (and, for the
platform payload, the endpoint dimension) without fan-out:

* ``(provider, model)`` rows carry requests/success/errors/spend/tokens and the
  latency sum/count needed to fold exact provider averages;
* ``(endpoint)`` rows carry the endpoint dimension (``endpoint`` is NOT NULL
  while every dimension row has it NULL, so the two are separable without
  ``grouping()``).

Registered ``AIModel`` prices are joined through a per-``model_id`` deduplicated
subquery (max price per model name), so cache-savings math can be derived from
the same grouped rows even when several providers register the same model id —
and without multiplying request counts.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog
from tollms.models.registered_model import AIModel
from tollms.services.analytics.aggregations import (
    STATUS_CANCELLED,
    STATUS_FAILED,
    STATUS_SUCCESS,
    TOP_LIMIT,
    scope,
)

logger = logging.getLogger(__name__)


def price_subquery():
    """One row per model name: max registered input/cache-read price (0 if none)."""
    return (
        select(
            AIModel.model_id.label("model_id"),
            func.max(AIModel.input_price).label("input_price"),
            func.max(AIModel.cache_read_price).label("cache_read_price"),
        )
        .where(AIModel.is_deleted.is_(False))
        .group_by(AIModel.model_id)
        .subquery()
    )


def _row(row: Any) -> dict[str, Any]:
    return {
        "provider": row[0],
        "model": row[1],
        "endpoint": row[2],
        "requests": int(row[3] or 0),
        "success": int(row[4] or 0),
        "errors": int(row[5] or 0),
        "cost": Decimal(str(row[6] or 0)),
        "tokens": int(row[7] or 0),
        "latency_sum": float(row[8] or 0),
        "latency_count": int(row[9] or 0),
        "cache_read_tokens": int(row[10] or 0),
        "input_price": row[11],
        "cache_read_price": row[12],
    }


def dimension_rows(
    db: Session,
    window: Any,
    *,
    key_id: Any = None,
    user_id: Any = None,
) -> dict[str, list[dict[str, Any]]]:
    """One grouped scan -> ``{"dimensions": [(provider, model) rows], "endpoints": [...]}``."""
    prices = price_subquery()
    rows = db.execute(
        select(
            ApiRequestLog.provider,
            ApiRequestLog.model,
            ApiRequestLog.endpoint,
            func.count(ApiRequestLog.id),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_SUCCESS),
            func.count(ApiRequestLog.id).filter(
                ApiRequestLog.status.in_((STATUS_FAILED, STATUS_CANCELLED))
            ),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.latency_ms), 0),
            func.count(ApiRequestLog.latency_ms),
            func.coalesce(func.sum(ApiRequestLog.cache_read_tokens), 0),
            func.max(prices.c.input_price),
            func.max(prices.c.cache_read_price),
        )
        .select_from(ApiRequestLog)
        .outerjoin(prices, prices.c.model_id == ApiRequestLog.model)
        .where(*scope(window, key_id=key_id, user_id=user_id))
        .group_by(
            func.grouping_sets(
                tuple_(ApiRequestLog.provider, ApiRequestLog.model),
                tuple_(ApiRequestLog.endpoint),
            )
        )
        .order_by(func.count(ApiRequestLog.id).desc())
    ).all()
    dimensions: list[dict[str, Any]] = []
    endpoints: list[dict[str, Any]] = []
    for row in rows:
        shaped = _row(row)
        if shaped["endpoint"] is None:
            dimensions.append(shaped)
        else:
            endpoints.append(shaped)
    return {"dimensions": dimensions, "endpoints": endpoints}


def _avg(row: dict[str, Any]) -> float | None:
    if not row["latency_count"]:
        return None
    return row["latency_sum"] / row["latency_count"]


def provider_rows(rows: list[dict[str, Any]], *, limit: int = TOP_LIMIT) -> list[dict[str, Any]]:
    """Fold (provider, model) rows into spend-ranked provider rows."""
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = row["provider"] or "unknown"
        bucket = buckets.setdefault(
            name,
            {
                "provider": name,
                "requests": 0,
                "errors": 0,
                "spend": Decimal(0),
                "tokens": 0,
                "latency_sum": 0.0,
                "latency_count": 0,
            },
        )
        bucket["requests"] += row["requests"]
        bucket["errors"] += row["errors"]
        bucket["spend"] += row["cost"]
        bucket["tokens"] += row["tokens"]
        bucket["latency_sum"] += row["latency_sum"]
        bucket["latency_count"] += row["latency_count"]
    shaped = [
        {
            "provider": bucket["provider"],
            "requests": bucket["requests"],
            "spend": bucket["spend"],
            "tokens": bucket["tokens"],
            "avg_latency_ms": round(bucket["latency_sum"] / bucket["latency_count"], 2)
            if bucket["latency_count"]
            else None,
            "error_rate": round(bucket["errors"] / bucket["requests"], 4) if bucket["requests"] else 0.0,
        }
        for bucket in buckets.values()
    ]
    shaped.sort(key=lambda item: (item["spend"], item["requests"]), reverse=True)
    return shaped[:limit]
