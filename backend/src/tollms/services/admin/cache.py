"""Prompt-cache analytics: tokens, costs, hit rate and net savings.

Savings math mirrors the per-conversation usage engine: per model, cache reads
bill below the input rate and cache writes bill at a premium, and both are
counted only when the model publishes the relevant rate (net of writes).
Prices come from registered model rows; repository pricing is not merged here
(keep aggregation to one join).

``hit_rate`` = cache_read / (cache_read + cache_write), i.e. the share of
cache-tracked input tokens served from cache (0..1).

Engines return plain mappings (validated by the router's ``AdminCache``
response model); this package never imports from ``tollms.api``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message
from tollms.models.model_repository import RepositoryModel
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services.admin import AdminWindow
from tollms.services.admin.usage import scope_conditions, window_range

logger = logging.getLogger(__name__)

_MILLION = Decimal(1_000_000)


def model_cache_rows(db: Session, window: AdminWindow) -> list[dict[str, Any]]:
    """Per (provider, model) cache aggregates plus the prices savings needs."""
    rows = db.execute(
        select(
            Message.provider_id,
            Provider.name,
            Message.model_id,
            AIModel.name,
            func.count(Message.id),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_cost), 0),
            func.coalesce(func.sum(Message.cache_write_cost), 0),
            AIModel.input_price,
            AIModel.cache_read_price,
            AIModel.cache_write_price,
            func.coalesce(RepositoryModel.supports_prompt_caching, False),
        )
        .select_from(Message)
        .outerjoin(AIModel, AIModel.id == Message.model_id)
        .outerjoin(Provider, Provider.id == Message.provider_id)
        .outerjoin(RepositoryModel, RepositoryModel.model_key == AIModel.repository_model_key)
        .where(*scope_conditions(window))
        .group_by(
            Message.provider_id,
            Provider.name,
            Message.model_id,
            AIModel.name,
            AIModel.input_price,
            AIModel.cache_read_price,
            AIModel.cache_write_price,
            RepositoryModel.supports_prompt_caching,
        )
    ).all()
    return [
        {
            "provider_id": row[0],
            "provider_name": row[1],
            "model_id": row[2],
            "model_name": row[3],
            "requests": int(row[4] or 0),
            "cache_read_tokens": int(row[5] or 0),
            "cache_write_tokens": int(row[6] or 0),
            "cache_read_cost": Decimal(str(row[7] or 0)),
            "cache_write_cost": Decimal(str(row[8] or 0)),
            "input_price": row[9],
            "cache_read_price": row[10],
            "cache_write_price": row[11],
            "supports_caching": bool(row[12]) or bool(row[10]) or bool(row[11]),
        }
        for row in rows
    ]


def _row_savings(row: dict[str, Any]) -> Decimal:
    """Net savings for one grouped row (reads minus the write premium)."""
    input_price = row["input_price"]
    savings = Decimal(0)
    if input_price and row["cache_read_price"]:
        savings += (
            Decimal(row["cache_read_tokens"])
            * (input_price - row["cache_read_price"])
            / _MILLION
        )
    if input_price and row["cache_write_price"]:
        savings += (
            Decimal(row["cache_write_tokens"])
            * (input_price - row["cache_write_price"])
            / _MILLION
        )
    return savings


def savings_of(rows: list[dict[str, Any]]) -> Decimal:
    """Net cache savings across grouped model rows."""
    return sum((_row_savings(row) for row in rows), Decimal(0))


def savings_for(db: Session, window: AdminWindow) -> Decimal:
    """Net cache savings for the window (one grouped pass, no writes)."""
    return savings_of(model_cache_rows(db, window))


def _hit_rate(cached_tokens: int, write_tokens: int) -> float:
    total = cached_tokens + write_tokens
    return round(cached_tokens / total, 4) if total else 0.0


def _cache_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": row["model_id"],
        "name": row["model_name"] or "Unknown",
        "requests": row["requests"],
        "cached_tokens": row["cache_read_tokens"],
        "cache_write_tokens": row["cache_write_tokens"],
        "cache_read_cost": row["cache_read_cost"],
        "cache_write_cost": row["cache_write_cost"],
        "savings": _row_savings(row),
        "hit_rate": _hit_rate(row["cache_read_tokens"], row["cache_write_tokens"]),
        "supports_caching": row["supports_caching"],
    }


def _provider_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold model rows into provider rows (one pass, no extra queries)."""
    buckets: dict[Any, dict[str, Any]] = {}
    for row in rows:
        key = row["provider_id"]
        bucket = buckets.get(key)
        if bucket is None:
            bucket = buckets[key] = {
                "key": key,
                "name": row["provider_name"] or "Unknown",
                "requests": 0,
                "cached_tokens": 0,
                "cache_write_tokens": 0,
                "cache_read_cost": Decimal(0),
                "cache_write_cost": Decimal(0),
                "savings": Decimal(0),
                "hit_rate": 0.0,
                "supports_caching": False,
            }
        bucket["requests"] += row["requests"]
        bucket["cached_tokens"] += row["cache_read_tokens"]
        bucket["cache_write_tokens"] += row["cache_write_tokens"]
        bucket["cache_read_cost"] += row["cache_read_cost"]
        bucket["cache_write_cost"] += row["cache_write_cost"]
        bucket["savings"] += _row_savings(row)
        bucket["supports_caching"] = bucket["supports_caching"] or row["supports_caching"]
    for bucket in buckets.values():
        bucket["hit_rate"] = _hit_rate(bucket["cached_tokens"], bucket["cache_write_tokens"])
    return sorted(
        buckets.values(),
        key=lambda bucket: bucket["cached_tokens"] + bucket["cache_write_tokens"],
        reverse=True,
    )


def cache(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Cache totals, savings and top provider/model rows (matches ``AdminCache``)."""
    requests, cached_tokens, write_tokens, read_cost, write_cost, providers_with_cache = (
        db.execute(
            select(
                func.count(Message.id),
                func.coalesce(func.sum(Message.cache_read_tokens), 0),
                func.coalesce(func.sum(Message.cache_write_tokens), 0),
                func.coalesce(func.sum(Message.cache_read_cost), 0),
                func.coalesce(func.sum(Message.cache_write_cost), 0),
                func.count(func.distinct(Message.provider_id)).filter(
                    func.coalesce(Message.cache_read_tokens, 0)
                    + func.coalesce(Message.cache_write_tokens, 0)
                    > 0
                ),
            )
            .select_from(Message)
            .where(*scope_conditions(window))
        ).one()
    )
    cached_tokens, write_tokens = int(cached_tokens or 0), int(write_tokens or 0)
    active = [
        row
        for row in model_cache_rows(db, window)
        if row["cache_read_tokens"] or row["cache_write_tokens"]
    ]
    active.sort(
        key=lambda row: row["cache_read_tokens"] + row["cache_write_tokens"],
        reverse=True,
    )
    return {
        "range": window_range(window),
        "cached_tokens": cached_tokens,
        "cache_write_tokens": write_tokens,
        "cache_read_cost": Decimal(str(read_cost or 0)),
        "cache_write_cost": Decimal(str(write_cost or 0)),
        "savings": savings_of(active),
        "hit_rate": _hit_rate(cached_tokens, write_tokens),
        "providers_with_cache": int(providers_with_cache or 0),
        "by_provider": _provider_rows(active)[:limit],
        "by_model": [_cache_row(row) for row in active[:limit]],
    }
