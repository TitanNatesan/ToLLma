"""Model dimension rows (folded from the shared provider/model grouped scan).

Model names come from the request log itself (``ApiRequestLog.model`` is the
provider-facing string), so no registry join is required and unknown models are
labelled ``unknown`` rather than dropped.
"""

from typing import Any

from tollms.services.analytics.aggregations import TOP_LIMIT


def model_rows(rows: list[dict[str, Any]], *, limit: int = TOP_LIMIT) -> list[dict[str, Any]]:
    """Shape spend-ranked model rows from (provider, model) aggregates."""
    shaped = [
        {
            "model": row["model"] or "unknown",
            "provider": row["provider"] or "unknown",
            "requests": int(row["requests"]),
            "spend": row["cost"],
            "tokens": int(row["tokens"]),
            "avg_latency_ms": round(row["latency_sum"] / row["latency_count"], 2)
            if row["latency_count"]
            else None,
            "success_rate": round(int(row["success"]) / int(row["requests"]), 4)
            if row["requests"]
            else 0.0,
        }
        for row in rows
    ]
    shaped.sort(key=lambda item: (item["spend"], item["requests"]), reverse=True)
    return shaped[:limit]
