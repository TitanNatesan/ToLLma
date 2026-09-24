"""Per-model usage analytics (platform-wide, aggregated).

Fact table: ``messages``. Names resolve through one grouped join to ``models``
and their ``providers`` — no per-row lookups. This is a leaf engine (it is
composed by the usage/cost endpoints), so its small window helpers stay local
instead of importing back from ``usage``.

Engines return plain mappings (validated by the router's ``AdminModels``
response model); this package never imports from ``tollms.api``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.models.message import Message, MessageStatus, Role
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
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


def _like(term: str) -> str:
    """Escape LIKE wildcards so search text matches literally."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _row(row: Any) -> dict[str, Any]:
    """One ``AdminModelRow`` shaped mapping (never content)."""
    requests = int(row[3] or 0)
    return {
        "model_id": row[0],
        "model_name": row[1] or "Unknown",
        "provider_name": row[2],
        "requests": requests,
        "total_tokens": int(row[4] or 0),
        "total_cost": Decimal(str(row[5] or 0)),
        "cache_read_tokens": int(row[6] or 0),
        "error_rate": round(int(row[7] or 0) / requests * 100, 2) if requests else 0.0,
        "avg_latency_ms": float(row[8]) if row[8] is not None else None,
    }


def models(
    db: Session,
    window: AdminWindow,
    *,
    limit: int = 10,
    search: str | None = None,
) -> dict[str, Any]:
    """Per-model usage rows, spend-descending (matches ``AdminModels``)."""
    scope = _scope(window)
    term = (search or "").strip()
    if term:
        pattern = _like(term)
        scope.append(
            or_(
                AIModel.name.ilike(pattern, escape="\\"),
                AIModel.model_id.ilike(pattern, escape="\\"),
                Provider.name.ilike(pattern, escape="\\"),
            )
        )
    rows = db.execute(
        select(
            Message.model_id,
            AIModel.name,
            Provider.name,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.count(Message.id).filter(Message.status == MessageStatus.FAILED),
            func.avg(Message.latency_ms),
        )
        .select_from(Message)
        .outerjoin(AIModel, AIModel.id == Message.model_id)
        .outerjoin(Provider, Provider.id == AIModel.provider_id)
        .where(*scope)
        .group_by(Message.model_id, AIModel.name, Provider.name)
        .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        .limit(limit)
    ).all()
    return {"range": _window_range(window), "rows": [_row(row) for row in rows]}
