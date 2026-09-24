"""Dashboard composition engine: one payload for the platform overview.

Composes the admin analytics engines (usage, tokens, cache, media, errors,
health) into the frozen `AdminDashboard` shape. KPI comparisons reuse the
engines against the preceding window, so every number matches the section
endpoints exactly.
"""

import logging
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message, MessageStatus, Role
from tollms.services.admin import AdminWindow
from tollms.services.admin import cache as cache_service
from tollms.services.admin import errors as errors_service
from tollms.services.admin import health as health_service
from tollms.services.admin import media as media_service
from tollms.services.admin import tokens as tokens_service
from tollms.services.admin import usage as usage_service

logger = logging.getLogger(__name__)

_ASSISTANT = [Message.role == Role.ASSISTANT, Message.is_deleted.is_(False)]


def _kpi(value: Any, previous: Any) -> dict[str, Any]:
    current = Decimal(str(value or 0))
    before = Decimal(str(previous or 0))
    change: float | None = None
    if before > 0:
        change = float((current - before) / before * 100)
    return {"value": current, "previous": before, "change_pct": change}


def _previous_totals(db: Session, window: AdminWindow) -> dict[str, Any]:
    """Requests/tokens/cost/active users for the preceding window (one query)."""
    row = db.execute(
        select(
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.count(func.distinct(Message.user_id)),
        ).where(
            *_ASSISTANT,
            Message.created_at >= window.prev_start,
            Message.created_at < window.prev_end,
        )
    ).one()
    return {
        "requests": int(row[0] or 0),
        "total_tokens": int(row[1] or 0),
        "total_cost": Decimal(str(row[2] or 0)),
        "active_users": int(row[3] or 0),
    }


def _health_summary(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": payload.get("status", "ok"),
        "database": _check_status(payload, "database"),
        "cache": _check_status(payload, "cache"),
        "active_generations": int(payload.get("active_generations") or 0),
        "avg_latency_ms": payload.get("avg_latency_ms"),
        "p95_latency_ms": payload.get("p95_latency_ms"),
        "error_rate_1h": float(payload.get("error_rate_1h") or 0),
    }


def _check_status(payload: dict[str, Any], name: str) -> str:
    for check in payload.get("checks") or []:
        if check.get("name") == name:
            return str(check.get("status") or "ok")
    return "ok"


def dashboard(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Platform overview: KPIs with period comparison, trends, top routes, health."""
    usage = usage_service.usage(db, window)
    tokens = tokens_service.tokens(db, window, limit=limit)
    cache = cache_service.cache(db, window, limit=limit)
    media = media_service.media(db, window, limit=limit)
    errors = errors_service.errors(db, window, limit=5)
    health = health_service.health(db)

    previous_window = replace(window, start=window.prev_start, end=window.prev_end)
    previous = _previous_totals(db, window)
    previous_cache = cache_service.cache(db, previous_window, limit=1)
    previous_media = media_service.media(db, previous_window, limit=1)
    previous_errors = errors_service.errors(db, previous_window, limit=1)

    return {
        "range": usage["range"],
        "generated_at": datetime.now(timezone.utc),
        "requests": _kpi(usage["requests"], previous["requests"]),
        "active_users": _kpi(usage["active_users"], previous["active_users"]),
        "total_tokens": _kpi(usage["total_tokens"], previous["total_tokens"]),
        "total_cost": _kpi(usage["total_cost"], previous["total_cost"]),
        "cache_savings": _kpi(cache["savings"], previous_cache["savings"]),
        "error_rate": _kpi(errors["error_rate"], previous_errors["error_rate"]),
        "images": _kpi(media["images"], previous_media["images"]),
        "videos": _kpi(media["videos"], previous_media["videos"]),
        "spend_series": usage["series"],
        "token_series": tokens["series"],
        "top_models": usage["by_model"][:limit],
        "top_providers": usage["by_provider"][:limit],
        "recent_errors": errors["by_code"][:limit],
        "health": _health_summary(health),
    }
