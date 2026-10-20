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

Key-scoped calls (``key_id`` is not None) additionally merge the in-app-chat
ledger ``request_logs WHERE api_key_id = :key`` (UTC half-open ``[start, end)``
on ``created_at``, same as the gateway). The two ledgers have disjoint writers
(gateway vs chat UI), so summed rows never double-count. In-app rows surface
under the ``"chat"`` endpoint label downstream; ``timeout``/``retry`` stay
gateway-only (``request_logs`` has no ``request_id`` column for the retry
approximation). Chat ``cancelled`` folds in ``"regenerated"`` so every
non-success row stays visible in the failed+cancelled error breakout
(same semantics as ``api/keys/analytics.py``). Latency percentiles for a key
merge exactly via a ``UNION ALL`` subquery. Errors propagate (raise,
never silent-empty).

Grouped SQL only: this module never reads raw payloads (there are none) and
never performs per-row lookups.
"""

import logging
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, union_all
from sqlalchemy.orm import Session

from tollms.core.exceptions import ValidationError
from tollms.models.api_key import ApiRequestLog
from tollms.models.request_log import RequestLog
from tollms.services.analytics import AnalyticsWindow
from tollms.services.analytics import presets as preset_vocab
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
#: Extra chat status folded into ``cancelled`` so non-success stays visible
#: (same error semantics as ``api/keys/analytics.py``).
CHAT_CANCELLED_STATUSES = (STATUS_CANCELLED, "regenerated")

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

    Legacy aliases from the other analytics surfaces are accepted via the
    shared preset vocabulary (``services/analytics/presets``); unknown
    presets fall back to :data:`DEFAULT_PRESET`. ``custom`` requires
    both bounds and ``end`` is inclusive (the window ends at the following
    local midnight).
    """
    zone = _zone(timezone_name)
    moment = now or datetime.now(timezone.utc)
    today = moment.astimezone(zone).date()

    def midnight(day: date) -> datetime:
        return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)

    resolved = preset_vocab.normalize(preset, family="gateway")
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


def _chat_scope(window: AnalyticsWindow, *, previous: bool = False, key_id: Any) -> list[Any]:
    """In-app-chat conditions: same UTC half-open window on ``created_at``."""
    start, end = (window.prev_start, window.prev_end) if previous else (window.start, window.end)
    return [RequestLog.api_key_id == key_id, RequestLog.created_at >= start, RequestLog.created_at < end]


def _chat_totals_select(conditions: list[Any]):
    """Chat counts/costs/tokens (no latency percentiles here — merged exactly below)."""
    return (
        select(
            func.count(RequestLog.id),
            func.count(RequestLog.id).filter(RequestLog.status == STATUS_SUCCESS),
            func.count(RequestLog.id).filter(RequestLog.status == STATUS_FAILED),
            func.count(RequestLog.id).filter(RequestLog.status.in_(CHAT_CANCELLED_STATUSES)),
            func.coalesce(func.sum(RequestLog.total_cost), 0),
            func.max(RequestLog.total_cost),
            func.coalesce(func.sum(RequestLog.prompt_tokens), 0),
            func.coalesce(func.sum(RequestLog.completion_tokens), 0),
            func.coalesce(func.sum(RequestLog.reasoning_tokens), 0),
            func.coalesce(func.sum(RequestLog.cache_read_tokens), 0),
            func.coalesce(func.sum(RequestLog.cache_write_tokens), 0),
            func.coalesce(func.sum(RequestLog.total_tokens), 0),
        )
        .select_from(RequestLog)
        .where(*conditions)
    )


def _combined_performance(
    db: Session, window: AnalyticsWindow, *, key_id: Any, previous: bool = False
) -> dict[str, float | None]:
    """Exact latency over the UNION ALL of gateway + chat latencies (one scan)."""
    start, end = (window.prev_start, window.prev_end) if previous else (window.start, window.end)
    union = union_all(
        select(ApiRequestLog.latency_ms.label("lat")).where(
            ApiRequestLog.api_key_id == key_id,
            ApiRequestLog.created_at >= start,
            ApiRequestLog.created_at < end,
            ApiRequestLog.latency_ms.is_not(None),
        ),
        select(RequestLog.latency_ms.label("lat")).where(
            RequestLog.api_key_id == key_id,
            RequestLog.created_at >= start,
            RequestLog.created_at < end,
            RequestLog.latency_ms.is_not(None),
        ),
    ).subquery()
    row = db.execute(
        select(
            func.avg(union.c.lat),
            func.percentile_cont(0.5).within_group(union.c.lat),
            func.percentile_cont(0.9).within_group(union.c.lat),
            func.percentile_cont(0.95).within_group(union.c.lat),
            func.percentile_cont(0.99).within_group(union.c.lat),
            func.max(union.c.lat),
            func.min(union.c.lat),
        )
    ).one()
    return performance_from_row(row, 0)


def _merge_key_totals(gw_row: Any, chat_row: Any, performance: dict[str, Any]) -> dict[str, Any]:
    """Sum gateway + chat aggregates; ``timeout``/``retry`` stay gateway-only."""
    gw_total, gw_max = cost_from_row(gw_row, _COST_START)
    gw_tokens = tokens_from_row(gw_row, _TOKEN_START)
    chat_cost = Decimal(str(chat_row[4] or 0))
    chat_max = chat_row[5]
    merged_max = gw_max
    if chat_max is not None and (merged_max is None or Decimal(str(chat_max)) > merged_max):
        merged_max = Decimal(str(chat_max))
    tokens = {
        "prompt": int(gw_tokens["prompt"] or 0) + int(chat_row[6] or 0),
        "completion": int(gw_tokens["completion"] or 0) + int(chat_row[7] or 0),
        "reasoning": int(gw_tokens["reasoning"] or 0) + int(chat_row[8] or 0),
        "cache_read": int(gw_tokens["cache_read"] or 0) + int(chat_row[9] or 0),
        "cache_write": int(gw_tokens["cache_write"] or 0) + int(chat_row[10] or 0),
        "total": int(gw_tokens["total"] or 0) + int(chat_row[11] or 0),
    }
    return {
        "total": int(gw_row[0] or 0) + int(chat_row[0] or 0),
        "success": int(gw_row[1] or 0) + int(chat_row[1] or 0),
        "failed": int(gw_row[2] or 0) + int(chat_row[2] or 0),
        "cancelled": int(gw_row[3] or 0) + int(chat_row[3] or 0),
        "timeout": int(gw_row[4] or 0),
        "retry": max(int(gw_row[5] or 0), 0),
        "cost": gw_total + chat_cost,
        "max_cost": merged_max,
        "tokens": tokens,
        "performance": performance,
    }


def totals(db: Session, window: AnalyticsWindow, *, key_id: Any = None, user_id: Any = None) -> dict[str, Any]:
    """Current + previous request/token/cost/latency aggregates.

    Gateway-only in one round-trip; key-scoped merges the in-app-chat ledger
    (gateway UNION ALL + chat UNION ALL + exact latency unions).
    """
    if key_id is None:
        rows = db.execute(
            _totals_select(scope(window, key_id=key_id, user_id=user_id)).union_all(
                _totals_select(scope(window, previous=True, key_id=key_id, user_id=user_id))
            )
        ).all()
        return {"current": _shape(rows[0]), "previous": _shape(rows[1])}
    gw_rows = db.execute(
        _totals_select(scope(window, key_id=key_id, user_id=user_id)).union_all(
            _totals_select(scope(window, previous=True, key_id=key_id, user_id=user_id))
        )
    ).all()
    chat_rows = db.execute(
        _chat_totals_select(_chat_scope(window, key_id=key_id)).union_all(
            _chat_totals_select(_chat_scope(window, previous=True, key_id=key_id))
        )
    ).all()
    return {
        "current": _merge_key_totals(
            gw_rows[0], chat_rows[0], _combined_performance(db, window, key_id=key_id)
        ),
        "previous": _merge_key_totals(
            gw_rows[1], chat_rows[1], _combined_performance(db, window, key_id=key_id, previous=True)
        ),
    }


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
