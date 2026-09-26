"""Per-provider usage analytics (platform-wide, aggregated).

Fact table: ``messages``. Provider names/types resolve through one grouped
join — no per-row lookups. This is a leaf engine (it is composed by the
usage/cost endpoints), so its small window helpers stay local instead of
importing back from ``usage``.

Engines return plain mappings (validated by the router's ``AdminProviders``
response model); this package never imports from ``tollms.api``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.services.admin import AdminWindow

logger = logging.getLogger(__name__)


def _window_range(window: AdminWindow) -> dict[str, Any]:
    """AdminRange payload for the resolved window."""
    return {
        "preset": window.preset,
        "timezone": window.timezone,
        "start": window.start,
        "end": window.end,
        "prev_start": window.prev_start,
        "prev_end": window.prev_end,
    }


def _scope(window: AdminWindow) -> list[Any]:
    """Fact-table filters: live assistant generations in the window."""
    return [
        Message.is_deleted.is_(False),
        Message.role == Role.ASSISTANT,
        Message.created_at >= window.start,
        Message.created_at < window.end,
    ]


def _row(row: Any, health: dict) -> dict[str, Any]:
    """One ``AdminProviderRow`` shaped mapping (never content)."""
    requests = int(row[3] or 0)
    provider_type = row[2]
    status = health.get(row[0], {})
    return {
        "provider_id": row[0],
        "provider_name": row[1] or "Unknown",
        "provider_type": getattr(provider_type, "value", provider_type) or None,
        "requests": requests,
        "total_tokens": int(row[4] or 0),
        "total_cost": Decimal(str(row[5] or 0)),
        "error_rate": round(int(row[6] or 0) / requests * 100, 2) if requests else 0.0,
        "avg_latency_ms": float(row[7]) if row[7] is not None else None,
        "validation_status": status.get("validation_status", "unknown"),
        "validation_message": status.get("validation_message"),
        "last_validated_at": status.get("last_validated_at"),
    }


def _credential_health(db: Session) -> tuple[dict[str, int], dict]:
    """Live-provider credential states + per-id lookup (one query)."""
    rows = db.execute(
        select(
            Provider.id,
            Provider.validation_status,
            Provider.validation_message,
            Provider.last_validated_at,
        ).where(Provider.is_deleted.is_(False))
    ).all()
    summary: dict[str, int] = {"healthy": 0, "broken": 0, "unknown": 0}
    by_id: dict = {}
    for row in rows:
        state = (row[1] or "unknown").lower()
        bucket = "healthy" if state in ("valid", "healthy", "ok") else "broken" if state in ("invalid", "error", "failed") else "unknown"
        summary[bucket] += 1
        by_id[row[0]] = {
            "validation_status": row[1] or "unknown",
            "validation_message": row[2],
            "last_validated_at": row[3],
        }
    return summary, by_id


def providers(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Provider usage rows, spend-descending (matches ``AdminProviders``)."""
    summary, by_id = _credential_health(db)
    rows = db.execute(
        select(
            Message.provider_id,
            Provider.name,
            Provider.provider_type,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
            func.avg(Message.latency_ms),
        )
        .select_from(Message)
        .outerjoin(Provider, Provider.id == Message.provider_id)
        .where(*_scope(window))
        .group_by(Message.provider_id, Provider.name, Provider.provider_type)
        .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        .limit(limit)
    ).all()
    return {
        "range": _window_range(window),
        "rows": [_row(row, by_id) for row in rows],
        "credential_health": summary,
    }
