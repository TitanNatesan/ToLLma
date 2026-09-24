"""Token analytics over assistant generations (platform-wide).

Cache tokens are provider-reported extras stored outside prompt/completion
totals. ``cached_share`` = cache_read / (prompt + cache_read + cache_write);
providers that already include cache reads in ``prompt`` slightly understate
it. Per-model rows reuse the models engine so every page agrees.

Engines return plain mappings (validated by the router's ``AdminTokens``
response model); this package never imports from ``tollms.api``.
"""

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.models.message import Message
from tollms.services.admin import AdminWindow
from tollms.services.admin import models as models_service
from tollms.services.admin.usage import bucket_expr, scope_conditions, window_range

logger = logging.getLogger(__name__)


def _series(db: Session, window: AdminWindow) -> list[dict[str, Any]]:
    """Token sums per bucket for the window's granularity, ordered by bucket."""
    bucket = bucket_expr(db, window)
    rows = db.execute(
        select(
            bucket,
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.reasoning_tokens), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
        )
        .select_from(Message)
        .where(*scope_conditions(window))
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        {
            "bucket": row[0],
            "prompt_tokens": int(row[1] or 0),
            "completion_tokens": int(row[2] or 0),
            "cache_read_tokens": int(row[3] or 0),
            "cache_write_tokens": int(row[4] or 0),
            "reasoning_tokens": int(row[5] or 0),
            "total_tokens": int(row[6] or 0),
        }
        for row in rows
        if row[0] is not None
    ]


def tokens(db: Session, window: AdminWindow, *, limit: int = 10) -> dict[str, Any]:
    """Token totals, cached share, trend and top models (matches ``AdminTokens``)."""
    prompt, completion, cache_read, cache_write, reasoning, total = db.execute(
        select(
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
            func.coalesce(func.sum(Message.cache_read_tokens), 0),
            func.coalesce(func.sum(Message.cache_write_tokens), 0),
            func.coalesce(func.sum(Message.reasoning_tokens), 0),
            func.coalesce(func.sum(Message.total_tokens), 0),
        )
        .select_from(Message)
        .where(*scope_conditions(window))
    ).one()
    prompt, completion = int(prompt or 0), int(completion or 0)
    cache_read, cache_write = int(cache_read or 0), int(cache_write or 0)
    input_tokens = prompt + cache_read + cache_write
    return {
        "range": window_range(window),
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
        "reasoning_tokens": int(reasoning or 0),
        "total_tokens": int(total or 0),
        "cached_share": round(cache_read / input_tokens, 4) if input_tokens else 0.0,
        "series": _series(db, window),
        "by_model": models_service.models(db, window, limit=limit)["rows"],
    }
