"""Unit tests for `tollms.services.analytics.models.model_rows` (pure, no DB)."""

from decimal import Decimal

from tollms.services.analytics.models import model_rows


def test_model_rows_folds_same_name_cross_ledger_duplicates() -> None:
    rows = [
        {
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "requests": 2,
            "success": 2,
            "cost": Decimal("0.04"),
            "tokens": 200,
            "latency_sum": 2000.0,
            "latency_count": 2,
        },
        {
            "provider": "Gemini AI",
            "model": "gemini-2.5-flash",
            "requests": 3,
            "success": 2,
            "cost": Decimal("0.06"),
            "tokens": 300,
            "latency_sum": 6000.0,
            "latency_count": 3,
        },
        {
            "provider": "openai",
            "model": "gpt-4o",
            "requests": 1,
            "success": 1,
            "cost": Decimal("0.10"),
            "tokens": 50,
            "latency_sum": 500.0,
            "latency_count": 1,
        },
    ]

    out = model_rows(rows)

    assert len(out) == 2  # duplicates fold; distinct names stay separate
    merged = next(r for r in out if r["model"] == "gemini-2.5-flash")
    assert merged["provider"] == "gemini"  # first-seen label wins
    assert merged["requests"] == 5
    assert merged["tokens"] == 500
    assert merged["spend"] == Decimal("0.10")
    assert merged["avg_latency_ms"] == round(8000.0 / 5, 2)
    assert merged["success_rate"] == round(4 / 5, 4)
