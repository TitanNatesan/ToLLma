"""Model dimension rows (folded from the shared provider/model grouped scan).

Model names come from the request log itself (``ApiRequestLog.model`` is the
provider-facing string), so no registry join is required and unknown models are
labelled ``unknown`` rather than dropped.
"""

from typing import Any

from tollms.services.analytics.aggregations import TOP_LIMIT


def model_rows(rows: list[dict[str, Any]], *, limit: int = TOP_LIMIT) -> list[dict[str, Any]]:
    """Shape spend-ranked model rows from (provider, model) aggregates.

    Folded by model name: the same model can arrive as two rows (in-app-chat
    rows carry the registry display name, gateway rows the adapter family
    string — or one model served via two providers). Without folding,
    per-model charts render duplicate same-name bars and crash on duplicate
    React keys. Provider attribution keeps the first-seen label; the
    per-provider view folds separately and is untouched.
    """
    folded: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = str(row["model"] or "unknown")
        cell = folded.get(name)
        if cell is None:
            folded[name] = {
                "provider": row["provider"] or "unknown",
                "requests": int(row["requests"]),
                "success": int(row["success"]),
                "cost": row["cost"],
                "tokens": int(row["tokens"]),
                "latency_sum": float(row["latency_sum"]),
                "latency_count": int(row["latency_count"]),
            }
            continue
        cell["requests"] += int(row["requests"])
        cell["success"] += int(row["success"])
        cell["cost"] += row["cost"]
        cell["tokens"] += int(row["tokens"])
        cell["latency_sum"] += float(row["latency_sum"])
        cell["latency_count"] += int(row["latency_count"])
    shaped = [
        {
            "model": name,
            "provider": cell["provider"],
            "requests": cell["requests"],
            "spend": cell["cost"],
            "tokens": cell["tokens"],
            "avg_latency_ms": round(cell["latency_sum"] / cell["latency_count"], 2)
            if cell["latency_count"]
            else None,
            "success_rate": round(cell["success"] / cell["requests"], 4)
            if cell["requests"]
            else 0.0,
        }
        for name, cell in folded.items()
    ]
    shaped.sort(key=lambda item: (item["spend"], item["requests"]), reverse=True)
    return shaped[:limit]
