"""Cost aggregates over ``api_request_logs``.

Three responsibilities:

* ``cost_columns`` / ``cost_from_row`` — the spend sum and max used by the
  shared totals scan.
* ``trailing_costs`` / ``cost_payload`` / ``most_expensive`` — total, today /
  7d / 30d trailing sums, linear month projection, per-request and per-token
  averages, and the single most expensive request.
* ``cache_savings`` — token and money savings from cache reads using the
  registered ``AIModel`` prices of each grouped model row: per-read savings are
  ``cache_read_tokens * (input_price - cache_read_price) / 1e6`` and are counted
  only when both rates are published (> 0); a provider split is returned too.

Date windows resolve locally (services never import from ``api/``); day
boundaries follow the window timezone. ``Decimal`` math never touches floats.
"""

import calendar
import logging
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiRequestLog

logger = logging.getLogger(__name__)

_MILLION = Decimal(1_000_000)
_MONEY = Decimal("0.000001")
_RATE = Decimal("0.00000001")


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except Exception:  # noqa: BLE001 - unknown IANA name degrades to UTC
        logger.warning("analytics costs: unknown timezone %r, using UTC", name)
        return ZoneInfo("UTC")


def _t(value: Any) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def cost_columns() -> tuple[Any, ...]:
    """(sum, max) cost columns (order matches ``cost_from_row``)."""
    return (
        func.coalesce(func.sum(ApiRequestLog.cost), 0),
        func.max(ApiRequestLog.cost),
    )


def cost_from_row(row: Any, start: int) -> tuple[Decimal, Decimal]:
    """(total spend, max request cost) from an aggregate row."""
    return _t(row[start]), _t(row[start + 1])


def _key_filter(key_id: Any) -> list[Any]:
    return [ApiRequestLog.api_key_id == key_id] if key_id is not None else []


def trailing_costs(db: Session, window: Any, *, key_id: Any = None) -> dict[str, Decimal]:
    """Spend for today / last 7d / last 30d relative to now (one scan)."""
    now = datetime.now(timezone.utc)
    zone = _zone(getattr(window, "timezone", "UTC"))
    today_start = datetime.combine(now.astimezone(zone).date(), time.min, tzinfo=zone).astimezone(timezone.utc)
    earliest = min(today_start, now - timedelta(days=30))
    row = db.execute(
        select(
            func.coalesce(
                func.sum(ApiRequestLog.cost).filter(ApiRequestLog.created_at >= today_start), 0
            ),
            func.coalesce(
                func.sum(ApiRequestLog.cost).filter(
                    ApiRequestLog.created_at >= now - timedelta(days=7)
                ),
                0,
            ),
            func.coalesce(
                func.sum(ApiRequestLog.cost).filter(
                    ApiRequestLog.created_at >= now - timedelta(days=30)
                ),
                0,
            ),
        )
        .where(ApiRequestLog.created_at >= earliest, ApiRequestLog.created_at < now, *_key_filter(key_id))
    ).one()
    return {"today": _t(row[0]), "last_7d": _t(row[1]), "last_30d": _t(row[2])}


def projected_month_cost(total: Decimal, window: Any) -> Decimal:
    """Linear month projection: window spend per day x days in the month."""
    days = max((window.end - window.start).total_seconds() / 86400, 1.0)
    month_days = calendar.monthrange(window.end.year, window.end.month)[1]
    return (total / Decimal(str(days)) * month_days).quantize(_MONEY)


def cost_payload(
    *,
    total: Decimal,
    trailing: dict[str, Decimal],
    window: Any,
    tokens_total: int,
    requests_total: int,
    expensive: dict[str, Any] | None,
) -> dict[str, Any]:
    """Cost section matching the frozen platform/detail contract (0-safe)."""
    return {
        "total": total,
        "today": trailing["today"],
        "last_7d": trailing["last_7d"],
        "last_30d": trailing["last_30d"],
        "projected_month": projected_month_cost(total, window),
        "cost_per_request": (total / requests_total).quantize(_RATE) if requests_total else Decimal(0),
        "cost_per_token": (total / tokens_total).quantize(_RATE) if tokens_total else Decimal(0),
        "most_expensive_request": expensive,
    }


def most_expensive(db: Session, window: Any, *, key_id: Any = None) -> dict[str, Any] | None:
    """The highest-cost request in the window (None when the window is empty)."""
    row = db.execute(
        select(
            ApiRequestLog.cost,
            ApiRequestLog.model,
            ApiRequestLog.provider,
            ApiRequestLog.endpoint,
            ApiRequestLog.latency_ms,
            ApiRequestLog.created_at,
        )
        .where(
            ApiRequestLog.created_at >= window.start,
            ApiRequestLog.created_at < window.end,
            *_key_filter(key_id),
        )
        .order_by(ApiRequestLog.cost.desc().nullslast(), ApiRequestLog.created_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    return {
        "cost": _t(row[0]),
        "model": row[1],
        "provider": row[2],
        "endpoint": row[3],
        "latency_ms": _f(row[4]),
        "at": row[5],
    }


def _price(value: Any) -> Decimal:
    return _t(value)


def row_savings(row: dict[str, Any]) -> Decimal:
    """Money saved by one grouped model row's cache reads (0 when unpriced)."""
    input_price = _price(row.get("input_price"))
    cache_price = _price(row.get("cache_read_price"))
    if input_price <= 0 or cache_price <= 0:
        return Decimal(0)
    return Decimal(int(row.get("cache_read_tokens") or 0)) * (input_price - cache_price) / _MILLION


def cache_savings(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Token/money savings plus a per-provider split (pure fold, no queries)."""
    tokens_saved = 0
    money_saved = Decimal(0)
    by_provider: dict[str, dict[str, Any]] = {}
    for row in rows:
        reads = int(row.get("cache_read_tokens") or 0)
        if reads <= 0:
            continue  # providers without cache reads never appear in the split
        tokens_saved += reads
        gain = row_savings(row)
        money_saved += gain
        name = row.get("provider") or "unknown"
        bucket = by_provider.setdefault(
            name, {"provider": name, "tokens_saved": 0, "money_saved": Decimal(0)}
        )
        bucket["tokens_saved"] += reads
        bucket["money_saved"] += gain
    providers = sorted(by_provider.values(), key=lambda item: item["money_saved"], reverse=True)
    return {"tokens_saved": tokens_saved, "money_saved": money_saved, "by_provider": providers}
