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

Key-scoped calls additionally merge in-app-chat ``request_logs`` rows
(``api_key_id = :key``, same UTC half-open window). In-app rows resolve their
provider/model names through the registry (``Provider.name`` /
``AIModel.model_id``) and surface as ``"chat"`` in the endpoint dimension
(``request_logs`` has no endpoint column — same label as
``api/keys/analytics.py``). The ledgers have disjoint writers, so appended rows
never double-count. Chat errors fold ``"regenerated"`` into the error bucket
so every non-success row stays visible.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services.analytics.aggregations import (
    STATUS_CANCELLED,
    STATUS_FAILED,
    STATUS_SUCCESS,
    TOP_LIMIT,
    scope,
)

#: In-app-chat endpoint label (``request_logs`` has no endpoint column).
CHAT_ENDPOINT = "chat"

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


def _chat_dimension_rows(db: Session, window: Any, *, key_id: Any) -> list[dict[str, Any]]:
    """Per (provider, model) aggregates from the in-app-chat ledger (one scan)."""
    prices = price_subquery()
    rows = db.execute(
        select(
            Provider.name,
            AIModel.model_id,
            func.count(RequestLog.id),
            func.count(RequestLog.id).filter(RequestLog.status == STATUS_SUCCESS),
            func.count(RequestLog.id).filter(RequestLog.status != STATUS_SUCCESS),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.latency_ms), 0),
            func.count(RequestLog.latency_ms),
            func.coalesce(func.sum(RequestLog.cache_read_tokens), 0),
            func.max(prices.c.input_price),
            func.max(prices.c.cache_read_price),
        )
        .select_from(RequestLog)
        .outerjoin(AIModel, AIModel.id == RequestLog.model_id)
        .outerjoin(Provider, Provider.id == RequestLog.provider_id)
        .outerjoin(prices, prices.c.model_id == AIModel.model_id)
        .where(
            RequestLog.api_key_id == key_id,
            RequestLog.created_at >= window.start,
            RequestLog.created_at < window.end,
        )
        .group_by(Provider.name, AIModel.model_id)
    ).all()
    return [
        {
            "provider": row[0],
            "model": row[1],
            "endpoint": None,
            "requests": int(row[2] or 0),
            "success": int(row[3] or 0),
            "errors": int(row[4] or 0),
            "cost": Decimal(str(row[5] or 0)),
            "tokens": int(row[6] or 0),
            "latency_sum": float(row[7] or 0),
            "latency_count": int(row[8] or 0),
            "cache_read_tokens": int(row[9] or 0),
            "input_price": row[10],
            "cache_read_price": row[11],
        }
        for row in rows
    ]


def dimension_rows(
    db: Session,
    window: Any,
    *,
    key_id: Any = None,
    user_id: Any = None,
) -> dict[str, list[dict[str, Any]]]:
    """One grouped scan -> ``{"dimensions": [(provider, model) rows], "endpoints": [...]}``.

    Key-scoped merges the in-app-chat ledger (appended rows + a ``"chat"``
    endpoint row); platform/user scopes stay gateway-only.
    """
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
    if key_id is not None:
        # Disjoint writers: appended chat rows never double-count gateway rows.
        # Same-model rows from both ledgers are folded downstream in
        # `models_engine.model_rows` (per-model view); provider folding keeps
        # each ledger's own provider labels untouched.
        chat_dimensions = _chat_dimension_rows(db, window, key_id=key_id)
        dimensions.extend(chat_dimensions)
        chat_requests = sum(item["requests"] for item in chat_dimensions)
        if chat_requests:
            chat_cost = sum((item["cost"] for item in chat_dimensions), Decimal(0))
            chat_tokens = sum(item["tokens"] for item in chat_dimensions)
            chat_success = sum(item["success"] for item in chat_dimensions)
            chat_errors = sum(item["errors"] for item in chat_dimensions)
            merged = False
            for item in endpoints:
                if item["endpoint"] == CHAT_ENDPOINT:
                    item["requests"] += chat_requests
                    item["success"] += chat_success
                    item["errors"] += chat_errors
                    item["cost"] += chat_cost
                    item["tokens"] += chat_tokens
                    merged = True
                    break
            if not merged:
                endpoints.append(
                    {
                        "provider": None,
                        "model": None,
                        "endpoint": CHAT_ENDPOINT,
                        "requests": chat_requests,
                        "success": chat_success,
                        "errors": chat_errors,
                        "cost": chat_cost,
                        "tokens": chat_tokens,
                        "latency_sum": sum(item["latency_sum"] for item in chat_dimensions),
                        "latency_count": sum(item["latency_count"] for item in chat_dimensions),
                        "cache_read_tokens": sum(
                            item["cache_read_tokens"] for item in chat_dimensions
                        ),
                        "input_price": None,
                        "cache_read_price": None,
                    }
                )
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
