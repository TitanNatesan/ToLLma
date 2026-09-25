"""Window resolution, scope conditions and the shared request-totals scan.

``api_request_logs`` is the fact table: one row per public-gateway request
(metadata only — tokens, cost, status, latency, client/geo fields). Presets
resolve locally (services never import from ``api/``): ``24h``, ``7d``, ``30d``,
``90d`` and ``custom`` (ISO dates, end inclusive). ``prev_*`` is the equal
window immediately before ``start`` for period-over-period insights; day
boundaries follow the requested IANA timezone and every preset ends at ``now``.

The totals scan returns current *and* previous window aggregates in one
round-trip (``UNION ALL`` of two index scans) with these column groups:

* requests — total / success / failed / cancelled, plus two documented
  approximations: ``timeout`` counts rows whose ``error_code`` contains
  ``timeout``; ``retry`` is ``count(*) - count(distinct request_id)`` inside
  the window, so a retry that reuses a request id across a window boundary is
  not counted.
* cost, tokens and latency columns owned by the sibling metric modules.

Grouped SQL only: this module never reads raw payloads (there are none) and
never performs per-row lookups.
"""

import logging
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import ValidationError
from tollms.models.api_key import ApiRequestLog
from tollms.services.analytics import AnalyticsWindow
from tollms.services.analytics.costs import cost_columns, cost_from_row
from tollms.services.analytics.latency import latency_columns, performance_from_row
from tollms.services.analytics.tokens import token_columns, tokens_from_row

logger = logging.getLogger(__name__)

PRESETS = ("24h", "7d", "30d", "90d", "custom")
DEFAULT_PRESET = "7d"
TOP_LIMIT = 10

STATUS_SUCCESS = "success"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

_COST_START = 6
_TOKEN_START = 8
_LATENCY_START = 14

_TZ_CACHE: dict[str, str] = {}


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except Exception:  # noqa: BLE001 - unknown IANA name degrades to UTC
        logger.warning("analytics: unknown timezone %r, using UTC", name)
        return ZoneInfo("UTC")


def pick_granularity(span: timedelta) -> str:
    """Bucket size for a window span: hour (<=2d), day (<=45d), else week."""
    if span <= timedelta(days=2):
        return "hour"
    if span <= timedelta(days=45):
        return "day"
    return "week"


def resolve_window(
    preset: str,
    timezone_name: str = "UTC",
    start: date | None = None,
    end: date | None = None,
    *,
    now: datetime | None = None,
) -> AnalyticsWindow:
    """Resolve a preset (or custom bounds) into UTC instants + comparison window.

    Unknown presets fall back to :data:`DEFAULT_PRESET`. ``custom`` requires
    both bounds and ``end`` is inclusive (the window ends at the following
    local midnight).
    """
    zone = _zone(timezone_name)
    moment = now or datetime.now(timezone.utc)
    today = moment.astimezone(zone).date()

    def midnight(day: date) -> datetime:
        return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)

    resolved = preset if preset in PRESETS else DEFAULT_PRESET
    if resolved == "24h":
        start_at, end_at = moment - timedelta(hours=24), moment
    elif resolved == "7d":
        start_at, end_at = midnight(today - timedelta(days=6)), moment
    elif resolved == "30d":
        start_at, end_at = midnight(today - timedelta(days=29)), moment
    elif resolved == "90d":
        start_at, end_at = midnight(today - timedelta(days=89)), moment
    else:
        if start is None or end is None:
            raise ValidationError("custom range requires both start and end dates")
        if end < start:
            raise ValidationError("range end must not be before range start")
        start_at, end_at = midnight(start), midnight(end + timedelta(days=1))
    span = end_at - start_at
    if span <= timedelta(0):
        span = timedelta(hours=24)
    return AnalyticsWindow(
        start=start_at,
        end=end_at,
        prev_start=start_at - span,
        prev_end=start_at,
        preset=resolved,
        timezone=timezone_name or "UTC",
        granularity=pick_granularity(span),
    )


def window_payload(window: AnalyticsWindow) -> dict[str, Any]:
    """Range payload shared by every analytics response."""
    return {
        "preset": window.preset,
        "timezone": window.timezone,
        "start": window.start,
        "end": window.end,
        "prev_start": window.prev_start,
        "prev_end": window.prev_end,
    }


def sql_timezone(db: Session, name: str) -> str:
    """A timezone PostgreSQL accepts for ``timezone()``, else UTC (memoized)."""
    candidate = name or "UTC"
    cached = _TZ_CACHE.get(candidate)
    if cached is not None:
        return cached
    try:
        db.execute(select(func.timezone(candidate, func.now()))).scalar()
    except Exception:  # noqa: BLE001 - bad zone must not fail the request
        db.rollback()
        logger.warning("analytics: PostgreSQL rejected timezone %r; using UTC", candidate)
        _TZ_CACHE[candidate] = "UTC"
        return "UTC"
    _TZ_CACHE[candidate] = candidate
    return candidate


def bucket_expr(db: Session, window: AnalyticsWindow, column: Any = None) -> Any:
    """``date_trunc`` bucket for the window granularity in its timezone."""
    target = ApiRequestLog.created_at if column is None else column
    return func.date_trunc(window.granularity, func.timezone(sql_timezone(db, window.timezone), target))


def scope(
    window: AnalyticsWindow,
    *,
    previous: bool = False,
    key_id: Any = None,
    user_id: Any = None,
) -> list[Any]:
    """Fact-table conditions: time window + optional key/user filter."""
    start, end = (window.prev_start, window.prev_end) if previous else (window.start, window.end)
    conditions: list[Any] = [ApiRequestLog.created_at >= start, ApiRequestLog.created_at < end]
    if key_id is not None:
        conditions.append(ApiRequestLog.api_key_id == key_id)
    if user_id is not None:
        conditions.append(ApiRequestLog.user_id == user_id)
    return conditions


def _totals_select(conditions: list[Any]):
    return (
        select(
            func.count(ApiRequestLog.id),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_SUCCESS),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_FAILED),
            func.count(ApiRequestLog.id).filter(ApiRequestLog.status == STATUS_CANCELLED),
            func.count(ApiRequestLog.id).filter(
                func.lower(func.coalesce(ApiRequestLog.error_code, "")).like("%timeout%")
            ),
            func.count(ApiRequestLog.id) - func.count(func.distinct(ApiRequestLog.request_id)),
            *cost_columns(),
            *token_columns(),
            *latency_columns(),
        )
        .select_from(ApiRequestLog)
        .where(*conditions)
    )


def _shape(row: Any) -> dict[str, Any]:
    total, max_cost = cost_from_row(row, _COST_START)
    return {
        "total": int(row[0] or 0),
        "success": int(row[1] or 0),
        "failed": int(row[2] or 0),
        "cancelled": int(row[3] or 0),
        "timeout": int(row[4] or 0),
        "retry": max(int(row[5] or 0), 0),
        "cost": total,
        "max_cost": max_cost,
        "tokens": tokens_from_row(row, _TOKEN_START),
        "performance": performance_from_row(row, _LATENCY_START),
    }


def totals(db: Session, window: AnalyticsWindow, *, key_id: Any = None, user_id: Any = None) -> dict[str, Any]:
    """Current + previous request/token/cost/latency aggregates (one round-trip)."""
    rows = db.execute(
        _totals_select(scope(window, key_id=key_id, user_id=user_id)).union_all(
            _totals_select(scope(window, previous=True, key_id=key_id, user_id=user_id))
        )
    ).all()
    return {"current": _shape(rows[0]), "previous": _shape(rows[1])}


def requests_payload(current: dict[str, Any], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    """Requests section with 0-safe rates (matches the frozen contract)."""
    total = int(current["total"])
    errors = int(current["failed"]) + int(current["cancelled"])
    return {
        "total": total,
        "success": int(current["success"]),
        "failed": int(current["failed"]),
        "cancelled": int(current["cancelled"]),
        "success_rate": round(int(current["success"]) / total, 4) if total else 0.0,
        "error_rate": round(errors / total, 4) if total else 0.0,
        "timeout": int(current["timeout"]),
        "retry": int(current["retry"]),
    }


def endpoint_rows(rows: list[dict[str, Any]], total_requests: int, *, limit: int = TOP_LIMIT) -> list[dict[str, Any]]:
    """Endpoint dimension from the shared grouping-set rows, request-share ranked."""
    shaped = [
        {
            "endpoint": row["endpoint"],
            "requests": int(row["requests"]),
            "spend": Decimal(str(row["cost"])),
            "share": round(int(row["requests"]) / total_requests, 4) if total_requests else 0.0,
        }
        for row in rows
    ]
    shaped.sort(key=lambda item: item["requests"], reverse=True)
    return shaped[:limit]
