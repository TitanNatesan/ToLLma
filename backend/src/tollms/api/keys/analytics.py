"""Per-key analytics: preset windows, cached roll-ups and top-N breakdowns.

Grouped per-key roll-up over gateway request logs, Valkey-cached for 60s
(same scheme as the platform/key analytics API — endpoint + user + key +
minute-floored range end), so recently logged gateway traffic can lag the
dashboard by up to a minute. Every query is scoped to the key's owner.
"""

import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.api.keys.schemas import (
    AnalyticsCountryRow,
    AnalyticsEndpointRow,
    AnalyticsModelRow,
    AnalyticsPoint,
    KeyAnalytics,
)
from tollms.api.keys.service import get_key
from tollms.core.exceptions import ValidationError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.services.analytics import presets as preset_vocab
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)

DEFAULT_PRESET = "last_7d"
PRESETS = ("today", "last_7d", "last_30d", "last_90d", "this_month")
TOP_LIMIT = 5


def _preset_window(preset: str, now: datetime | None = None) -> tuple[datetime, datetime, str]:
    """(start, end, bucket granularity) for a supported preset; UTC walls.

    Legacy aliases from the other analytics surfaces are accepted via the
    shared preset vocabulary; unknown presets (and ``custom``, which takes
    no date bounds here) still raise (HTTP 422).
    """
    now = now or datetime.now(timezone.utc)
    preset = preset_vocab.normalize(preset, family="keys")
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if preset == "today":
        return midnight, now, "hour"
    if preset == "last_7d":
        return midnight - timedelta(days=6), now, "day"
    if preset == "last_30d":
        return midnight - timedelta(days=29), now, "day"
    if preset == "last_90d":
        return midnight - timedelta(days=89), now, "day"
    if preset == "this_month":
        return midnight.replace(day=1), now, "day"
    raise ValidationError(f"unknown analytics preset: {preset!r}; expected one of {', '.join(PRESETS)}")


def _log_scope(key: ApiKey, user_id: uuid.UUID, start: datetime, end: datetime) -> tuple:
    return (
        ApiRequestLog.api_key_id == key.id,
        ApiRequestLog.user_id == user_id,
        ApiRequestLog.created_at >= start,
        ApiRequestLog.created_at < end,
    )


def _series(db: Session, scope: tuple, granularity: str) -> list[AnalyticsPoint]:
    bucket = func.date_trunc(granularity, ApiRequestLog.created_at)
    rows = db.execute(
        select(
            bucket,
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
        )
        .where(*scope)
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        AnalyticsPoint(
            bucket=row[0],
            requests=int(row[1]),
            tokens=int(row[2]),
            cost=Decimal(str(row[3])),
            errors=int(row[4]),
        )
        for row in rows
    ]


def _top_models(db: Session, scope: tuple) -> list[AnalyticsModelRow]:
    model = func.coalesce(ApiRequestLog.model, "unknown")
    spend = func.coalesce(func.sum(ApiRequestLog.cost), 0)
    requests = func.count(ApiRequestLog.id)
    rows = db.execute(
        select(model, requests, func.coalesce(func.sum(ApiRequestLog.total_tokens), 0), spend)
        .where(*scope)
        .group_by(model)
        .order_by(spend.desc(), requests.desc())
        .limit(TOP_LIMIT)
    ).all()
    return [
        AnalyticsModelRow(model=str(row[0]), requests=int(row[1]), tokens=int(row[2]), cost=Decimal(str(row[3])))
        for row in rows
    ]


def _top_endpoints(db: Session, scope: tuple) -> list[AnalyticsEndpointRow]:
    requests = func.count(ApiRequestLog.id)
    spend = func.coalesce(func.sum(ApiRequestLog.cost), 0)
    rows = db.execute(
        select(ApiRequestLog.endpoint, requests, spend)
        .where(*scope)
        .group_by(ApiRequestLog.endpoint)
        .order_by(requests.desc(), spend.desc())
        .limit(TOP_LIMIT)
    ).all()
    return [
        AnalyticsEndpointRow(endpoint=str(row[0]), requests=int(row[1]), cost=Decimal(str(row[2])))
        for row in rows
    ]


def _top_countries(db: Session, scope: tuple) -> list[AnalyticsCountryRow]:
    requests = func.count(ApiRequestLog.id)
    rows = db.execute(
        select(ApiRequestLog.country, requests)
        .where(*scope, ApiRequestLog.country.is_not(None))
        .group_by(ApiRequestLog.country)
        .order_by(requests.desc())
        .limit(TOP_LIMIT)
    ).all()
    return [AnalyticsCountryRow(country=str(row[0]), requests=int(row[1])) for row in rows]


def _analytics_digest(preset: str, end: datetime, key_id: uuid.UUID) -> str:
    """Stable cache identity: endpoint + canonical preset + minute-floored
    range end (preset windows end at ``now``) + key."""
    parts = [
        "key-analytics",
        preset,
        end.replace(second=0, microsecond=0).isoformat(),
        json.dumps({"key_id": str(key_id)}, sort_keys=True),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def get_analytics(
    db: Session, key_id: uuid.UUID, user_id: uuid.UUID, preset: str = DEFAULT_PRESET
) -> KeyAnalytics:
    """Grouped per-key roll-up; every query is scoped to the key's owner.

    Valkey-cached for 60s (best-effort: failures fall through to PostgreSQL).
    """
    key = get_key(db, key_id, user_id)
    start, end, granularity = _preset_window(preset)
    canonical = preset_vocab.normalize(preset, family="keys")
    cache_key = cache_keys.analytics(user_id, _analytics_digest(canonical, end, key_id))
    hit = cache_get_sync(cache_key)
    if isinstance(hit, dict):
        try:
            return KeyAnalytics(**hit)
        except Exception:  # noqa: BLE001 - corrupt entry rebuilds below
            logger.warning("keys analytics: corrupt cache entry for key %s", key_id)
    result = _build_analytics(db, key, user_id, start, end, granularity, canonical)
    cache_set_sync(cache_key, result.model_dump(mode="json"), ttl=cache_ttl.ANALYTICS)
    return result


def _build_analytics(
    db: Session,
    key,  # ApiKey row (ownership already checked)
    user_id: uuid.UUID,
    start: datetime,
    end: datetime,
    granularity: str,
    preset: str,
) -> KeyAnalytics:
    """Grouped per-key roll-up; every query is scoped to the key's owner."""
    scope = _log_scope(key, user_id, start, end)

    requests, tokens, cost, avg_latency, p95_latency, errors = db.execute(
        select(
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.avg(ApiRequestLog.latency_ms),
            func.percentile_cont(0.95).within_group(ApiRequestLog.latency_ms),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
        ).where(*scope)
    ).one()

    request_count = int(requests or 0)
    return KeyAnalytics(
        range=preset,
        range_start=start,
        range_end=end,
        requests=request_count,
        tokens=int(tokens or 0),
        cost=Decimal(str(cost)),
        avg_latency_ms=float(avg_latency) if avg_latency is not None else None,
        p95_latency_ms=float(p95_latency) if p95_latency is not None else None,
        error_rate=round(int(errors or 0) / request_count, 4) if request_count else 0.0,
        series=_series(db, scope, granularity),
        top_models=_top_models(db, scope),
        top_endpoints=_top_endpoints(db, scope),
        top_countries=_top_countries(db, scope),
    )
