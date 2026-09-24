"""Platform user analytics: account counts plus per-user activity rows.

Rows aggregate assistant generations by owner; emails resolve through one
LEFT JOIN to ``users`` (never per-row queries). Only ids, emails and
aggregates leave this engine — no user-owned content. ``total_users`` counts
live accounts; ``new_users`` counts accounts created inside the window.

Engines return plain mappings (validated by the router's ``AdminUsers``
response model); this package never imports from ``tollms.api``.
"""

import logging
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message
from tollms.models.user import User
from tollms.services.admin import AdminWindow
from tollms.services.admin.usage import scope_conditions, window_range

logger = logging.getLogger(__name__)


def _like(term: str) -> str:
    """Escape LIKE wildcards so search text matches literally."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _row(row: Any) -> dict[str, Any]:
    """One ``AdminUserRow`` shaped mapping (email + activity aggregates)."""
    return {
        "user_id": row[0],
        "email": row[1],
        "requests": int(row[2] or 0),
        "total_tokens": int(row[3] or 0),
        "total_cost": Decimal(str(row[4] or 0)),
        "conversations": int(row[5] or 0),
        "cache_read_tokens": int(row[6] or 0),
        "last_active_at": row[7],
    }


def users(
    db: Session,
    window: AdminWindow,
    *,
    limit: int = 10,
    search: str | None = None,
) -> dict[str, Any]:
    """User counts plus activity rows, spend-descending (matches ``AdminUsers``)."""
    total_users, new_users = db.execute(
        select(
            func.count(User.id),
            func.count(User.id).filter(
                User.created_at >= window.start, User.created_at < window.end
            ),
        ).where(User.is_deleted.is_(False))
    ).one()
    scope = scope_conditions(window)
    active_users = db.execute(
        select(func.count(func.distinct(Message.user_id)))
        .select_from(Message)
        .where(*scope)
    ).scalar_one()
    term = (search or "").strip()
    if term:
        scope.append(User.email.ilike(_like(term), escape="\\"))
    rows = db.execute(
        select(
            Message.user_id,
            User.email,
            func.count(Message.id),
            func.coalesce(func.sum(Message.total_tokens), 0),
            func.coalesce(func.sum(Message.total_cost), 0),
            func.count(func.distinct(Message.conversation_id)),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.max(Message.created_at),
        )
        .select_from(Message)
        .outerjoin(User, User.id == Message.user_id)
        .where(*scope)
        .group_by(Message.user_id, User.email)
        .order_by(func.coalesce(func.sum(Message.total_cost), 0).desc())
        .limit(limit)
    ).all()
    return {
        "range": window_range(window),
        "total_users": int(total_users or 0),
        "active_users": int(active_users or 0),
        "new_users": int(new_users or 0),
        "rows": [_row(row) for row in rows],
    }
