"""Analytics aggregation endpoints: totals, period comparison, bucketing,
rankings, insights, exports, and per-user isolation.

All numbers are derived server-side from `messages`; these tests seed the fact
table directly so assertions stay exact.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.analytics.service import RangeQuery, resolve_range
from tollms.models.conversation import Conversation
from tollms.models.message import Message, MessageStatus, Role


def _conversation(db: Session, user_id: uuid.UUID, title: str, provider_id=None, model_id=None) -> Conversation:
    conv = Conversation(user_id=user_id, title=title, provider_id=provider_id, model_id=model_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def _assistant(
    db: Session,
    *,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    provider_id=None,
    model_id=None,
    created_at: datetime,
    cost: str = "0.01",
    prompt: int = 100,
    completion: int = 50,
    latency: float | None = 1000.0,
    ttfb: float | None = 100.0,
    thinking: int | None = None,
    status: MessageStatus = MessageStatus.COMPLETED,
    estimated: bool = False,
    session_id: str | None = None,
) -> Message:
    msg = Message(
        user_id=user_id,
        conversation_id=conversation_id,
        role=Role.ASSISTANT,
        content="answer " * 20,
        provider_id=provider_id,
        model_id=model_id,
        status=status,
        created_at=created_at,
        completed_at=created_at,
        input_cost=Decimal(cost) / 2,
        output_cost=Decimal(cost) / 2,
        total_cost=Decimal(cost),
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        latency_ms=latency,
        ttfb_ms=ttfb,
        thinking_ms=thinking,
        usage_estimated=estimated,
        session_id=session_id,
    )
    db.add(msg)
    db.commit()
    return msg


# --- range resolution (pure) ------------------------------------------------


def test_resolve_range_presets_in_timezone() -> None:
    now = datetime(2026, 9, 20, 15, 30, tzinfo=timezone.utc)
    rng = resolve_range(RangeQuery(preset="this_month", timezone="Europe/Berlin"), now=now)
    # 2026-09-01 00:00 Berlin == 2026-08-31 22:00 UTC (CEST)
    assert rng.start == datetime(2026, 8, 31, 22, 0, tzinfo=timezone.utc)
    assert rng.end == now
    assert rng.prev_end == rng.start
    assert rng.prev_start == rng.start - (rng.end - rng.start)

    yesterday = resolve_range(RangeQuery(preset="yesterday", timezone="UTC"), now=now)
    assert yesterday.start == datetime(2026, 9, 19, tzinfo=timezone.utc)
    assert yesterday.end == datetime(2026, 9, 20, tzinfo=timezone.utc)

    last_month = resolve_range(RangeQuery(preset="last_month", timezone="UTC"), now=now)
    assert last_month.start == datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert last_month.end == datetime(2026, 9, 1, tzinfo=timezone.utc)

    custom = resolve_range(
        RangeQuery(preset="custom", timezone="UTC", start=datetime(2026, 9, 1).date(), end=datetime(2026, 9, 3).date()),
        now=now,
    )
    assert custom.start == datetime(2026, 9, 1, tzinfo=timezone.utc)
    assert custom.end == datetime(2026, 9, 4, tzinfo=timezone.utc)


def test_resolve_range_unknown_preset_and_timezone_fall_back() -> None:
    rng = resolve_range(RangeQuery(preset="nonsense", timezone="Mars/Olympus"))
    assert rng.preset == "this_month"
    assert rng.timezone == "Mars/Olympus"  # echoed; zone fallback is UTC


# --- summary + insights -----------------------------------------------------


def test_summary_totals_comparison_and_insights(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("analytics-summary@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Analytics P")
    m1 = model_factory(p["id"], model_id="mock-a", name="Model A", supports_reasoning=True)
    p2 = provider_factory("Analytics P2")
    m2 = model_factory(p2["id"], model_id="mock-b", name="Model B")

    rng = resolve_range(RangeQuery(preset="last_30d"))
    cur_at = rng.start + timedelta(days=1)
    prev_at = rng.prev_start + timedelta(days=1)
    conv = _conversation(db, uid, "Summary conv")
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m1["id"]), created_at=cur_at, cost="1.00", prompt=1000, completion=500,
               latency=1000.0, ttfb=100.0, thinking=300)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p2["id"]),
               model_id=uuid.UUID(m2["id"]), created_at=cur_at, cost="3.00", prompt=2000, completion=1000,
               latency=3000.0, ttfb=300.0, status=MessageStatus.FAILED, estimated=True)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m1["id"]), created_at=prev_at, cost="2.00", prompt=500, completion=500)

    r = client.get("/api/v1/analytics/summary", params={"range": "last_30d", "tz": "UTC"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert Decimal(data["total_spend"]["value"]) == Decimal("4.00")
    assert Decimal(data["total_spend"]["previous"]) == Decimal("2.00")
    assert data["total_spend"]["change_pct"] == 100.0
    assert data["total_requests"]["value"] == 2
    assert data["total_tokens"]["value"] == 4500
    assert data["prompt_tokens"] == 3000 and data["completion_tokens"] == 1500
    assert data["active_models"] == 2 and data["active_providers"] == 2 and data["active_conversations"] == 1
    assert Decimal(data["avg_cost_per_request"]) == Decimal("2.00")
    assert data["avg_tokens_per_request"] == 2250.0
    assert data["avg_response_ms"] == 2000.0
    assert data["avg_ttfb_ms"] == 200.0
    assert data["streaming_sessions"] == 2
    assert data["failed_requests"] == 1
    assert data["estimated_requests"] == 1
    assert float(data["projected_month_spend"]) > 0
    ids = {i["id"] for i in data["insights"]}
    assert "spend_trend" in ids and "top_provider" in ids and "failed_requests" in ids


def test_summary_is_scoped_per_user(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    other = user_factory("analytics-other@tollma.ai")
    p = provider_factory("Isolation P")
    m = model_factory(p["id"])
    rng = resolve_range(RangeQuery(preset="last_30d"))
    conv = _conversation(db, uuid.UUID(other["id"]), "Other conv", provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]))
    _assistant(db, user_id=uuid.UUID(other["id"]), conversation_id=conv.id,
               provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]),
               created_at=rng.start + timedelta(days=1), cost="9.00")

    me = user_factory("analytics-me@tollma.ai")
    assert me["id"] != other["id"]
    data = client.get("/api/v1/analytics/summary", params={"range": "last_30d"}).json()
    assert Decimal(data["total_spend"]["value"]) == Decimal("0")
    assert data["total_requests"]["value"] == 0


# --- timeseries -------------------------------------------------------------


def test_timeseries_buckets_in_requested_granularity(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("analytics-series@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Series P")
    m = model_factory(p["id"])
    conv = _conversation(db, uid, "Series conv")
    base = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m["id"]), created_at=base, cost="1.50", prompt=100, completion=100)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m["id"]), created_at=base + timedelta(days=1, hours=2), cost="0.50", prompt=50, completion=50)

    r = client.get(
        "/api/v1/analytics/timeseries",
        params={"range": "custom", "start": "2026-09-01", "end": "2026-09-02", "granularity": "day", "tz": "UTC"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["granularity"] == "day"
    assert [p["bucket"] for p in data["points"]] == ["2026-09-01T00:00:00", "2026-09-02T00:00:00"]
    assert Decimal(data["points"][0]["spend"]) == Decimal("1.50")
    assert data["points"][1]["requests"] == 1
    assert data["points"][0]["total_tokens"] == 200

    hourly = client.get(
        "/api/v1/analytics/timeseries",
        params={"range": "custom", "start": "2026-09-01", "end": "2026-09-01", "granularity": "hour", "tz": "Europe/Berlin"},
    ).json()
    # 10:00 UTC == 12:00 Berlin (September, CEST)
    assert hourly["points"][0]["bucket"] == "2026-09-01T12:00:00"


# --- breakdown + model ranking ----------------------------------------------


def test_breakdown_shares_and_model_sorting(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("analytics-breakdown@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Break P")
    fast = model_factory(p["id"], model_id="fast", name="Fast Model")
    slow = model_factory(p["id"], model_id="slow", name="Slow Model")
    conv = _conversation(db, uid, "Break conv")
    rng = resolve_range(RangeQuery(preset="last_30d"))
    at = rng.start + timedelta(days=1)
    for _ in range(3):
        _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
                   model_id=uuid.UUID(fast["id"]), created_at=at, cost="1.00", latency=500.0)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(slow["id"]), created_at=at, cost="1.00", latency=5000.0)

    b = client.get("/api/v1/analytics/breakdown", params={"range": "last_30d"}).json()
    assert len(b["by_provider"]) == 1
    assert b["by_provider"][0]["share_pct"] == 100.0
    names = [row["name"] for row in b["by_model"]]
    assert names[0] == "Fast Model"  # spend desc, tie → insertion order
    fast_row = next(r for r in b["by_model"] if r["name"] == "Fast Model")
    slow_row = next(r for r in b["by_model"] if r["name"] == "Slow Model")
    assert fast_row["requests"] == 3 and slow_row["requests"] == 1
    assert fast_row["error_rate"] == 0.0

    by_use = client.get("/api/v1/analytics/models", params={"range": "last_30d", "sort": "most_used"}).json()
    assert by_use["models"][0]["name"] == "Fast Model"
    fastest = client.get("/api/v1/analytics/models", params={"range": "last_30d", "sort": "fastest"}).json()
    assert fastest["models"][0]["name"] == "Fast Model"
    slowest = client.get("/api/v1/analytics/models", params={"range": "last_30d", "sort": "slowest"}).json()
    assert slowest["models"][0]["name"] == "Slow Model"
    expensive = client.get("/api/v1/analytics/models", params={"range": "last_30d", "sort": "most_expensive"}).json()
    assert expensive["sort"] == "most_expensive"

    assert Decimal(fast_row["avg_cost"]) == Decimal("1.00")  # 3.00 spend / 3 requests


# --- heatmap ----------------------------------------------------------------


def test_heatmap_peak_and_quiet_in_timezone(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("analytics-heat@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Heat P")
    m = model_factory(p["id"])
    conv = _conversation(db, uid, "Heat conv")
    # Monday 2026-09-07 19:00 Berlin == 17:00 UTC (DOW 1 = Monday in Postgres)
    monday = datetime(2026, 9, 7, 17, 0, tzinfo=timezone.utc)
    for _ in range(4):
        _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
                   model_id=uuid.UUID(m["id"]), created_at=monday, cost="0.25")
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m["id"]), created_at=monday + timedelta(days=1), cost="0.25")

    r = client.get(
        "/api/v1/analytics/heatmap",
        params={"range": "custom", "start": "2026-09-07", "end": "2026-09-08", "tz": "Europe/Berlin"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["cells"]) == 7 * 24
    assert data["peak"]["day"] == 1 and data["peak"]["hour"] == 19 and data["peak"]["requests"] == 4
    assert data["busiest_day"] == 1
    assert data["max_requests"] == 4
    assert data["quiet"]["requests"] == 0


# --- performance ------------------------------------------------------------


def test_performance_metrics_and_fastest_slowest(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    user = user_factory("analytics-perf@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Perf P")
    quick = model_factory(p["id"], model_id="quick", name="Quick")
    slow = model_factory(p["id"], model_id="slow", name="Slow")
    conv = _conversation(db, uid, "Perf conv")
    at = resolve_range(RangeQuery(preset="last_30d")).start + timedelta(days=1)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(quick["id"]), created_at=at, latency=400.0, ttfb=80.0, thinking=250)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(slow["id"]), created_at=at, latency=4200.0, ttfb=900.0)

    data = client.get("/api/v1/analytics/performance", params={"range": "last_30d"}).json()
    assert data["avg_completion_ms"] == 2300.0
    assert data["avg_ttfb_ms"] == 490.0
    assert data["avg_stream_duration_ms"] == 2300.0
    assert data["avg_thinking_ms"] == 250.0
    assert data["avg_tool_calls_per_request"] is None
    assert data["fastest_model"]["name"] == "Quick"
    assert data["slowest_model"]["name"] == "Slow"
    assert len(data["by_provider"]) == 1


# --- conversations ----------------------------------------------------------


def test_conversation_rankings(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory("analytics-conv@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Conv P")
    m = model_factory(p["id"])
    at = resolve_range(RangeQuery(preset="last_30d")).start + timedelta(days=1)
    busy = _conversation(db, uid, "Busy", provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]))
    costly = _conversation(db, uid, "Costly", provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]))
    for _ in range(3):
        _assistant(db, user_id=uid, conversation_id=busy.id, provider_id=uuid.UUID(p["id"]),
                   model_id=uuid.UUID(m["id"]), created_at=at, cost="0.10")
    _assistant(db, user_id=uid, conversation_id=costly.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m["id"]), created_at=at, cost="5.00", prompt=9000, completion=1000)

    data = client.get("/api/v1/analytics/conversations", params={"range": "last_30d"}).json()
    assert data["most_active"][0]["title"] == "Busy"
    assert data["most_expensive"][0]["title"] == "Costly"
    assert data["highest_tokens"][0]["title"] == "Costly"
    assert data["largest_context"][0]["title"] == "Costly"
    assert data["longest"][0]["messages"] >= 1
    assert data["most_expensive"][0]["provider_name"] == "Conv P"
    assert data["most_expensive"][0]["model_name"] == "Mock"


# --- export -----------------------------------------------------------------


def test_export_csv_and_json(client: TestClient, db: Session, user_factory, provider_factory, model_factory) -> None:
    user = user_factory("analytics-export@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Export P")
    m = model_factory(p["id"], name="Export Model")
    conv = _conversation(db, uid, "Export conv")
    at = resolve_range(RangeQuery(preset="last_30d")).start + timedelta(days=1)
    _assistant(db, user_id=uid, conversation_id=conv.id, provider_id=uuid.UUID(p["id"]),
               model_id=uuid.UUID(m["id"]), created_at=at, cost="1.25")

    csv_res = client.get("/api/v1/analytics/export", params={"range": "last_30d", "dataset": "models", "format": "csv"})
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "attachment" in csv_res.headers["content-disposition"]
    assert "Export Model" in csv_res.text

    json_res = client.get("/api/v1/analytics/export", params={"range": "last_30d", "dataset": "summary", "format": "json"})
    assert json_res.status_code == 200
    payload = json_res.json()
    assert payload["dataset"] == "summary"
    assert payload["rows"][0]["total_requests"] == 1

    bad = client.get("/api/v1/analytics/export", params={"dataset": "nope"})
    assert bad.status_code == 422


def test_legacy_timezone_alias_buckets_correctly(
    client: TestClient, db: Session, user_factory, provider_factory, model_factory
) -> None:
    """Browsers still send CLDR legacy ids (Asia/Calcutta); PostgreSQL's tzdata
    dropped some links. The service canonicalizes instead of 500ing."""
    user = user_factory("analytics-alias@tollma.ai")
    uid = uuid.UUID(user["id"])
    p = provider_factory("Alias P")
    m = model_factory(p["id"])
    conv = _conversation(db, uid, "Alias conv")
    # Monday 2026-09-07 17:00 UTC == 22:30 Asia/Kolkata (IST)
    at = datetime(2026, 9, 7, 17, 0, tzinfo=timezone.utc)
    _assistant(
        db, user_id=uid, conversation_id=conv.id,
        provider_id=uuid.UUID(p["id"]), model_id=uuid.UUID(m["id"]), created_at=at,
    )

    r = client.get(
        "/api/v1/analytics/heatmap",
        params={"range": "custom", "start": "2026-09-07", "end": "2026-09-07", "tz": "Asia/Calcutta"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["range"]["timezone"] == "Asia/Kolkata"
    assert data["peak"]["day"] == 1 and data["peak"]["hour"] == 22

    series = client.get(
        "/api/v1/analytics/timeseries",
        params={"range": "custom", "start": "2026-09-07", "end": "2026-09-07", "granularity": "hour", "tz": "Asia/Calcutta"},
    )
    assert series.status_code == 200, series.text
    assert series.json()["points"][0]["bucket"] == "2026-09-07T22:00:00"


def test_analytics_requires_auth(client: TestClient) -> None:
    # Fresh client without cookies: dependency override still returns 401.
    assert client.get("/api/v1/analytics/summary").status_code == 401
