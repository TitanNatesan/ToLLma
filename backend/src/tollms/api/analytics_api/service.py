"""Feature service for `/api/analytics`: resolution, composition and caching.

Thin by design — every number comes from the reusable ``services/analytics``
engines; this module only resolves the request window, checks key ownership,
composes the frozen payloads and caches the result in Valkey for
``constants.ANALYTICS`` seconds (60s), keyed by endpoint + user + key + range +
extra params. Cache entries are best-effort: a Valkey failure degrades to a
direct PostgreSQL read.

Documented query counts per endpoint (grouped SQL only, no N+1):

* ``GET /platform`` — 6: totals (current+previous, one round-trip), dimension
  grouping sets, trailing costs, most-expensive request, key inventory+growth,
  key breakdown.
* ``GET /api-keys`` — 1: outer-join scan of the user's keys + window usage.
* ``GET /api-keys/{id}`` — 5: ownership, totals, dimensions, trailing costs,
  most-expensive request.
* ``GET /api-keys/{id}/timeseries`` — 4: ownership + points/stacked/latency.
* ``GET /api-keys/{id}/network`` — 6: ownership (+ IP rules), IP history,
  locations, devices, clients.
* ``GET /api-keys/{id}/insights`` — 3: ownership, totals, dimensions.
"""

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

from sqlalchemy.orm import Session

from tollms.models.api_key import IpRuleType
from tollms.models.user import User
from tollms.services.analytics import AnalyticsWindow
from tollms.services.analytics import aggregations
from tollms.services.analytics import apikeys as apikeys_engine
from tollms.services.analytics import costs as costs_engine
from tollms.services.analytics import insights as insights_engine
from tollms.services.analytics import models as models_engine
from tollms.services.analytics import network as network_engine
from tollms.services.analytics import providers as providers_engine
from tollms.services.analytics import timeseries as timeseries_engine
from tollms.services.analytics import tokens as tokens_engine
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)


@dataclass
class AnalyticsQuery:
    """Raw range request (preset + optional custom bounds + IANA timezone)."""

    preset: str = aggregations.DEFAULT_PRESET
    timezone: str = "UTC"
    start: date | None = None
    end: date | None = None


def resolve_window(query: AnalyticsQuery) -> AnalyticsWindow:
    return aggregations.resolve_window(query.preset, query.timezone, query.start, query.end)


def _digest(endpoint: str, window: AnalyticsWindow, extra: dict[str, Any] | None) -> str:
    """Stable cache identity: preset/timezone, the range end floored to the
    minute (preset windows end at ``now``), and the endpoint's extra params."""
    parts = [
        endpoint,
        window.preset,
        window.timezone,
        window.end.replace(second=0, microsecond=0).isoformat(),
        json.dumps(extra or {}, sort_keys=True, default=str),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def _cached(
    user_id: uuid.UUID,
    endpoint: str,
    window: AnalyticsWindow,
    extra: dict[str, Any] | None,
    loader: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """Valkey-cached loader (60s). Misses/failures fall through to ``loader``."""
    key = cache_keys.analytics(user_id, _digest(endpoint, window, extra))
    cached = cache_get_sync(key)
    if isinstance(cached, dict):
        return cached
    payload = loader()
    cache_set_sync(key, payload, ttl=cache_ttl.ANALYTICS)
    return payload


def _cost_section(
    db: Session,
    window: AnalyticsWindow,
    current: dict[str, Any],
    tokens_total: int,
    *,
    key_id: uuid.UUID | None,
) -> dict[str, Any]:
    return costs_engine.cost_payload(
        total=current["cost"],
        trailing=costs_engine.trailing_costs(db, window, key_id=key_id),
        window=window,
        tokens_total=tokens_total,
        requests_total=current["total"],
        expensive=costs_engine.most_expensive(db, window, key_id=key_id),
    )


def _previous_metrics(previous: dict[str, Any]) -> dict[str, Any]:
    return {
        "requests": previous["total"],
        "spend": float(previous["cost"]),
        "tokens": int(previous["tokens"]["total"] or 0),
        "avg_latency_ms": previous["performance"]["avg_latency_ms"],
        "errors": int(previous["failed"]) + int(previous["cancelled"]),
    }


def _aggregate(
    db: Session,
    window: AnalyticsWindow,
    *,
    key_id: uuid.UUID | None = None,
    with_cost: bool = True,
) -> dict[str, Any]:
    """Totals + dimensions + insights for one scope (2 queries, +2 for cost)."""
    data = aggregations.totals(db, window, key_id=key_id)
    current, previous = data["current"], data["previous"]
    dimensions = providers_engine.dimension_rows(db, window, key_id=key_id)
    rows = dimensions["dimensions"]
    requests = aggregations.requests_payload(current)
    tokens = tokens_engine.tokens_payload(current["tokens"], requests["total"])
    models = models_engine.model_rows(rows)
    savings = costs_engine.cache_savings(rows)
    cost = (
        _cost_section(db, window, current, tokens["total"], key_id=key_id)
        if with_cost
        else None
    )
    return {
        "requests": requests,
        "performance": current["performance"],
        "tokens": tokens,
        "cost": cost,
        "providers": providers_engine.provider_rows(rows),
        "models": models,
        "endpoints": aggregations.endpoint_rows(dimensions["endpoints"], requests["total"]),
        "savings": savings,
        "previous": previous,
        "insights": insights_engine.build(
            requests=requests["total"],
            spend=current["cost"],
            tokens_total=tokens["total"],
            avg_latency_ms=current["performance"]["avg_latency_ms"],
            errors=requests["failed"] + requests["cancelled"],
            models=models,
            savings=savings,
            previous=_previous_metrics(previous),
        ),
    }


def platform(db: Session, user: User, query: AnalyticsQuery) -> dict[str, Any]:
    """Platform-wide analytics payload (platform admins only)."""
    window = resolve_window(query)

    def load() -> dict[str, Any]:
        sections = _aggregate(db, window)
        inventory = apikeys_engine.inventory(db, window)
        metrics = apikeys_engine.key_metrics(apikeys_engine.key_breakdown(db, window))
        return {
            "range": aggregations.window_payload(window),
            "requests": sections["requests"],
            "performance": sections["performance"],
            "cost": sections["cost"],
            "tokens": sections["tokens"],
            "providers": sections["providers"],
            "models": sections["models"],
            "endpoints": sections["endpoints"],
            "keys": {
                "total": inventory["total"],
                "active": inventory["active"],
                "disabled": inventory["disabled"],
                "expired": inventory["expired"],
                "rotated": inventory["rotated"],
            },
            "top_keys": metrics["top_keys"],
            "key_growth": inventory["growth"],
            "key_spend": metrics["key_spend"],
            "key_errors": metrics["key_errors"],
            "key_cache_savings": metrics["key_cache_savings"],
            "insights": sections["insights"],
        }

    return _cached(user.id, "platform", window, None, load)


def api_keys(db: Session, user: User, query: AnalyticsQuery) -> dict[str, Any]:
    """The user's live keys with window usage aggregates (one scan)."""
    window = resolve_window(query)
    return _cached(
        user.id,
        "api-keys",
        window,
        None,
        lambda: {
            "range": aggregations.window_payload(window),
            "keys": apikeys_engine.list_keys(db, user.id, window),
        },
    )


def api_key_detail(db: Session, user: User, key_id: uuid.UUID, query: AnalyticsQuery) -> dict[str, Any]:
    """One owned key: totals, cost, cache savings and dimensions (5 queries)."""
    window = resolve_window(query)

    def load() -> dict[str, Any]:
        key = apikeys_engine.require_owned_key(db, key_id, user.id)
        sections = _aggregate(db, window, key_id=key_id)
        return {
            "range": aggregations.window_payload(window),
            "key": apikeys_engine.key_payload(key),
            "requests": sections["requests"],
            "performance": sections["performance"],
            "cost": sections["cost"],
            "tokens": sections["tokens"],
            "cache_savings": sections["savings"],
            "providers": sections["providers"],
            "models": sections["models"],
            "endpoints": sections["endpoints"],
            "insights": sections["insights"],
        }

    return _cached(user.id, "api-key", window, {"key_id": str(key_id)}, load)


def api_key_timeseries(
    db: Session,
    user: User,
    key_id: uuid.UUID,
    query: AnalyticsQuery,
    group_by: str = "model",
) -> dict[str, Any]:
    """Bucketed request/cost/token/latency series (ownership + 3 queries)."""
    window = resolve_window(query)

    def load() -> dict[str, Any]:
        apikeys_engine.require_owned_key(db, key_id, user.id)
        return {
            "range": aggregations.window_payload(window),
            **timeseries_engine.series(db, window, key_id=key_id, group_by=group_by),
        }

    return _cached(user.id, "api-key-timeseries", window, {"key_id": str(key_id), "group_by": group_by}, load)


def api_key_network(db: Session, user: User, key_id: uuid.UUID, query: AnalyticsQuery) -> dict[str, Any]:
    """IP/geo/device/client sections for one owned key (6 queries)."""
    window = resolve_window(query)

    def load() -> dict[str, Any]:
        key = apikeys_engine.require_owned_key(db, key_id, user.id, with_rules=True)
        allow = [rule.cidr for rule in key.ip_rules if rule.type == IpRuleType.ALLOW]
        deny = [rule.cidr for rule in key.ip_rules if rule.type == IpRuleType.DENY]
        payload = network_engine.network(
            db, window, key_id, allow_rules=allow, deny_rules=deny
        )
        return {"range": aggregations.window_payload(window), **payload}

    return _cached(user.id, "api-key-network", window, {"key_id": str(key_id)}, load)


def api_key_insights(db: Session, user: User, key_id: uuid.UUID, query: AnalyticsQuery) -> dict[str, Any]:
    """Insight rows for one owned key (ownership + 2 queries)."""
    window = resolve_window(query)

    def load() -> dict[str, Any]:
        apikeys_engine.require_owned_key(db, key_id, user.id)
        sections = _aggregate(db, window, key_id=key_id, with_cost=False)
        return {
            "range": aggregations.window_payload(window),
            "insights": sections["insights"],
        }

    return _cached(user.id, "api-key-insights", window, {"key_id": str(key_id)}, load)
