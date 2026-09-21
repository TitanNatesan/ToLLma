"""Analytics aggregation engine.

Every number the dashboard shows is computed here from `messages` (the fact
table) scoped to one user. No raw request history crosses the API boundary.
Date-range presets resolve in the caller's timezone; buckets are returned as
local wall-clock instants so the UI never re-derives them.
"""

import calendar
import csv
import hashlib
import io
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from tollms.api.analytics.schemas import (
    AnalyticsBreakdown,
    AnalyticsConversations,
    AnalyticsHeatmap,
    AnalyticsModels,
    AnalyticsPerformance,
    AnalyticsRange,
    AnalyticsSummary,
    AnalyticsTimeseries,
    AnalyticsWidgets,
    BreakdownRow,
    ConversationAnalyticsRow,
    HeatmapCell,
    HeatmapPeak,
    Insight,
    KpiValue,
    LatencyRow,
    TimeseriesPoint,
)
from tollms.core.exceptions import ValidationError
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services import exporters
from tollms.services import request_logs as request_log_engine
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.manager import cache_get_sync, cache_set_sync

logger = logging.getLogger(__name__)

PRESETS = ("today", "yesterday", "last_7d", "last_30d", "this_month", "last_month", "last_90d", "custom")
GRANULARITIES = ("hour", "day", "week", "month")
MODEL_SORTS = ("most_used", "most_expensive", "fastest", "slowest")
CONVERSATION_LIMIT = 10


@dataclass
class RangeQuery:
    """Raw range request (preset + optional custom bounds + IANA timezone)."""

    preset: str = "this_month"
    timezone: str = "UTC"
    start: date | None = None
    end: date | None = None


# Browsers still report CLDR legacy zone ids; PostgreSQL's tzdata dropped some
# of these links, so normalize the common ones before they reach `timezone()`.
_TZ_ALIASES = {
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Asia/Dacca": "Asia/Dhaka",
    "Europe/Kiev": "Europe/Kyiv",
    "America/Godthab": "America/Nuuk",
    "Pacific/Enderbury": "Pacific/Kanton",
    "Australia/Canberra": "Australia/Sydney",
    "US/Eastern": "America/New_York",
    "US/Central": "America/Chicago",
    "US/Mountain": "America/Denver",
    "US/Pacific": "America/Los_Angeles",
}

# Per-process memo of names PostgreSQL accepted (or rejected -> UTC).
_sql_tz_cache: dict[str, str] = {}


def _canonical_tz(name: str) -> str:
    return _TZ_ALIASES.get(name, name)


def _zone(name: str) -> ZoneInfo:
    canonical = _canonical_tz(name)
    for candidate in (canonical, "UTC"):
        try:
            return ZoneInfo(candidate)
        except Exception:
            continue
    logger.warning("analytics: unknown timezone %r, falling back to UTC", name)
    return ZoneInfo("UTC")


def sql_timezone(db: Session, name: str) -> str:
    """A timezone name PostgreSQL accepts for `timezone()`, or UTC.

    Some IANA links exist in browser/CLDR data but not in PostgreSQL's tzdata
    (`Asia/Calcutta`), which would otherwise 500 every bucketed query.
    """
    candidate = _canonical_tz(name)
    cached = _sql_tz_cache.get(candidate)
    if cached is not None:
        return cached
    try:
        db.execute(select(func.timezone(candidate, func.now()))).scalar()
        _sql_tz_cache[candidate] = candidate
        return candidate
    except Exception:
        db.rollback()
        logger.warning("analytics: PostgreSQL does not accept timezone %r; using UTC", candidate)
        _sql_tz_cache[candidate] = "UTC"
        return "UTC"


def resolve_range(q: RangeQuery, *, now: datetime | None = None) -> AnalyticsRange:
    """Preset -> concrete UTC window + the equal-length preceding window."""
    zone = _zone(q.timezone)
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(zone).date()

    def midnight(day: date) -> datetime:
        return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)

    preset = q.preset if q.preset in PRESETS else "this_month"
    if preset == "today":
        start, end = midnight(today), now
    elif preset == "yesterday":
        start, end = midnight(today - timedelta(days=1)), midnight(today)
    elif preset == "last_7d":
        start, end = midnight(today - timedelta(days=6)), now
    elif preset == "last_30d":
        start, end = midnight(today - timedelta(days=29)), now
    elif preset == "last_90d":
        start, end = midnight(today - timedelta(days=89)), now
    elif preset == "last_month":
        first_this = today.replace(day=1)
        start, end = midnight((first_this - timedelta(days=1)).replace(day=1)), midnight(first_this)
    elif preset == "custom" and q.start and q.end:
        if q.end < q.start:
            raise ValidationError("range end must not be before range start")
        start, end = midnight(q.start), midnight(q.end + timedelta(days=1))
    else:
        preset = "this_month"
        start, end = midnight(today.replace(day=1)), now

    span = end - start
    return AnalyticsRange(
        preset=preset, timezone=_canonical_tz(q.timezone),
        start=start, end=end, prev_start=start - span, prev_end=start,
    )


def pick_granularity(rng: AnalyticsRange) -> str:
    """Sensible default bucketing for the selected span."""
    hours = (rng.end - rng.start).total_seconds() / 3600
    if hours <= 48:
        return "hour"
    if hours <= 24 * 120:
        return "day"
    if hours <= 24 * 400:
        return "week"
    return "month"


# --- shared query helpers ---------------------------------------------------


def _scope(user_id: uuid.UUID, start: datetime, end: datetime):
    return [
        Message.user_id == user_id,
        Message.is_deleted.is_(False),
        Message.role == Role.ASSISTANT,
        Message.created_at >= start,
        Message.created_at < end,
    ]


def _digest(*parts: object) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _cached(user_id: uuid.UUID, digest: str, model_cls, builder):
    """Read-through cache: the payload is fully rebuildable from PostgreSQL."""
    key = cache_keys.analytics(user_id, digest)
    hit = cache_get_sync(key)
    if isinstance(hit, dict):
        try:
            return model_cls(**hit)
        except Exception:
            logger.warning("analytics: corrupt cache entry %s", key, exc_info=True)
    result = builder()
    cache_set_sync(key, result.model_dump(mode="json"), ttl=cache_ttl.ANALYTICS)
    return result


def _f(value) -> float | None:
    return float(value) if value is not None else None


def _change_pct(current, previous) -> float | None:
    c, p = float(current or 0), float(previous or 0)
    if p == 0:
        return None if c == 0 else 100.0
    return round((c - p) / p * 100, 1)


def _money(value: Decimal) -> str:
    """Human money for insight copy: sub-cent amounts need more precision."""
    return f"${value:.4f}" if abs(value) < Decimal("0.01") else f"${value:.2f}"


def _totals(db: Session, user_id: uuid.UUID, start: datetime, end: datetime):
    return db.execute(
        select(
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.reasoning_tokens), 0),
            func.avg(Message.latency_ms),
            func.avg(Message.ttfb_ms),
            func.count(func.distinct(Message.model_id)),
            func.count(func.distinct(Message.provider_id)),
            func.count(func.distinct(Message.conversation_id)),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
            func.count(Message.id).filter(Message.usage_estimated.is_(True)),
            func.count(Message.id).filter(Message.ttfb_ms.is_not(None)),
        )
        .select_from(Message)
        .where(*_scope(user_id, start, end))
    ).one()


def _breakdown_rows(db: Session, user_id: uuid.UUID, rng: AnalyticsRange, by: str) -> list[BreakdownRow]:
    """Per-provider or per-model aggregation, spend-descending."""
    if by == "provider":
        key_col, name_col, kind_col = Message.provider_id, Provider.name, Provider.provider_type
        stmt = select(
            key_col, name_col, kind_col,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.reasoning_tokens), 0),
            func.avg(Message.latency_ms),
            func.avg(Message.ttfb_ms),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
        ).select_from(Message).outerjoin(Provider, Message.provider_id == Provider.id)
    else:
        key_col, name_col, kind_col = Message.model_id, AIModel.name, AIModel.endpoint_type
        stmt = select(
            key_col, name_col, kind_col,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.reasoning_tokens), 0),
            func.avg(Message.latency_ms),
            func.avg(Message.ttfb_ms),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
        ).select_from(Message).outerjoin(AIModel, Message.model_id == AIModel.id)
    rows = db.execute(
        stmt.where(*_scope(user_id, rng.start, rng.end))
        .group_by(key_col, name_col, kind_col)
        .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
    ).all()
    total_spend = sum((Decimal(str(r[4])) for r in rows), Decimal(0))
    out: list[BreakdownRow] = []
    for r in rows:
        requests = int(r[3])
        spend = Decimal(str(r[4]))
        out.append(BreakdownRow(
            key=str(r[0]) if r[0] is not None else "unknown",
            name=str(r[1] or "Unknown"),
            kind=str(r[2] or ""),
            requests=requests,
            spend=spend,
            total_tokens=int(r[5]), prompt_tokens=int(r[6]), completion_tokens=int(r[7]),
            cache_read_tokens=int(r[8]), cache_write_tokens=int(r[9]), reasoning_tokens=int(r[10]),
            avg_cost=(spend / requests) if requests else Decimal(0),
            avg_latency_ms=_f(r[11]), avg_ttfb_ms=_f(r[12]),
            error_rate=round(int(r[13]) / requests, 4) if requests else 0.0,
            share_pct=round(float(spend / total_spend * 100), 1) if total_spend else 0.0,
        ))
    return out


def _latency_rows(db: Session, user_id: uuid.UUID, rng: AnalyticsRange, by: str) -> list[LatencyRow]:
    """Per-provider or per-model latency/response-size aggregation."""
    if by == "provider":
        key_col, name_col = Message.provider_id, Provider.name
        stmt = select(
            key_col, name_col,
            func.count(Message.id),
            func.avg(Message.latency_ms),
            func.avg(Message.ttfb_ms),
            func.avg(func.length(Message.content)),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
        ).select_from(Message).outerjoin(Provider, Message.provider_id == Provider.id)
    else:
        key_col, name_col = Message.model_id, AIModel.name
        stmt = select(
            key_col, name_col,
            func.count(Message.id),
            func.avg(Message.latency_ms),
            func.avg(Message.ttfb_ms),
            func.avg(func.length(Message.content)),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
        ).select_from(Message).outerjoin(AIModel, Message.model_id == AIModel.id)
    rows = db.execute(
        stmt.where(*_scope(user_id, rng.start, rng.end)).group_by(key_col, name_col)
    ).all()
    out = []
    for r in rows:
        requests = int(r[2])
        out.append(LatencyRow(
            key=str(r[0]) if r[0] is not None else "unknown",
            name=str(r[1] or "Unknown"),
            requests=requests,
            avg_latency_ms=_f(r[3]), avg_ttfb_ms=_f(r[4]), avg_response_chars=_f(r[5]),
            error_rate=round(int(r[6]) / requests, 4) if requests else 0.0,
        ))
    return out


# --- summary + insights -----------------------------------------------------


def _insights(
    rng: AnalyticsRange,
    cur,
    prev,
    providers: list[BreakdownRow],
    models: list[BreakdownRow],
    heatmap: AnalyticsHeatmap,
) -> list[Insight]:
    insights: list[Insight] = []
    spend, prev_spend = Decimal(str(cur[1])), Decimal(str(prev[1]))
    change = _change_pct(spend, prev_spend)
    if change is not None and prev_spend > 0:
        direction = "increased" if change >= 0 else "decreased"
        insights.append(Insight(
            id="spend_trend",
            title=f"Spending {direction} {abs(change):.0f}%",
            detail=(
                f"You spent {_money(spend)} this period versus {_money(prev_spend)} in the previous period."
            ),
            severity="warning" if change >= 25 else ("positive" if change <= -10 else "info"),
        ))
    if providers:
        top = providers[0]
        if top.share_pct >= 5:
            insights.append(Insight(
                id="top_provider",
                title=f"{top.name} drives {top.share_pct:.0f}% of spend",
                detail=f"{_money(top.spend)} across {top.requests} requests in the selected period.",
            ))
    if models:
        top = models[0]
        total_tokens = sum(m.total_tokens for m in models) or 1
        token_share = round(top.total_tokens / total_tokens * 100, 1)
        if token_share >= 5:
            insights.append(Insight(
                id="top_model_tokens",
                title=f"{top.name} generated {token_share:.0f}% of tokens",
                detail=f"{top.total_tokens:,} tokens across {top.requests} requests.",
            ))
    latency, prev_latency = _f(cur[8]), _f(prev[8])
    latency_change = _change_pct(latency, prev_latency)
    if latency_change is not None and prev_latency:
        direction = "increased" if latency_change >= 0 else "decreased"
        insights.append(Insight(
            id="latency_trend",
            title=f"Average response latency {direction} {abs(latency_change):.0f}%",
            detail=f"Average response time is now {latency:.0f}ms versus {prev_latency:.0f}ms previously.",
            severity="warning" if latency_change >= 25 else "info",
        ))
    if heatmap.peak is not None:
        insights.append(Insight(
            id="peak_hours",
            title="Peak usage window",
            detail=(
                f"Most requests happen on {_DAY_NAMES[heatmap.peak.day]} around "
                f"{heatmap.peak.hour:02d}:00 ({heatmap.peak.requests} requests)."
            ),
        ))
    if cur[13]:
        insights.append(Insight(
            id="failed_requests",
            title=f"{int(cur[13])} failed request(s)",
            detail="Failures may inflate estimated costs; review provider health on the Providers page.",
            severity="warning",
        ))
    return insights


_DAY_NAMES = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")


def get_summary(db: Session, user_id: uuid.UUID, q: RangeQuery) -> AnalyticsSummary:
    rng = resolve_range(q)

    def build() -> AnalyticsSummary:
        cur = _totals(db, user_id, rng.start, rng.end)
        prev = _totals(db, user_id, rng.prev_start, rng.prev_end)
        requests, spend = int(cur[0]), Decimal(str(cur[1]))
        total_tokens = int(cur[4])
        providers = _breakdown_rows(db, user_id, rng, "provider")
        models = _breakdown_rows(db, user_id, rng, "model")
        heatmap = get_heatmap(db, user_id, q)
        days = max(1, (rng.end - rng.start).total_seconds() / 86400)
        zone = _zone(rng.timezone)
        month_days = calendar.monthrange(*datetime.now(zone).date().timetuple()[:2])[1]
        projection = (spend / Decimal(str(days))) * month_days if spend else Decimal(0)
        return AnalyticsSummary(
            range=rng,
            total_spend=KpiValue(value=spend, previous=Decimal(str(prev[1])), change_pct=_change_pct(spend, prev[1])),
            total_requests=KpiValue(value=requests, previous=int(prev[0]), change_pct=_change_pct(requests, prev[0])),
            total_tokens=KpiValue(value=total_tokens, previous=int(prev[4]), change_pct=_change_pct(total_tokens, prev[4])),
            prompt_tokens=int(cur[2]), completion_tokens=int(cur[3]),
            cache_read_tokens=int(cur[5]), cache_write_tokens=int(cur[6]), reasoning_tokens=int(cur[7]),
            active_models=int(cur[10]), active_providers=int(cur[11]), active_conversations=int(cur[12]),
            avg_cost_per_request=(spend / requests) if requests else Decimal(0),
            avg_tokens_per_request=round(total_tokens / requests, 1) if requests else 0.0,
            avg_response_ms=_f(cur[8]), avg_ttfb_ms=_f(cur[9]),
            streaming_sessions=int(cur[15]), failed_requests=int(cur[13]), estimated_requests=int(cur[14]),
            projected_month_spend=projection.quantize(Decimal("0.0001")),
            insights=_insights(rng, cur, prev, providers, models, heatmap),
        )

    return _cached(user_id, _digest("summary", rng.preset, rng.start, rng.end, rng.timezone), AnalyticsSummary, build)


# --- timeseries -------------------------------------------------------------


def get_timeseries(db: Session, user_id: uuid.UUID, q: RangeQuery, granularity: str | None) -> AnalyticsTimeseries:
    rng = resolve_range(q)
    gran = granularity if granularity in GRANULARITIES else pick_granularity(rng)

    def build() -> AnalyticsTimeseries:
        bucket = func.date_trunc(gran, func.timezone(sql_timezone(db, rng.timezone), Message.created_at))
        rows = db.execute(
            select(
                bucket,
                func.count(Message.id),
                func.coalesce(func.sum(Message.total_cost), 0),
                func.coalesce(func.sum(Message.prompt_tokens), 0),
                func.coalesce(func.sum(Message.completion_tokens), 0),
                func.coalesce(func.sum(Message.total_tokens), 0),
                func.coalesce(func.sum(Message.cache_read_tokens), 0),
                func.coalesce(func.sum(Message.cache_write_tokens), 0),
                func.coalesce(func.sum(Message.reasoning_tokens), 0),
                func.avg(Message.latency_ms),
            )
            .select_from(Message)
            .where(*_scope(user_id, rng.start, rng.end))
            .group_by(bucket)
            .order_by(bucket)
        ).all()
        points = [
            TimeseriesPoint(
                bucket=r[0], requests=int(r[1]), spend=Decimal(str(r[2])),
                prompt_tokens=int(r[3]), completion_tokens=int(r[4]), total_tokens=int(r[5]),
                cache_read_tokens=int(r[6]), cache_write_tokens=int(r[7]), reasoning_tokens=int(r[8]),
                avg_latency_ms=_f(r[9]),
            )
            for r in rows
        ]
        return AnalyticsTimeseries(range=rng, granularity=gran, points=points)

    return _cached(user_id, _digest("timeseries", gran, rng.start, rng.end, rng.timezone), AnalyticsTimeseries, build)


# --- breakdown / models -----------------------------------------------------


def get_breakdown(db: Session, user_id: uuid.UUID, q: RangeQuery) -> AnalyticsBreakdown:
    rng = resolve_range(q)

    def build() -> AnalyticsBreakdown:
        return AnalyticsBreakdown(
            range=rng,
            by_provider=_breakdown_rows(db, user_id, rng, "provider"),
            by_model=_breakdown_rows(db, user_id, rng, "model"),
        )

    return _cached(user_id, _digest("breakdown", rng.start, rng.end, rng.timezone), AnalyticsBreakdown, build)


def get_models(db: Session, user_id: uuid.UUID, q: RangeQuery, sort: str) -> AnalyticsModels:
    rng = resolve_range(q)
    order = sort if sort in MODEL_SORTS else "most_expensive"

    def build() -> AnalyticsModels:
        models = _breakdown_rows(db, user_id, rng, "model")
        if order == "most_used":
            models.sort(key=lambda m: (m.requests, m.spend), reverse=True)
        elif order == "fastest":
            models.sort(key=lambda m: (m.avg_latency_ms is None, m.avg_latency_ms or 0))
        elif order == "slowest":
            models.sort(key=lambda m: (m.avg_latency_ms is None, -(m.avg_latency_ms or 0)))
        else:
            models.sort(key=lambda m: m.spend, reverse=True)
        return AnalyticsModels(range=rng, sort=order, models=models)

    return _cached(user_id, _digest("models", order, rng.start, rng.end, rng.timezone), AnalyticsModels, build)


# --- heatmap ----------------------------------------------------------------


def get_heatmap(db: Session, user_id: uuid.UUID, q: RangeQuery) -> AnalyticsHeatmap:
    rng = resolve_range(q)

    def build() -> AnalyticsHeatmap:
        local = func.timezone(sql_timezone(db, rng.timezone), Message.created_at)
        day = cast(func.extract("dow", local), Integer)
        hour = cast(func.extract("hour", local), Integer)
        rows = db.execute(
            select(
                day, hour,
                func.count(Message.id),
                func.coalesce(func.sum(Message.total_cost), 0),
                func.coalesce(func.sum(Message.total_tokens), 0),
            )
            .select_from(Message)
            .where(*_scope(user_id, rng.start, rng.end))
            .group_by(day, hour)
        ).all()
        by_cell = {(int(r[0]), int(r[1])): r for r in rows}
        cells: list[HeatmapCell] = []
        day_totals = {d: 0 for d in range(7)}
        peak = quiet = None
        for d in range(7):
            for h in range(24):
                r = by_cell.get((d, h))
                requests = int(r[2]) if r else 0
                cells.append(HeatmapCell(
                    day=d, hour=h, requests=requests,
                    spend=Decimal(str(r[3])) if r else Decimal(0),
                    tokens=int(r[4]) if r else 0,
                ))
                day_totals[d] += requests
                if peak is None or requests > peak.requests:
                    peak = HeatmapPeak(day=d, hour=h, requests=requests)
                if quiet is None or requests < quiet.requests:
                    quiet = HeatmapPeak(day=d, hour=h, requests=requests)
        max_requests = max((c.requests for c in cells), default=0)
        busiest_day = max(day_totals, key=lambda d: day_totals[d]) if max_requests else None
        if peak is not None and peak.requests == 0:
            peak = None
        return AnalyticsHeatmap(
            range=rng, cells=cells, max_requests=max_requests, peak=peak, quiet=quiet, busiest_day=busiest_day,
        )

    return _cached(user_id, _digest("heatmap", rng.start, rng.end, rng.timezone), AnalyticsHeatmap, build)


# --- performance ------------------------------------------------------------


def get_performance(db: Session, user_id: uuid.UUID, q: RangeQuery) -> AnalyticsPerformance:
    rng = resolve_range(q)

    def build() -> AnalyticsPerformance:
        cur = _totals(db, user_id, rng.start, rng.end)
        chars = db.execute(
            select(func.avg(func.length(Message.content)))
            .select_from(Message)
            .where(*_scope(user_id, rng.start, rng.end))
        ).scalar()
        by_model = _latency_rows(db, user_id, rng, "model")
        by_provider = _latency_rows(db, user_id, rng, "provider")
        measured = [m for m in by_model if m.avg_latency_ms is not None]
        fastest = min(measured, key=lambda m: m.avg_latency_ms or 0, default=None)
        slowest = max(measured, key=lambda m: m.avg_latency_ms or 0, default=None)
        avg_thinking = db.execute(
            select(func.avg(Message.thinking_ms))
            .select_from(Message)
            .where(*_scope(user_id, rng.start, rng.end), Message.thinking_ms.is_not(None))
        ).scalar()
        return AnalyticsPerformance(
            range=rng,
            avg_ttfb_ms=_f(cur[9]),
            avg_completion_ms=_f(cur[8]),
            avg_stream_duration_ms=_f(cur[8]),
            avg_response_chars=_f(chars),
            avg_thinking_ms=_f(avg_thinking),
            avg_tool_calls_per_request=None,
            fastest_model=fastest,
            slowest_model=slowest,
            by_model=by_model,
            by_provider=by_provider,
        )

    return _cached(user_id, _digest("performance", rng.start, rng.end, rng.timezone), AnalyticsPerformance, build)


# --- conversations ----------------------------------------------------------


def get_conversations(db: Session, user_id: uuid.UUID, q: RangeQuery) -> AnalyticsConversations:
    rng = resolve_range(q)

    def build() -> AnalyticsConversations:
        rows = db.execute(
            select(
                Conversation.id, Conversation.title, Conversation.updated_at,
                Provider.name, AIModel.name,
                func.count(Message.id),
                func.count(Message.id).filter(Message.role == Role.USER),
                func.coalesce(func.sum(Message.total_cost), 0),
                func.coalesce(func.sum(Message.total_tokens), 0),
                func.coalesce(func.max(Message.total_tokens), 0),
                func.avg(Message.latency_ms),
            )
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .outerjoin(Provider, Provider.id == Conversation.provider_id)
            .outerjoin(AIModel, AIModel.id == Conversation.model_id)
            .where(*_scope(user_id, rng.start, rng.end), Conversation.is_deleted.is_(False))
            .group_by(Conversation.id, Conversation.title, Conversation.updated_at, Provider.name, AIModel.name)
        ).all()
        items = [
            ConversationAnalyticsRow(
                id=str(r[0]), title=str(r[1] or "Untitled"), updated_at=r[2],
                provider_name=r[3], model_name=r[4],
                messages=int(r[5]), user_messages=int(r[6]),
                spend=Decimal(str(r[7])), tokens=int(r[8]), max_context_tokens=int(r[9]),
                avg_latency_ms=_f(r[10]),
            )
            for r in rows
        ]

        def top(key, reverse=True) -> list[ConversationAnalyticsRow]:
            return sorted(items, key=key, reverse=reverse)[:CONVERSATION_LIMIT]

        return AnalyticsConversations(
            range=rng,
            most_active=top(lambda c: c.messages),
            longest=top(lambda c: c.user_messages),
            most_expensive=top(lambda c: c.spend),
            largest_context=top(lambda c: c.max_context_tokens),
            highest_tokens=top(lambda c: c.tokens),
        )

    return _cached(user_id, _digest("conversations", rng.start, rng.end, rng.timezone), AnalyticsConversations, build)


# --- export -----------------------------------------------------------------


def export(
    db: Session, user_id: uuid.UUID, q: RangeQuery, dataset: str, export_format: str
) -> tuple[bytes | str, str, str]:
    """(content, filename, media_type) for one dataset (csv | xlsx | json)."""
    rng = resolve_range(q)
    stamp = rng.start.strftime("%Y%m%d")

    if dataset == "timeseries":
        data = get_timeseries(db, user_id, q, None)
        rows = [p.model_dump(mode="json") for p in data.points]
        columns = list(rows[0].keys()) if rows else ["bucket"]
    elif dataset == "models":
        data = get_models(db, user_id, q, "most_expensive")
        rows = [m.model_dump(mode="json") for m in data.models]
        columns = list(rows[0].keys()) if rows else ["key"]
    elif dataset == "providers":
        data = get_breakdown(db, user_id, q)
        rows = [p.model_dump(mode="json") for p in data.by_provider]
        columns = list(rows[0].keys()) if rows else ["key"]
    elif dataset == "conversations":
        data = get_conversations(db, user_id, q)
        rows = [c.model_dump(mode="json") for c in data.most_expensive]
        columns = list(rows[0].keys()) if rows else ["id"]
    else:  # summary
        dataset = "summary"
        summary = get_summary(db, user_id, q)
        rows = [{
            "range_start": summary.range.start.isoformat(),
            "range_end": summary.range.end.isoformat(),
            "timezone": summary.range.timezone,
            "total_spend": str(summary.total_spend.value),
            "previous_spend": str(summary.total_spend.previous),
            "spend_change_pct": summary.total_spend.change_pct,
            "total_requests": summary.total_requests.value,
            "previous_requests": summary.total_requests.previous,
            "requests_change_pct": summary.total_requests.change_pct,
            "total_tokens": summary.total_tokens.value,
            "prompt_tokens": summary.prompt_tokens,
            "completion_tokens": summary.completion_tokens,
            "cache_read_tokens": summary.cache_read_tokens,
            "cache_write_tokens": summary.cache_write_tokens,
            "reasoning_tokens": summary.reasoning_tokens,
            "active_models": summary.active_models,
            "active_providers": summary.active_providers,
            "active_conversations": summary.active_conversations,
            "avg_cost_per_request": str(summary.avg_cost_per_request),
            "avg_tokens_per_request": summary.avg_tokens_per_request,
            "avg_response_ms": summary.avg_response_ms,
            "avg_ttfb_ms": summary.avg_ttfb_ms,
            "streaming_sessions": summary.streaming_sessions,
            "failed_requests": summary.failed_requests,
            "estimated_requests": summary.estimated_requests,
            "projected_month_spend": str(summary.projected_month_spend),
            "insights": " | ".join(i.title for i in summary.insights),
        }]
        columns = list(rows[0].keys())

    if export_format == "xlsx":
        content = exporters.analytics_xlsx(
            [(dataset, columns, [[row.get(column) for column in columns] for row in rows])]
        )
        return (
            content,
            f"tollma-{dataset}-{stamp}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    if export_format == "json":
        content = json.dumps(
            {"dataset": dataset, "range": rng.model_dump(mode="json"), "rows": rows}, indent=2
        )
        return content, f"tollma-{dataset}-{stamp}.json", "application/json"

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue(), f"tollma-{dataset}-{stamp}.csv", "text/csv"


def render_export(
    db: Session,
    user,
    *,
    dataset: str,
    export_format: str,
    range_key: str,
    start: str | None = None,
    end: str | None = None,
    tz: str | None = None,
) -> tuple[bytes | str, str, str]:
    """Exports-API entry point: loose query params -> typed RangeQuery -> export."""
    from datetime import date as _date

    def _parse(value: str | None) -> _date | None:
        if not value:
            return None
        try:
            return _date.fromisoformat(value)
        except ValueError as exc:
            raise ValidationError(f"invalid date: {value}") from exc

    query = RangeQuery(preset=range_key, timezone=tz or "UTC", start=_parse(start), end=_parse(end))
    content, filename, media_type = export(db, user.id, query, dataset, export_format)
    request_log_engine.record_export(db, user.id, f"analytics:{dataset}", export_format, 0)
    db.commit()
    return content, media_type, filename


def get_widgets(db: Session, user_id: uuid.UUID, q: RangeQuery) -> "AnalyticsWidgets":
    """Conversation-intelligence widgets from the new history/share/export tables."""
    from sqlalchemy import desc

    from tollms.models.conversation import Conversation
    from tollms.models.message_history import GenerationRun, MessageVersion
    from tollms.models.request_log import ExportEvent
    from tollms.models.share import ConversationShare

    rng = resolve_range(q)
    owner = Conversation.user_id == user_id

    regeneration_count = db.execute(
        select(func.count(GenerationRun.id))
        .join(Message, Message.id == GenerationRun.message_id)
        .where(Message.user_id == user_id, Message.created_at >= rng.start, Message.created_at < rng.end)
    ).scalar_one()
    edit_count = db.execute(
        select(func.count(MessageVersion.id))
        .join(Message, Message.id == MessageVersion.message_id)
        .where(Message.user_id == user_id, MessageVersion.created_at >= rng.start, MessageVersion.created_at < rng.end)
    ).scalar_one()
    branch_count = db.execute(
        select(func.count(Conversation.id)).where(
            owner, Conversation.parent_conversation_id.is_not(None), Conversation.is_deleted.is_(False)
        )
    ).scalar_one()
    shared_conversations = db.execute(
        select(func.count(func.distinct(ConversationShare.conversation_id))).where(
            ConversationShare.user_id == user_id, ConversationShare.is_public.is_(True)
        )
    ).scalar_one()
    export_count = db.execute(
        select(func.count(ExportEvent.id)).where(
            ExportEvent.user_id == user_id, ExportEvent.created_at >= rng.start, ExportEvent.created_at < rng.end
        )
    ).scalar_one()

    most_regenerated = db.execute(
        select(Conversation.id, Conversation.title, func.count(GenerationRun.id).label("count"))
        .join(Message, Message.conversation_id == Conversation.id)
        .join(GenerationRun, GenerationRun.message_id == Message.id)
        .where(owner, Conversation.is_deleted.is_(False), Message.created_at >= rng.start, Message.created_at < rng.end)
        .group_by(Conversation.id, Conversation.title)
        .having(func.count(GenerationRun.id) > 1)
        .order_by(desc("count"))
        .limit(5)
    ).all()

    most_edited = db.execute(
        select(
            MessageVersion.message_id,
            Conversation.id,
            Conversation.title,
            func.count(MessageVersion.id).label("count"),
        )
        .join(Message, Message.id == MessageVersion.message_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(owner, Conversation.is_deleted.is_(False), MessageVersion.created_at >= rng.start, MessageVersion.created_at < rng.end)
        .group_by(MessageVersion.message_id, Conversation.id, Conversation.title)
        .order_by(desc("count"))
        .limit(5)
    ).all()

    return AnalyticsWidgets(
        regeneration_count=int(regeneration_count or 0),
        branch_count=int(branch_count or 0),
        shared_conversations=int(shared_conversations or 0),
        export_count=int(export_count or 0),
        edit_count=int(edit_count or 0),
        most_regenerated=[
            {"conversation_id": row[0], "title": row[1], "regeneration_count": int(row[2])}
            for row in most_regenerated
        ],
        most_edited=[
            {
                "message_id": row[0],
                "conversation_id": row[1],
                "conversation_title": row[2],
                "version_count": int(row[3]),
            }
            for row in most_edited
        ],
    )
