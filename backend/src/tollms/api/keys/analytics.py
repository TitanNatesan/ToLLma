"""Per-key analytics: preset windows, cached roll-ups and top-N breakdowns.

Grouped per-key roll-up over BOTH usage ledgers — public-gateway
`api_request_logs` and in-app-chat `request_logs` (which stamps
`api_key_id`, see `services/request_logs.py:record`) — so chat-page
traffic is visible and totals don't under-report. Valkey-cached for 60s
(same scheme as the platform/key analytics API — endpoint + user + key +
minute-floored range end), so recently logged traffic can lag the
dashboard by up to a minute. Personal keys scope every query to the owner; org keys (assignee or ``Keys.Read`` holder) scope to the key.

The two ledgers have disjoint writers (gateway vs chat UI), so summed
rows never double-count. `RequestLog` carries no endpoint column —
in-app rows surface under the `"chat"` endpoint label; `top_countries`
stays gateway-only (`RequestLog` has no geo columns).

Status semantics (both ledgers): writers record success/cancel/fail rows.
`requests`/tokens/cost aggregate ALL recorded rows; `errors` counts rows
whose status is not `"success"` (failed + cancelled + regenerated). Public
failed/cancelled rows store NULL tokens/cost (coalesced to 0, never
invented); chat partial rows carry estimated usage (see `generation._price`
`partial=True`). Windows are UTC half-open `[start, end)` on `created_at`.
Personal keys additionally pin every query to the owner; org keys scope to
the key (ownership itself is checked in `get_key_for_read`, which raises —
analytics never returns silent-empty on auth failure). The only join
(`RequestLog` -> model registry, outer many-to-one) cannot fan out.
"""

import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select, union_all
from sqlalchemy.orm import Session

from tollms.api.keys.schemas import (
    AnalyticsCountryRow,
    AnalyticsEndpointRow,
    AnalyticsModelRow,
    AnalyticsPoint,
    KeyAnalytics,
)
from tollms.api.keys.service import get_key_for_read
from tollms.core.exceptions import ValidationError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.registered_model import AIModel
from tollms.models.request_log import RequestLog
from tollms.services.analytics import presets as preset_vocab
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)

DEFAULT_PRESET = "last_7d"
PRESETS = ("today", "last_7d", "last_30d", "last_90d", "this_month")
TOP_LIMIT = 5
#: Endpoint label for in-app-chat rows (`RequestLog` has no endpoint column).
CHAT_ENDPOINT = "chat"


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
    conditions = [
        ApiRequestLog.api_key_id == key.id,
        ApiRequestLog.created_at >= start,
        ApiRequestLog.created_at < end,
    ]
    if key.org_id is None:
        # Personal keys additionally pin the owner; org keys are already
        # unique per row, so permitted viewers (not just the assignee) see
        # the same traffic.
        conditions.insert(1, ApiRequestLog.user_id == user_id)
    return tuple(conditions)


def _chat_scope(key: ApiKey, user_id: uuid.UUID, start: datetime, end: datetime) -> tuple:
    """Same window/ownership rule as `_log_scope` for the in-app ledger."""
    conditions = [
        RequestLog.api_key_id == key.id,
        RequestLog.created_at >= start,
        RequestLog.created_at < end,
    ]
    if key.org_id is None:
        conditions.insert(1, RequestLog.user_id == user_id)
    return tuple(conditions)


def _series(
    db: Session, scope: tuple, chat_scope: tuple, granularity: str
) -> list[AnalyticsPoint]:
    """Per-bucket roll-up merged across both ledgers (bucket-unioned in Python)."""
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
    chat_bucket = func.date_trunc(granularity, RequestLog.created_at)
    chat_rows = db.execute(
        select(
            chat_bucket,
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.count(RequestLog.id).filter(RequestLog.status != "success"),
        )
        .where(*chat_scope)
        .group_by(chat_bucket)
        .order_by(chat_bucket)
    ).all()
    merged: dict = {}
    for row in list(rows) + list(chat_rows):
        cell = merged.setdefault(row[0], [0, 0, Decimal(0), 0])
        cell[0] += int(row[1])
        cell[1] += int(row[2])
        cell[2] += Decimal(str(row[3]))
        cell[3] += int(row[4])
    return [
        AnalyticsPoint(bucket=when, requests=cell[0], tokens=cell[1], cost=cell[2], errors=cell[3])
        for when, cell in sorted(merged.items())
    ]


def _top_models(db: Session, scope: tuple, chat_scope: tuple) -> list[AnalyticsModelRow]:
    """Per-model roll-up merged across both ledgers.

    In-app rows join the model registry for the `model_id` string (the
    same label family the gateway stores in `ApiRequestLog.model`);
    rows whose model row is gone fall into `"unknown"`, as do NULLs.
    """
    model = func.coalesce(ApiRequestLog.model, "unknown")
    spend = func.coalesce(func.sum(ApiRequestLog.cost), 0)
    requests = func.count(ApiRequestLog.id)
    rows = db.execute(
        select(model, requests, func.coalesce(func.sum(ApiRequestLog.total_tokens), 0), spend)
        .where(*scope)
        .group_by(model)
    ).all()
    chat_model = func.coalesce(AIModel.model_id, "unknown")
    chat_spend = func.coalesce(func.sum(RequestLog.total_cost), 0)
    chat_requests = func.count(RequestLog.id)
    chat_rows = db.execute(
        select(
            chat_model,
            chat_requests,
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            chat_spend,
        )
        .join(AIModel, AIModel.id == RequestLog.model_id, isouter=True)
        .where(*chat_scope)
        .group_by(chat_model)
    ).all()
    merged: dict[str, list] = {}
    for row in list(rows) + list(chat_rows):
        cell = merged.setdefault(str(row[0]), [0, 0, Decimal(0)])
        cell[0] += int(row[1])
        cell[1] += int(row[2])
        cell[2] += Decimal(str(row[3]))
    ranked = sorted(merged.items(), key=lambda item: (item[1][2], item[1][0]), reverse=True)
    return [
        AnalyticsModelRow(model=name, requests=cell[0], tokens=cell[1], cost=cell[2])
        for name, cell in ranked[:TOP_LIMIT]
    ]


def _top_endpoints(db: Session, scope: tuple, chat_scope: tuple) -> list[AnalyticsEndpointRow]:
    """Per-endpoint roll-up; in-app rows bucket under `"chat"` (no endpoint column)."""
    requests = func.count(ApiRequestLog.id)
    spend = func.coalesce(func.sum(ApiRequestLog.cost), 0)
    rows = db.execute(
        select(ApiRequestLog.endpoint, requests, spend)
        .where(*scope)
        .group_by(ApiRequestLog.endpoint)
        .order_by(requests.desc(), spend.desc())
        .limit(TOP_LIMIT)
    ).all()
    merged: dict[str, list] = {
        str(row[0]): [int(row[1]), Decimal(str(row[2]))] for row in rows
    }
    chat_requests, chat_cost = db.execute(
        select(
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
        ).where(*chat_scope)
    ).one()
    if int(chat_requests or 0):
        cell = merged.setdefault(CHAT_ENDPOINT, [0, Decimal(0)])
        cell[0] += int(chat_requests)
        cell[1] += Decimal(str(chat_cost))
    ranked = sorted(merged.items(), key=lambda item: (item[1][0], item[1][1]), reverse=True)
    return [
        AnalyticsEndpointRow(endpoint=name, requests=cell[0], cost=cell[1])
        for name, cell in ranked[:TOP_LIMIT]
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
    key = get_key_for_read(db, key_id, user_id)
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
    """Grouped per-key roll-up; scoped to the owner (personal) or the key (org).

    Totals, series, top models and top endpoints merge both ledgers;
    latency merges exactly (summed latencies for the mean, a UNION ALL
    subquery for p95). `top_countries` stays gateway-only.
    """
    scope = _log_scope(key, user_id, start, end)
    chat_scope = _chat_scope(key, user_id, start, end)

    requests, tokens, cost, lat_sum, lat_n, errors = db.execute(
        select(
            func.count(ApiRequestLog.id),
            func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
            func.coalesce(func.sum(ApiRequestLog.cost), 0),
            func.coalesce(func.sum(ApiRequestLog.latency_ms), 0),
            func.count(ApiRequestLog.latency_ms),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status != "success"),
        ).where(*scope)
    ).one()
    chat_requests, chat_tokens, chat_cost, chat_lat_sum, chat_lat_n, chat_errors = db.execute(
        select(
            func.count(RequestLog.id),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.coalesce(func.sum(RequestLog.latency_ms), 0),
            func.count(RequestLog.latency_ms),
            func.count(RequestLog.id).filter(RequestLog.status != "success"),
        ).where(*chat_scope)
    ).one()

    request_count = int(requests or 0) + int(chat_requests or 0)
    error_count = int(errors or 0) + int(chat_errors or 0)
    latency_samples = int(lat_n or 0) + int(chat_lat_n or 0)
    avg_latency = (
        float(Decimal(str(lat_sum)) + Decimal(str(chat_lat_sum))) / latency_samples
        if latency_samples
        else None
    )
    p95_latency = None
    if request_count:
        latencies = union_all(
            select(ApiRequestLog.latency_ms.label("lat")).where(
                *scope, ApiRequestLog.latency_ms.is_not(None)
            ),
            select(RequestLog.latency_ms.label("lat")).where(
                *chat_scope, RequestLog.latency_ms.is_not(None)
            ),
        ).subquery()
        p95_latency = db.scalar(
            select(func.percentile_cont(0.95).within_group(latencies.c.lat))
        )
    return KeyAnalytics(
        range=preset,
        range_start=start,
        range_end=end,
        requests=request_count,
        tokens=int(tokens or 0) + int(chat_tokens or 0),
        cost=Decimal(str(cost)) + Decimal(str(chat_cost)),
        avg_latency_ms=avg_latency,
        p95_latency_ms=float(p95_latency) if p95_latency is not None else None,
        error_rate=round(error_count / request_count, 4) if request_count else 0.0,
        series=_series(db, scope, chat_scope, granularity),
        top_models=_top_models(db, scope, chat_scope),
        top_endpoints=_top_endpoints(db, scope, chat_scope),
        top_countries=_top_countries(db, scope),
    )
