"""Latency aggregates over ``api_request_logs``.

PostgreSQL ``percentile_cont`` ordered-set aggregates run inside the single
totals scan selected by ``aggregations``; this module owns the column list and
the row shaping. Ordered-set aggregates ignore NULL latencies, which is the
intended semantic: requests with no measured latency never drag the
percentiles toward zero.
"""

from typing import Any

from sqlalchemy import func

from tollms.models.api_key import ApiRequestLog

LATENCY_COLUMNS = 7


def latency_columns() -> tuple[Any, ...]:
    """avg + p50/p90/p95/p99 + slowest/fastest (order matches ``performance_from_row``)."""
    return (
        func.avg(ApiRequestLog.latency_ms),
        func.percentile_cont(0.5).within_group(ApiRequestLog.latency_ms),
        func.percentile_cont(0.9).within_group(ApiRequestLog.latency_ms),
        func.percentile_cont(0.95).within_group(ApiRequestLog.latency_ms),
        func.percentile_cont(0.99).within_group(ApiRequestLog.latency_ms),
        func.max(ApiRequestLog.latency_ms),
        func.min(ApiRequestLog.latency_ms),
    )


def _f(value: Any) -> float | None:
    return float(value) if value is not None else None


def performance_from_row(row: Any, start: int) -> dict[str, float | None]:
    """Performance payload from an aggregate row starting at ``start``."""
    return {
        "avg_latency_ms": _f(row[start]),
        "p50_ms": _f(row[start + 1]),
        "p90_ms": _f(row[start + 2]),
        "p95_ms": _f(row[start + 3]),
        "p99_ms": _f(row[start + 4]),
        "slowest_ms": _f(row[start + 5]),
        "fastest_ms": _f(row[start + 6]),
    }
