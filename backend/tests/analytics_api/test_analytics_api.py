"""Targeted tests for `/api/analytics` and the admin API-key section.

Covers the frozen contract shapes, empty-window zeros, seeded aggregates
(requests/percentiles/cost/tokens/cache savings), insight generation (cost
driver share, cache savings, period trend deltas), time-series buckets and
stacked grouping, user scoping (404), platform admin gating (403) and the
`/api/admin/api-keys` payload.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.analytics_api import service
from tollms.models.api_key import ApiKey, ApiKeyIpRule, ApiRequestLog, IpRuleType
from tollms.models.provider import Provider, ProviderType
from tollms.models.registered_model import AIModel, EndpointType
from tollms.models.user import PlatformRole, User
from tollms.services.analytics.network import detect_client

WINDOW = {"preset": "7d", "timezone": "UTC"}

PLATFORM_KEYS = {
    "range",
    "requests",
    "performance",
    "cost",
    "tokens",
    "providers",
    "models",
    "endpoints",
    "keys",
    "top_keys",
    "key_growth",
    "key_spend",
    "key_errors",
    "key_cache_savings",
    "insights",
}
DETAIL_KEYS = {
    "range",
    "key",
    "requests",
    "performance",
    "cost",
    "tokens",
    "cache_savings",
    "providers",
    "models",
    "endpoints",
    "insights",
}
ADMIN_KEY_KEYS = {
    "range",
    "total",
    "active",
    "disabled",
    "expired",
    "rotated",
    "top_keys",
    "spend_by_key",
    "errors_by_key",
    "cache_savings_by_key",
    "growth",
}


# --- helpers ----------------------------------------------------------------


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _make_key(
    db: Session,
    user_id: uuid.UUID,
    name: str = "Key",
    *,
    enabled: bool = True,
    expires_at: datetime | None = None,
    rotation_count: int = 0,
    last_used_at: datetime | None = None,
) -> ApiKey:
    key = ApiKey(
        user_id=user_id,
        name=name,
        key_prefix=f"tma_sk_live_{uuid.uuid4().hex[:8]}",
        key_hash=uuid.uuid4().hex + uuid.uuid4().hex,
        enabled=enabled,
        expires_at=expires_at,
        rotation_count=rotation_count,
        last_used_at=last_used_at,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


def _priced_model(
    db: Session,
    user_id: uuid.UUID,
    *,
    model_id: str = "gpt-test",
    input_price: str = "10",
    cache_read_price: str = "2",
) -> AIModel:
    provider = Provider(
        user_id=user_id,
        name=f"prov-{uuid.uuid4().hex[:6]}",
        provider_type=ProviderType.CUSTOM,
        credentials_encrypted="enc",
    )
    db.add(provider)
    db.flush()
    model = AIModel(
        provider_id=provider.id,
        model_id=model_id,
        name=model_id,
        endpoint_type=EndpointType.CHAT_COMPLETIONS,
        input_price=Decimal(input_price),
        cache_read_price=Decimal(cache_read_price),
    )
    db.add(model)
    db.commit()
    return model


def _seed_log(
    db: Session,
    key: ApiKey,
    when: datetime,
    *,
    cost: str = "0.01",
    tokens: int = 100,
    latency: float = 100.0,
    status: str = "success",
    model: str = "gpt-test",
    provider: str = "openai",
    endpoint: str = "/v1/chat/completions",
    cache_read: int = 0,
    ip: str | None = None,
    user_agent: str | None = None,
    device_type: str | None = None,
    platform: str | None = None,
    browser: str | None = None,
    country: str | None = None,
    city: str | None = None,
    region: str | None = None,
    request_id: str | None = None,
) -> ApiRequestLog:
    row = ApiRequestLog(
        request_id=request_id or f"req-{uuid.uuid4().hex[:12]}",
        api_key_id=key.id,
        user_id=key.user_id,
        provider=provider,
        model=model,
        endpoint=endpoint,
        status=status,
        latency_ms=latency,
        cost=Decimal(cost),
        input_tokens=tokens // 2,
        output_tokens=tokens - tokens // 2,
        cache_read_tokens=cache_read,
        total_tokens=tokens,
        ip_address=ip,
        user_agent=user_agent,
        device_type=device_type,
        platform=platform,
        browser=browser,
        country=country,
        city=city,
        region=region,
        created_at=when,
    )
    db.add(row)
    db.commit()
    return row


def _window(preset: str = "7d"):
    return service.resolve_window(service.AnalyticsQuery(preset=preset))


# --- client detection / unit -------------------------------------------------


def test_detect_client_table() -> None:
    cases = [
        ("OpenAI/Python 1.30.0", "openai-python"),
        ("openai-python/1.30.0", "openai-python"),
        ("claude-code/1.0.0", "claude-code"),
        ("cursor/0.42.0", "cursor"),
        ("cline/3.0.0", "cline"),
        ("continue/1.0.0", "continue"),
        ("curl/8.5.0", "curl"),
        ("python-requests/2.32.0", "python-requests"),
        ("node-fetch/3.3.2", "node-fetch"),
        ("anthropic-sdk-python/0.39.0", "anthropic"),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            "custom",
        ),
        (None, "unknown"),
        ("", "unknown"),
    ]
    for user_agent, expected in cases:
        assert detect_client(user_agent) == expected, user_agent


# --- access control ----------------------------------------------------------


def test_platform_requires_platform_admin(client: TestClient, user_factory) -> None:
    client.cookies.clear()
    assert client.get("/api/analytics/platform").status_code == 401

    user_factory("analytics-gate-user@tollma.ai")
    r = client.get("/api/analytics/platform", params=WINDOW)
    assert r.status_code == 403


def test_admin_api_keys_requires_platform_admin(client: TestClient, user_factory) -> None:
    client.cookies.clear()
    assert client.get("/api/admin/api-keys").status_code == 401
    user_factory("analytics-admin-gate-user@tollma.ai")
    assert client.get("/api/admin/api-keys").status_code == 403


# --- empty windows -----------------------------------------------------------


def test_platform_empty_window_zeros(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("analytics-platform-empty@tollma.ai")
    _promote(db, user["id"])

    r = client.get("/api/analytics/platform", params=WINDOW)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == PLATFORM_KEYS
    assert body["requests"] == {
        "total": 0,
        "success": 0,
        "failed": 0,
        "cancelled": 0,
        "success_rate": 0.0,
        "error_rate": 0.0,
        "timeout": 0,
        "retry": 0,
    }
    assert all(value is None for value in body["performance"].values())
    assert Decimal(str(body["cost"]["total"])) == 0
    assert Decimal(str(body["cost"]["cost_per_token"])) == 0
    assert body["cost"]["most_expensive_request"] is None
    assert body["tokens"]["total"] == 0 and body["tokens"]["per_request"] == 0.0
    assert body["providers"] == [] and body["models"] == [] and body["endpoints"] == []
    # signup auto-provisions one "Primary key", so the empty window still inventories it
    assert body["keys"] == {"total": 1, "active": 1, "disabled": 0, "expired": 0, "rotated": 0}
    assert body["top_keys"] == []
    assert len(body["key_growth"]) == 1 and body["key_growth"][0]["created"] == 1
    assert body["insights"] == []


def test_empty_key_endpoints_zero(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("analytics-empty-key@tollma.ai")
    key = _make_key(db, uuid.UUID(user["id"]))

    detail = client.get(f"/api/analytics/api-keys/{key.id}", params=WINDOW)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert set(body) == DETAIL_KEYS
    assert body["requests"]["total"] == 0 and body["performance"]["avg_latency_ms"] is None
    savings = body["cache_savings"]
    assert savings["tokens_saved"] == 0 and savings["by_provider"] == []
    assert Decimal(str(savings["money_saved"])) == 0

    series = client.get(f"/api/analytics/api-keys/{key.id}/timeseries", params=WINDOW).json()
    assert set(series) == {"range", "points", "stacked", "dual", "latency"}
    assert series["points"] == [] and series["stacked"] == []

    network = client.get(f"/api/analytics/api-keys/{key.id}/network", params=WINDOW).json()
    assert set(network) == {
        "range",
        "unique_ips",
        "blocked_ips",
        "allowed_ips",
        "new_ips",
        "ips",
        "locations",
        "devices",
        "clients",
    }
    assert network["unique_ips"] == 0 and network["clients"] == []

    insights = client.get(f"/api/analytics/api-keys/{key.id}/insights", params=WINDOW).json()
    assert set(insights) == {"range", "insights"} and insights["insights"] == []


# --- seeded aggregates -------------------------------------------------------


def test_api_key_detail_aggregates_and_cache_savings(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("analytics-detail@tollma.ai")
    uid = uuid.UUID(user["id"])
    key = _make_key(db, uid, "Primary")
    _priced_model(db, uid)
    window = _window()
    now = datetime.now(timezone.utc)

    _seed_log(db, key, now - timedelta(hours=1), cost="0.02", tokens=100, latency=100.0, cache_read=1000)
    _seed_log(
        db, key, now - timedelta(hours=2), cost="0.01", tokens=50, latency=200.0, status="failed"
    )
    _seed_log(
        db,
        key,
        now - timedelta(days=3),
        cost="0.03",
        tokens=300,
        latency=300.0,
        model="claude-test",
        provider="anthropic",
    )
    assert window.start < now - timedelta(days=3)

    r = client.get(f"/api/analytics/api-keys/{key.id}", params=WINDOW)
    assert r.status_code == 200, r.text
    body = r.json()

    requests = body["requests"]
    assert requests["total"] == 3
    assert requests["success"] == 2 and requests["failed"] == 1 and requests["cancelled"] == 0
    assert requests["success_rate"] == pytest.approx(round(2 / 3, 4))
    assert requests["error_rate"] == pytest.approx(round(1 / 3, 4))
    assert requests["timeout"] == 0 and requests["retry"] == 0

    performance = body["performance"]
    assert performance["avg_latency_ms"] == pytest.approx(200.0)
    assert performance["p50_ms"] == pytest.approx(200.0)
    assert performance["p95_ms"] == pytest.approx(290.0)
    assert performance["slowest_ms"] == pytest.approx(300.0)
    assert performance["fastest_ms"] == pytest.approx(100.0)

    cost = body["cost"]
    assert Decimal(str(cost["total"])) == Decimal("0.06")
    assert Decimal(str(cost["cost_per_request"])) == Decimal("0.02")
    assert Decimal(str(cost["most_expensive_request"]["cost"])) == Decimal("0.03")
    assert cost["most_expensive_request"]["model"] == "claude-test"

    tokens = body["tokens"]
    assert tokens["total"] == 450 and tokens["per_request"] == pytest.approx(150.0)
    assert tokens["prompt"] == 225 and tokens["completion"] == 225

    savings = body["cache_savings"]
    assert savings["tokens_saved"] == 1000
    # 1000 reads x (10 - 2) per 1M tokens = 0.008
    assert Decimal(str(savings["money_saved"])) == Decimal("0.008")
    assert {row["provider"] for row in savings["by_provider"]} == {"openai"}

    assert body["key"]["key_prefix"] == key.key_prefix and body["key"]["enabled"] is True
    assert body["endpoints"][0]["requests"] == 3
    assert body["endpoints"][0]["share"] == 1.0
    assert body["models"][0]["model"] == "gpt-test"
    assert {row["provider"] for row in body["providers"]} == {"openai", "anthropic"}


def test_api_keys_list_scopes_to_owner(client: TestClient, db: Session, user_factory) -> None:
    other = user_factory("analytics-list-other@tollma.ai")
    owner = user_factory("analytics-list-owner@tollma.ai")  # last signup stays authenticated
    used_key = _make_key(db, uuid.UUID(owner["id"]), "Used")
    idle_key = _make_key(db, uuid.UUID(owner["id"]), "Idle")
    foreign_key = _make_key(db, uuid.UUID(other["id"]), "Foreign")
    now = datetime.now(timezone.utc)
    _seed_log(db, used_key, now - timedelta(hours=1), cost="0.05", tokens=200)
    _seed_log(db, used_key, now - timedelta(hours=2), cost="0.01", tokens=50, status="failed")
    _seed_log(db, foreign_key, now - timedelta(hours=1), cost="9.99", tokens=999)

    r = client.get("/api/analytics/api-keys", params=WINDOW)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"range", "keys"}
    rows = {row["key_id"]: row for row in body["keys"]}
    # signup auto-provisions one "Primary key" for the owner alongside Used/Idle
    primaries = [row for row in body["keys"] if row["name"] == "Primary key"]
    assert len(primaries) == 1 and primaries[0]["requests"] == 0
    assert set(rows) == {str(used_key.id), str(idle_key.id), primaries[0]["key_id"]}
    assert str(foreign_key.id) not in rows and other["id"] != owner["id"]

    used = rows[str(used_key.id)]
    assert used["requests"] == 2
    assert Decimal(str(used["spend"])) == Decimal("0.06")
    assert used["tokens"] == 250
    assert used["error_rate"] == pytest.approx(0.5)

    idle = rows[str(idle_key.id)]
    assert idle["requests"] == 0 and Decimal(str(idle["spend"])) == 0


def test_api_key_scoping_returns_404(client: TestClient, db: Session, user_factory) -> None:
    owner = user_factory("analytics-scope-owner@tollma.ai")
    other = user_factory("analytics-scope-other@tollma.ai")
    key = _make_key(db, uuid.UUID(owner["id"]))

    for path in (
        f"/api/analytics/api-keys/{key.id}",
        f"/api/analytics/api-keys/{key.id}/timeseries",
        f"/api/analytics/api-keys/{key.id}/network",
        f"/api/analytics/api-keys/{key.id}/insights",
    ):
        assert client.get(path, params=WINDOW).status_code == 404, path

    missing = client.get(f"/api/analytics/api-keys/{uuid.uuid4()}", params=WINDOW)
    assert missing.status_code == 404


# --- insights ----------------------------------------------------------------


def test_insights_cost_driver_cache_and_trend(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("analytics-insights@tollma.ai")
    uid = uuid.UUID(user["id"])
    key = _make_key(db, uid)
    _priced_model(db, uid)
    window = _window()
    now = datetime.now(timezone.utc)

    _seed_log(db, key, now - timedelta(hours=1), cost="0.02", tokens=100, latency=100.0, cache_read=1000)
    _seed_log(db, key, now - timedelta(hours=2), cost="0.01", tokens=50, latency=200.0, status="failed")
    _seed_log(db, key, now - timedelta(hours=3), cost="0.03", tokens=300, latency=300.0)
    # Previous window: one cheap, fast request so deltas are computable.
    _seed_log(db, key, window.prev_end - timedelta(hours=1), cost="0.01", tokens=100, latency=50.0)

    r = client.get(f"/api/analytics/api-keys/{key.id}/insights", params=WINDOW)
    assert r.status_code == 200, r.text
    rows = {row["id"]: row for row in r.json()["insights"]}

    driver = rows["cost_driver"]
    assert driver["share_pct"] == 100.0
    assert "100.0% of spend came from gpt-test" in driver["detail"]
    assert driver["metric"] == "spend"

    traffic = rows["traffic_driver"]
    assert traffic["share_pct"] == 100.0 and "generated 100.0% of requests" in traffic["detail"]

    assert "token_efficiency" in rows
    cached = rows["cache_savings"]
    assert "1,000 tokens" in cached["detail"] and "0.008" in cached["detail"]

    trend = rows["trend_requests"]
    assert trend["delta_pct"] == 200.0 and trend["metric"] == "requests"
    assert rows["trend_spend"]["delta_pct"] == 500.0


# --- timeseries --------------------------------------------------------------


def test_timeseries_buckets_and_stacked_grouping(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("analytics-series@tollma.ai")
    uid = uuid.UUID(user["id"])
    key = _make_key(db, uid)
    now = datetime.now(timezone.utc)

    _seed_log(db, key, now - timedelta(hours=1), tokens=100, cost="0.01", model="gpt-test")
    _seed_log(db, key, now - timedelta(hours=2), tokens=50, cost="0.02", model="claude-test")
    _seed_log(db, key, now - timedelta(hours=25), tokens=300, cost="0.03", model="gpt-test")

    r = client.get(
        f"/api/analytics/api-keys/{key.id}/timeseries",
        params={**WINDOW, "group_by": "model"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"range", "points", "stacked", "dual", "latency"}
    assert len(body["points"]) == 2  # today and yesterday
    assert sum(point["requests"] for point in body["points"]) == 3
    assert sum(point["tokens"] for point in body["points"]) == 450
    assert len(body["dual"]) == 2 and len(body["latency"]) == 2
    assert body["dual"][0]["tokens"] == body["points"][0]["tokens"]
    assert body["latency"][0]["avg_latency_ms"] is not None
    assert body["latency"][0]["p95_ms"] is not None

    stacked = {row["bucket"]: row for row in body["stacked"]}
    assert len(stacked) == 2
    today = max(stacked)
    assert stacked[today]["gpt-test"] == 100 and stacked[today]["claude-test"] == 50
    older = min(stacked)
    assert stacked[older]["gpt-test"] == 300

    by_provider = client.get(
        f"/api/analytics/api-keys/{key.id}/timeseries",
        params={**WINDOW, "group_by": "provider"},
    )
    assert by_provider.status_code == 200, by_provider.text
    provider_keys = {key for row in by_provider.json()["stacked"] for key in row if key != "bucket"}
    assert provider_keys == {"openai"}


# --- network -----------------------------------------------------------------


def test_network_ips_rules_devices_and_clients(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("analytics-network@tollma.ai")
    uid = uuid.UUID(user["id"])
    key = _make_key(db, uid)
    db.add(ApiKeyIpRule(api_key_id=key.id, type=IpRuleType.DENY, cidr="10.0.0.0/8"))
    db.commit()
    now = datetime.now(timezone.utc)

    _seed_log(
        db,
        key,
        now - timedelta(hours=1),
        ip="8.8.8.8",
        user_agent="OpenAI/Python 1.30.0",
        device_type="desktop",
        browser="SDK",
        country="US",
        city="San Francisco",
        region="CA",
    )
    _seed_log(
        db,
        key,
        now - timedelta(hours=2),
        ip="10.1.2.3",
        user_agent="curl/8.5.0",
        device_type="desktop",
        browser="curl",
        country="local",
    )
    _seed_log(
        db,
        key,
        now - timedelta(hours=3),
        ip="8.8.8.8",
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        device_type="desktop",
        platform="Windows",
        browser="Chrome",
        country="US",
        city="San Francisco",
        region="CA",
    )

    r = client.get(f"/api/analytics/api-keys/{key.id}/network", params=WINDOW)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["unique_ips"] == 2
    assert body["blocked_ips"] == 1 and body["allowed_ips"] == 1
    assert body["new_ips"] == 2
    ips = {row["ip"]: row for row in body["ips"]}
    assert ips["8.8.8.8"]["requests"] == 2 and ips["8.8.8.8"]["blocked"] is False
    assert ips["10.1.2.3"]["blocked"] is True

    clients = {row["client"]: row for row in body["clients"]}
    assert clients["openai-python"]["requests"] == 1
    assert clients["curl"]["requests"] == 1
    assert clients["custom"]["requests"] == 1

    locations = {(row["country"], row["city"]): row["requests"] for row in body["locations"]}
    assert locations[("US", "San Francisco")] == 2
    assert locations[("local", None)] == 1
    assert any(row["user_agent"] == "curl/8.5.0" for row in body["devices"])


# --- platform payload --------------------------------------------------------


def test_platform_payload_values(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("analytics-platform@tollma.ai")
    uid = uuid.UUID(user["id"])
    _promote(db, user["id"])
    key = _make_key(db, uid, "Platform key")
    _priced_model(db, uid)
    now = datetime.now(timezone.utc)
    _seed_log(db, key, now - timedelta(hours=1), cost="0.02", tokens=100, latency=100.0, cache_read=1000)
    _seed_log(db, key, now - timedelta(hours=2), cost="0.01", tokens=50, latency=200.0, status="failed")

    r = client.get("/api/analytics/platform", params=WINDOW)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == PLATFORM_KEYS
    assert body["requests"]["total"] == 2 and body["requests"]["failed"] == 1
    assert Decimal(str(body["cost"]["total"])) == Decimal("0.03")
    assert body["tokens"]["total"] == 150
    # +1 signup "Primary key" alongside the seeded "Platform key"
    assert body["keys"]["total"] == 2 and body["keys"]["active"] == 2
    assert body["top_keys"][0]["requests"] == 2
    assert Decimal(str(body["key_spend"][0]["share"])) == 1.0
    assert Decimal(str(body["key_cache_savings"][0]["savings"])) == Decimal("0.008")
    assert body["key_growth"] and body["key_growth"][0]["created"] == 2
    assert body["models"][0]["model"] == "gpt-test"
    assert body["providers"][0]["provider"] == "openai"
    assert body["endpoints"][0]["endpoint"] == "/v1/chat/completions"
    assert {row["id"] for row in body["insights"]} >= {"cost_driver", "cache_savings"}


def test_custom_range_and_unknown_preset(client: TestClient, user_factory) -> None:
    user_factory("analytics-range@tollma.ai")

    missing = client.get("/api/analytics/api-keys", params={"preset": "custom"})
    assert missing.status_code == 422

    inverted = client.get(
        "/api/analytics/api-keys",
        params={"preset": "custom", "start": "2026-01-10", "end": "2026-01-01"},
    )
    assert inverted.status_code == 422

    custom = client.get(
        "/api/analytics/api-keys",
        params={"preset": "custom", "start": "2026-01-01", "end": "2026-01-03"},
    )
    assert custom.status_code == 200
    assert custom.json()["range"]["preset"] == "custom"

    fallback = client.get("/api/analytics/api-keys", params={"preset": "banana"})
    assert fallback.status_code == 200
    assert fallback.json()["range"]["preset"] == "7d"


# --- caching -----------------------------------------------------------------


def test_response_cached_in_valkey(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("analytics-cache@tollma.ai")
    uid = uuid.UUID(user["id"])
    key = _make_key(db, uid)
    now = datetime.now(timezone.utc)
    _seed_log(db, key, now - timedelta(hours=1))

    first = client.get(f"/api/analytics/api-keys/{key.id}", params=WINDOW).json()
    assert first["requests"]["total"] == 1

    _seed_log(db, key, now - timedelta(hours=2))
    second = client.get(f"/api/analytics/api-keys/{key.id}", params=WINDOW).json()
    assert second["requests"]["total"] == 1, "response should be served from the 60s cache"


# --- admin surface -----------------------------------------------------------


def test_admin_api_keys_payload_and_dashboard_section(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("analytics-admin@tollma.ai")
    uid = uuid.UUID(user["id"])
    _promote(db, user["id"])
    past = datetime.now(timezone.utc) - timedelta(days=1)
    active = _make_key(db, uid, "Active")
    _make_key(db, uid, "Disabled", enabled=False)
    _make_key(db, uid, "Expired", expires_at=past)
    _make_key(db, uid, "Rotated", rotation_count=1)
    _priced_model(db, uid)
    now = datetime.now(timezone.utc)
    _seed_log(db, active, now - timedelta(hours=1), cost="0.02", tokens=100, cache_read=1000)
    _seed_log(db, active, now - timedelta(hours=2), cost="0.01", tokens=50, status="failed")

    r = client.get("/api/admin/api-keys", params={"preset": "last_7d"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == ADMIN_KEY_KEYS
    # +1 signup "Primary key" alongside the four seeded keys
    assert body["total"] == 5
    assert body["active"] == 4
    assert body["disabled"] == 1
    assert body["expired"] == 1
    assert body["rotated"] == 1
    assert body["top_keys"][0]["key_id"] == str(active.id)
    assert body["top_keys"][0]["requests"] == 2
    assert Decimal(str(body["spend_by_key"][0]["spend"])) == Decimal("0.03")
    assert body["errors_by_key"][0]["errors"] == 1
    assert Decimal(str(body["cache_savings_by_key"][0]["savings"])) == Decimal("0.008")
    assert body["growth"] and body["growth"][0]["created"] == 5

    dashboard = client.get("/api/admin/dashboard", params={"preset": "last_7d"})
    assert dashboard.status_code == 200, dashboard.text
    section = dashboard.json()["api_keys"]
    assert set(section) == ADMIN_KEY_KEYS
    assert section["total"] == 5 and section["top_keys"][0]["key_id"] == str(active.id)
