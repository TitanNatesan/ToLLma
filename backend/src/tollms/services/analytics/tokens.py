"""Token aggregates over ``api_request_logs``.

The totals query in ``aggregations`` selects :func:`token_columns` inside its
single aggregate scan; :func:`tokens_from_row` / :func:`tokens_payload` shape
the result. ``reasoning`` and cache tokens are provider-reported extras stored
outside prompt/completion. ``total`` falls back to the component sum when the
stored total is absent/zero (legacy rows), so the section always adds up.
"""

from typing import Any

from sqlalchemy import func

from tollms.models.api_key import ApiRequestLog

TOKEN_COLUMNS = 6


def token_columns() -> tuple[Any, ...]:
    """Per-token-kind sums for one ``select`` (order matches ``tokens_from_row``)."""
    return (
        func.coalesce(func.sum(ApiRequestLog.input_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.output_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.reasoning_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.cache_read_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.cache_write_tokens), 0),
        func.coalesce(func.sum(ApiRequestLog.total_tokens), 0),
    )


def tokens_from_row(row: Any, start: int) -> dict[str, int]:
    """Token sums from an aggregate row starting at ``start``."""
    return {
        "prompt": int(row[start] or 0),
        "completion": int(row[start + 1] or 0),
        "reasoning": int(row[start + 2] or 0),
        "cache_read": int(row[start + 3] or 0),
        "cache_write": int(row[start + 4] or 0),
        "total": int(row[start + 5] or 0),
    }


def tokens_payload(tokens: dict[str, int], requests: int) -> dict[str, Any]:
    """``{prompt, completion, reasoning, cache_read, cache_write, total, per_request}``."""
    total = int(tokens["total"] or 0)
    if total <= 0:
        total = (
            int(tokens["prompt"])
            + int(tokens["completion"])
            + int(tokens["reasoning"])
            + int(tokens["cache_read"])
            + int(tokens["cache_write"])
        )
    return {
        "prompt": int(tokens["prompt"]),
        "completion": int(tokens["completion"]),
        "reasoning": int(tokens["reasoning"]),
        "cache_read": int(tokens["cache_read"]),
        "cache_write": int(tokens["cache_write"]),
        "total": total,
        "per_request": round(total / requests, 2) if requests else 0.0,
    }
