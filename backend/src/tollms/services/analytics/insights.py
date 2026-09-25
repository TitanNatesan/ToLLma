"""Insight generation: pure functions over already-aggregated analytics.

No database access happens here. Callers pass plain aggregates (request
totals, spend, tokens, latency, errors, model rows and cache savings) plus the
equal preceding window and receive ``{id, severity, title, detail, metric,
delta_pct, share_pct}`` rows:

* **cost driver** — the model with the largest spend share.
* **traffic driver** — the model with the largest request share.
* **token efficiency** — cost/request, cost/token and tokens/request.
* **cache savings** — money and tokens saved by prompt-cache reads.
* **trends** — period-over-period deltas (up/down %) for requests, spend,
  tokens, latency and errors versus the equal preceding window.

``delta_pct`` is ``None`` when both windows are zero, ``100.0`` when only the
current window has data, otherwise the rounded percent change.
"""

from decimal import Decimal
from typing import Any

SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"


def delta_pct(current: float, previous: float) -> float | None:
    """Percent change (``None`` when both zero, ``100.0`` when previous is zero)."""
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def _insight(
    insight_id: str,
    severity: str,
    title: str,
    detail: str,
    metric: str,
    *,
    delta: float | None = None,
    share: float | None = None,
) -> dict[str, Any]:
    return {
        "id": insight_id,
        "severity": severity,
        "title": title,
        "detail": detail,
        "metric": metric,
        "delta_pct": delta,
        "share_pct": share,
    }


def _money(value: Any) -> str:
    return f"${float(value or 0):,.4f}"


def cost_driver(models: list[dict[str, Any]]) -> dict[str, Any] | None:
    """``X% of spend came from <model>`` (top-spend model)."""
    total = sum((Decimal(str(row["spend"])) for row in models), Decimal(0))
    if total <= 0 or not models:
        return None
    top = max(models, key=lambda row: Decimal(str(row["spend"])))
    share = round(float(Decimal(str(top["spend"])) / total) * 100, 1)
    severity = SEVERITY_WARNING if share >= 50 else SEVERITY_INFO
    return _insight(
        "cost_driver",
        severity,
        "Top cost driver",
        f"{share}% of spend came from {top['model']} ({_money(top['spend'])}).",
        "spend",
        share=share,
    )


def traffic_driver(models: list[dict[str, Any]]) -> dict[str, Any] | None:
    """``<model> generated X% of requests`` (top-request model)."""
    total = sum(int(row["requests"]) for row in models)
    if total <= 0 or not models:
        return None
    top = max(models, key=lambda row: int(row["requests"]))
    share = round(int(top["requests"]) / total * 100, 1)
    return _insight(
        "traffic_driver",
        SEVERITY_INFO,
        "Top traffic driver",
        f"{top['model']} generated {share}% of requests ({int(top['requests'])}).",
        "requests",
        share=share,
    )


def token_efficiency(
    *,
    requests: int,
    tokens_total: int,
    spend: Any,
) -> dict[str, Any] | None:
    """Cost/request, cost/token and requests/token in one info row."""
    if requests <= 0:
        return None
    money = Decimal(str(spend or 0))
    cost_per_request = money / requests
    cost_per_token = money / tokens_total if tokens_total else Decimal(0)
    tokens_per_request = tokens_total / requests
    return _insight(
        "token_efficiency",
        SEVERITY_INFO,
        "Token efficiency",
        f"Average cost {_money(cost_per_request)} per request, "
        f"${float(cost_per_token):.6f} per token, {tokens_per_request:,.0f} tokens per request.",
        "cost_per_request",
    )


def cache_savings_insight(savings: dict[str, Any]) -> dict[str, Any] | None:
    """``cache saved $X / N tokens`` (None when nothing was cached)."""
    tokens_saved = int(savings.get("tokens_saved") or 0)
    if tokens_saved <= 0:
        return None
    return _insight(
        "cache_savings",
        SEVERITY_INFO,
        "Prompt cache savings",
        f"Cache saved {_money(savings.get('money_saved'))} across {tokens_saved:,} tokens.",
        "cache_read_tokens",
    )


_TREND_METRICS = (
    ("trend_requests", "Requests", "requests", "requests", False),
    ("trend_spend", "Spend", "spend", "spend", False),
    ("trend_tokens", "Tokens", "tokens", "tokens", False),
    ("trend_latency", "Latency", "avg_latency_ms", "latency_ms", True),
    ("trend_errors", "Errors", "errors", "errors", True),
)


def _format(metric_key: str, value: float) -> str:
    if metric_key == "spend":
        return _money(value)
    if metric_key in ("latency_ms",):
        return f"{value:,.1f} ms"
    return f"{value:,.0f}"


def trend_insights(current: dict[str, Any], previous: dict[str, Any]) -> list[dict[str, Any]]:
    """↑/↓ deltas for requests/spend/tokens/latency/errors vs. the previous window."""
    rows: list[dict[str, Any]] = []
    for insight_id, label, key, metric, risky in _TREND_METRICS:
        current_value = current.get(key)
        previous_value = previous.get(key)
        if current_value is None or previous_value is None:
            continue
        delta = delta_pct(float(current_value), float(previous_value))
        if delta is None:
            continue
        direction = "up" if delta >= 0 else "down"
        severity = SEVERITY_INFO
        if risky and delta >= 20:
            severity = SEVERITY_CRITICAL if delta >= 100 else SEVERITY_WARNING
        rows.append(
            _insight(
                insight_id,
                severity,
                f"{label} {direction}",
                f"{label} {direction} {abs(delta)}% versus the previous period "
                f"({_format(metric, float(current_value))} vs {_format(metric, float(previous_value))}).",
                metric,
                delta=delta,
            )
        )
    return rows


def build(
    *,
    requests: int,
    spend: Any,
    tokens_total: int,
    avg_latency_ms: float | None,
    errors: int,
    models: list[dict[str, Any]],
    savings: dict[str, Any],
    previous: dict[str, Any],
) -> list[dict[str, Any]]:
    """Every insight row for one window (cost/traffic/efficiency/cache/trends)."""
    rows: list[dict[str, Any]] = []
    for candidate in (cost_driver(models), traffic_driver(models)):
        if candidate is not None:
            rows.append(candidate)
    efficiency = token_efficiency(requests=requests, tokens_total=tokens_total, spend=spend)
    if efficiency is not None:
        rows.append(efficiency)
    cached = cache_savings_insight(savings)
    if cached is not None:
        rows.append(cached)
    current = {
        "requests": requests,
        "spend": float(Decimal(str(spend or 0))),
        "tokens": tokens_total,
        "avg_latency_ms": avg_latency_ms,
        "errors": errors,
    }
    rows.extend(trend_insights(current, previous))
    return rows
