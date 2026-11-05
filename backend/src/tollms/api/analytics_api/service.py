"""Feature service for `/api/analytics`: resolution, composition and caching.

Thin by design — every number comes from the reusable ``services/analytics``
engines; this module only resolves the request window, checks key ownership,
composes the frozen payloads and caches the result in Valkey for
``constants.ANALYTICS`` seconds (60s), keyed by endpoint + user + key + range +
extra params. Cache entries are best-effort: a Valkey failure degrades to a
direct PostgreSQL read.

Per-key endpoints merge both usage ledgers — public-gateway
``api_request_logs`` plus in-app-chat ``request_logs WHERE api_key_id = :key``
(same UTC half-open ``[start, end)`` window on ``created_at``; disjoint writers
so no double-count; in-app rows surface as endpoint ``"chat"`` with
registry-resolved provider/model names; ``timeout``/``retry`` stay gateway-only
approximations; chat ``"regenerated"`` folds into ``cancelled``; latency merges
exactly via ``UNION ALL``; errors propagate, never silent-empty — same
conventions as ``api/keys/analytics.py``). ``network`` stays gateway-only:
``request_logs`` has no IP/geo columns, so IP history, locations, devices and
clients cannot include chat traffic (documented, not silently dropped).

Documented query counts per endpoint (grouped SQL only, no N+1):

* ``GET /platform`` — 6: totals (current+previous, one round-trip), dimension
  grouping sets, trailing costs, most-expensive request, key inventory+growth,
  key breakdown.
* ``GET /api-keys`` — 1: outer-join scan of the user's keys + window usage.
* ``GET /api-keys/{id}`` — 5 + chat union: ownership, totals (gateway + chat +
  exact latency unions), dimensions (+ chat scan), trailing costs (+ chat scan),
  most-expensive request (+ chat scan).
* ``GET /api-keys/{id}/timeseries`` — 4 + chat union: ownership +
  points/stacked/latency (each gateway + chat, latency via exact union).
* ``GET /api-keys/{id}/network`` — 6, gateway-only (see above): ownership
  (+ IP rules), IP history, locations, devices, clients.
* ``GET /api-keys/{id}/insights`` — 3 + chat union: ownership, totals, dimensions.
* ``GET /platform/export`` — uncached: totals (one round-trip), dimension
  grouping sets, trailing costs, most-expensive request (+ timeseries points
  only for the ``timeseries`` dataset).
* ``GET /api-keys/{id}/export`` — ownership + the same dataset queries,
  key-scoped (with the same chat union).
"""

import hashlib
import csv
import io
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Literal

from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError
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
from tollms.services import exporters
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


def _require_readable_key(
    db: Session, user: User, key_id: uuid.UUID, *, with_rules: bool = False,
):
    """Owned personal key, else an org key assigned to the caller or visible
    via ``Keys.Read``. Everything else 404s (no oracle).

    Downstream queries already scope by key id alone, so permitted org viewers
    see the key's full traffic. The org fallback lives in the feature service
    (this layer may import ``api.*``); the analytics engine stays pure.
    """
    try:
        return apikeys_engine.require_owned_key(db, key_id, user.id, with_rules=with_rules)
    except NotFoundError:
        pass
    from tollms.api.keys import organization_service as org_keys

    return org_keys.get_org_key(db, user.id, key_id)


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
        key = _require_readable_key(db, user, key_id)
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
        _require_readable_key(db, user, key_id)
        return {
            "range": aggregations.window_payload(window),
            **timeseries_engine.series(db, window, key_id=key_id, group_by=group_by),
        }

    return _cached(user.id, "api-key-timeseries", window, {"key_id": str(key_id), "group_by": group_by}, load)


def api_key_network(db: Session, user: User, key_id: uuid.UUID, query: AnalyticsQuery) -> dict[str, Any]:
    """IP/geo/device/client sections for one owned key (6 queries, gateway-only).

    ``request_logs`` carries no IP/geo columns, so chat traffic cannot appear
    here — documented, not silently dropped (see module docstring).
    """
    window = resolve_window(query)

    def load() -> dict[str, Any]:
        key = _require_readable_key(db, user, key_id, with_rules=True)
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
        _require_readable_key(db, user, key_id)
        sections = _aggregate(db, window, key_id=key_id, with_cost=False)
        return {
            "range": aggregations.window_payload(window),
            "insights": sections["insights"],
        }

    return _cached(user.id, "api-key-insights", window, {"key_id": str(key_id)}, load)


# --- export ------------------------------------------------------------------

ExportDataset = Literal["summary", "timeseries", "models", "providers", "endpoints"]
ExportFormat = Literal["csv", "json", "xlsx"]
EXPORT_DATASETS = ("summary", "timeseries", "models", "providers", "endpoints")


def _export_rows(
    db: Session, window: AnalyticsWindow, *, key_id: uuid.UUID | None, dataset: str
) -> tuple[str, list[str], list[dict[str, Any]]]:
    """(dataset, columns, JSON-safe rows) for one scope (platform or one key)."""
    if dataset == "timeseries":
        points = timeseries_engine.series(db, window, key_id=key_id)["points"]
        rows = [
            {
                "bucket": point["bucket"].isoformat(),
                "requests": point["requests"],
                "success": point["success"],
                "failed": point["failed"],
                "cancelled": point["cancelled"],
                "cost": str(point["cost"]),
                "tokens": point["tokens"],
            }
            for point in points
        ]
        return dataset, ["bucket", "requests", "success", "failed", "cancelled", "cost", "tokens"], rows
    sections = _aggregate(db, window, key_id=key_id)
    if dataset == "models":
        rows = [
            {
                "model": row["model"],
                "provider": row["provider"],
                "requests": row["requests"],
                "spend": str(row["spend"]),
                "tokens": row["tokens"],
                "avg_latency_ms": row["avg_latency_ms"],
                "success_rate": row["success_rate"],
            }
            for row in sections["models"]
        ]
        return dataset, ["model", "provider", "requests", "spend", "tokens", "avg_latency_ms", "success_rate"], rows
    if dataset == "providers":
        rows = [
            {
                "provider": row["provider"],
                "requests": row["requests"],
                "spend": str(row["spend"]),
                "tokens": row["tokens"],
                "avg_latency_ms": row["avg_latency_ms"],
                "error_rate": row["error_rate"],
            }
            for row in sections["providers"]
        ]
        return dataset, ["provider", "requests", "spend", "tokens", "avg_latency_ms", "error_rate"], rows
    if dataset == "endpoints":
        rows = [
            {
                "endpoint": row["endpoint"],
                "requests": row["requests"],
                "spend": str(row["spend"]),
                "share": row["share"],
            }
            for row in sections["endpoints"]
        ]
        return dataset, ["endpoint", "requests", "spend", "share"], rows
    dataset = "summary"
    cost = sections["cost"] or {}
    rows = [{
        "range_start": window.start.isoformat(),
        "range_end": window.end.isoformat(),
        "timezone": window.timezone,
        "requests": sections["requests"]["total"],
        "success": sections["requests"]["success"],
        "failed": sections["requests"]["failed"],
        "cancelled": sections["requests"]["cancelled"],
        "spend": str(cost.get("total", 0)),
        "projected_month": str(cost.get("projected_month", 0)),
        "run_rate_projection": str(cost.get("run_rate_projection", 0)),
        "tokens": sections["tokens"]["total"],
        "prompt_tokens": sections["tokens"]["prompt"],
        "completion_tokens": sections["tokens"]["completion"],
        "avg_latency_ms": sections["performance"]["avg_latency_ms"],
    }]
    return dataset, list(rows[0].keys()), rows


def _render_export(
    dataset: str, columns: list[str], rows: list[dict[str, Any]], stamp: str, export_format: str
) -> tuple[bytes | str, str, str]:
    """(content, filename, media_type) via the shared renderers (csv | xlsx | json)."""
    if export_format == "xlsx":
        content = exporters.analytics_xlsx(
            [(dataset, columns, [[row.get(column) for column in columns] for row in rows])]
        )
        return (
            content,
            f"tollma-gateway-{dataset}-{stamp}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    if export_format == "json":
        return (
            json.dumps({"dataset": dataset, "rows": rows}, indent=2),
            f"tollma-gateway-{dataset}-{stamp}.json",
            "application/json",
        )
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue(), f"tollma-gateway-{dataset}-{stamp}.csv", "text/csv"


def export_platform(
    db: Session, user: User, query: AnalyticsQuery, dataset: str, export_format: str
) -> tuple[bytes | str, str, str, int]:
    """Platform export (uncached; mirrors ``/api/v1/analytics/export`` params)."""
    window = resolve_window(query)
    name, columns, rows = _export_rows(db, window, key_id=None, dataset=dataset)
    content, filename, media_type = _render_export(
        name, columns, rows, window.start.strftime("%Y%m%d"), export_format
    )
    return content, filename, media_type, len(rows)


def export_api_key(
    db: Session,
    user: User,
    key_id: uuid.UUID,
    query: AnalyticsQuery,
    dataset: str,
    export_format: str,
) -> tuple[bytes | str, str, str, int]:
    """Per-key export (uncached, key-scoped; mirrors ``/api/v1/analytics/export``)."""
    window = resolve_window(query)
    _require_readable_key(db, user, key_id)
    name, columns, rows = _export_rows(db, window, key_id=key_id, dataset=dataset)
    content, filename, media_type = _render_export(
        name, columns, rows, window.start.strftime("%Y%m%d"), export_format
    )
    return content, filename, media_type, len(rows)
