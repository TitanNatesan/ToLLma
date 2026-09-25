"""Targeted tests for the public-gateway request log + per-key analytics.

Covers the UA parsing table, private-IP geo labelling, row persistence with
derived metadata, never-raise logging on a broken session, and grouped
aggregations over seeded `api_request_logs` rows.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError
from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.user import User
from tollms.services.gateway.api_logs import (
    ApiLogEntry,
    key_analytics,
    log_request,
    parse_client_meta,
)

_IPHONE_SAFARI = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
_ANDROID_CHROME = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36"
)
_IPAD_SAFARI = (
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
_WINDOWS_EDGE = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
)
_MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/127.0"
_LINUX_CHROME = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

UA_CASES = [
    (_IPHONE_SAFARI, "mobile", "iOS", "Safari"),
    (_ANDROID_CHROME, "mobile", "Android", "Chrome"),
    (_IPAD_SAFARI, "tablet", "iOS", "Safari"),
    (_WINDOWS_EDGE, "desktop", "Windows", "Edge"),
    (_MAC_FIREFOX, "desktop", "macOS", "Firefox"),
    (_LINUX_CHROME, "desktop", "Linux", "Chrome"),
    ("curl/8.5.0", "desktop", None, "curl"),
    ("python-httpx/0.27.0", "desktop", None, "SDK"),
    ("OpenAI/Python 1.30.0", "desktop", None, "SDK"),
    (None, None, None, None),
]


@pytest.mark.parametrize("ua,device,platform,browser", UA_CASES)
def test_parse_client_meta_ua_table(
    ua: str | None, device: str | None, platform: str | None, browser: str | None, monkeypatch
) -> None:
    monkeypatch.delenv("GEOIP_DB_PATH", raising=False)
    meta = parse_client_meta(ua, "8.8.8.8")
    assert meta["device_type"] == device
    assert meta["platform"] == platform
    assert meta["browser"] == browser
    assert meta["country"] is None  # no geo database configured: never fabricated


@pytest.mark.parametrize("ip", ["127.0.0.1", "::1", "10.1.2.3", "172.16.0.4", "192.168.1.9", "169.254.10.1"])
def test_private_and_loopback_ips_are_local(ip: str) -> None:
    meta = parse_client_meta("curl/8.5.0", ip)
    assert meta["country"] == "local"
    assert meta["city"] is None and meta["region"] is None


def test_invalid_ip_leaves_geo_null() -> None:
    meta = parse_client_meta("curl/8.5.0", "not-an-ip")
    assert meta["country"] is None and meta["city"] is None and meta["region"] is None


# --- request logging ---------------------------------------------------------


def _make_user(db: Session, email: str) -> User:
    user = User(email=email, email_verified=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_log_request_writes_row_with_client_metadata(db: Session) -> None:
    user = _make_user(db, "api-logs@tollma.ai")
    uid = user.id
    entry = ApiLogEntry(
        request_id="req-log-1",
        api_key_id=None,
        user_id=uid,
        provider="openai",
        model="gpt-4o",
        endpoint="/v1/chat/completions",
        status="failed",
        error_code="RATE_LIMITED",
        latency_ms=123.5,
        cost=Decimal("0.0123"),
        input_tokens=10,
        output_tokens=20,
        ip_address="10.0.0.5",
        user_agent="curl/8.5.0",
        is_streaming=True,
    )
    log_request(db, entry)
    db.commit()

    row = db.execute(select(ApiRequestLog).where(ApiRequestLog.request_id == "req-log-1")).scalar_one()
    assert row.user_id == uid
    assert row.provider == "openai" and row.model == "gpt-4o"
    assert row.status == "failed" and row.error_code == "RATE_LIMITED"
    assert row.total_tokens == 30  # derived from input + output
    assert row.device_type == "desktop"
    assert row.browser == "curl"
    assert row.country == "local" and row.city is None and row.region is None
    assert row.is_streaming is True


class _BrokenSession:
    def begin_nested(self):
        raise RuntimeError("connection lost")


class _BrokenSavepoint:
    def commit(self) -> None:
        raise RuntimeError("flush failed")

    def rollback(self) -> None:
        pass


class _FlushBrokenSession:
    def begin_nested(self):
        return _BrokenSavepoint()

    def add(self, row) -> None:
        pass

    def flush(self) -> None:
        raise RuntimeError("flush failed")


def test_log_request_never_raises_on_broken_session() -> None:
    entry = ApiLogEntry(
        request_id="req-broken",
        api_key_id=None,
        user_id=None,
        provider=None,
        model=None,
        endpoint="/v1/models",
    )
    for broken in (_BrokenSession(), _FlushBrokenSession()):
        assert log_request(broken, entry) is None


def test_log_request_fk_failure_is_isolated(db: Session) -> None:
    entry = ApiLogEntry(
        request_id="req-fk",
        api_key_id=None,
        user_id=uuid.uuid4(),  # no such user: insert must fail inside the savepoint
        provider=None,
        model=None,
        endpoint="/v1/models",
    )
    assert log_request(db, entry) is None
    # The session stays usable and no partial row is left behind.
    assert (
        db.execute(select(ApiRequestLog).where(ApiRequestLog.request_id == "req-fk")).scalar_one_or_none()
        is None
    )
    assert db.execute(select(User.id).limit(1)).scalar_one_or_none() is None


# --- per-key analytics -------------------------------------------------------


def _make_key(db: Session, user_id: uuid.UUID) -> ApiKey:
    key = ApiKey(
        user_id=user_id,
        name="Analytics key",
        key_prefix=f"tma_sk_live_{uuid.uuid4().hex[:8]}",
        key_hash=uuid.uuid4().hex + uuid.uuid4().hex,
        enabled=True,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


def _seed_log(
    db: Session,
    *,
    key_id: uuid.UUID,
    user_id: uuid.UUID,
    when: datetime,
    cost: str,
    tokens: int,
    latency: float,
    status: str = "success",
    model: str = "gpt-4o",
    endpoint: str = "/v1/chat/completions",
    country: str = "US",
) -> None:
    db.add(
        ApiRequestLog(
            request_id=f"req-{uuid.uuid4().hex[:12]}",
            api_key_id=key_id,
            user_id=user_id,
            provider="openai",
            model=model,
            endpoint=endpoint,
            status=status,
            latency_ms=latency,
            cost=Decimal(cost),
            input_tokens=tokens // 2,
            output_tokens=tokens - tokens // 2,
            total_tokens=tokens,
            country=country,
            created_at=when,
        )
    )


def test_key_analytics_totals_series_and_rankings(db: Session) -> None:
    user = _make_user(db, "key-analytics@tollma.ai")
    uid = user.id
    api_key = _make_key(db, uid)

    now = datetime.now(timezone.utc)
    t1, t2, t3 = now - timedelta(hours=1), now - timedelta(hours=2), now - timedelta(days=3)
    _seed_log(db, key_id=api_key.id, user_id=uid, when=t1, cost="0.02", tokens=100, latency=100.0)
    _seed_log(
        db, key_id=api_key.id, user_id=uid, when=t2, cost="0.01", tokens=50, latency=200.0, status="failed"
    )
    _seed_log(
        db,
        key_id=api_key.id,
        user_id=uid,
        when=t3,
        cost="0.03",
        tokens=300,
        latency=300.0,
        model="claude-3-5-sonnet",
        country="DE",
    )
    db.commit()

    data = key_analytics(db, api_key.id, uid, "last_7d")
    totals = data["totals"]
    assert totals["requests"] == 3
    assert totals["tokens"] == 450
    assert Decimal(totals["cost"]) == Decimal("0.06")
    assert totals["failed"] == 1
    assert totals["cancelled"] == 0
    assert totals["error_rate"] == pytest.approx(round(1 / 3, 4))
    assert totals["avg_latency_ms"] == pytest.approx(200.0)
    assert totals["p95_latency_ms"] == pytest.approx(290.0)

    series = data["series"]
    assert {point["date"] for point in series} == {
        t1.date().isoformat(),
        t2.date().isoformat(),
        t3.date().isoformat(),
    }
    assert sum(point["requests"] for point in series) == 3
    assert sum(Decimal(point["cost"]) for point in series) == Decimal("0.06")

    assert data["top_models"][0]["model"] == "gpt-4o"
    assert data["top_models"][0]["requests"] == 2
    assert data["top_endpoints"][0]["endpoint"] == "/v1/chat/completions"
    assert data["top_endpoints"][0]["requests"] == 3
    assert data["top_endpoints"][0]["errors"] == 1
    assert {row["country"]: row["requests"] for row in data["top_countries"]} == {"US": 2, "DE": 1}


def test_key_analytics_requires_ownership_and_live_key(db: Session) -> None:
    user = _make_user(db, "key-owner@tollma.ai")
    uid = user.id
    api_key = _make_key(db, uid)

    with pytest.raises(NotFoundError):
        key_analytics(db, api_key.id, uuid.uuid4(), "today")

    api_key.is_deleted = True
    db.commit()
    with pytest.raises(NotFoundError):
        key_analytics(db, api_key.id, uid, "today")


def test_key_analytics_empty_and_unknown_preset(db: Session) -> None:
    user = _make_user(db, "key-empty@tollma.ai")
    uid = user.id
    api_key = _make_key(db, uid)

    data = key_analytics(db, api_key.id, uid, "nonsense", timezone="Mars/Olympus")
    assert data["range"]["preset"] == "this_month"
    assert data["totals"]["requests"] == 0
    assert Decimal(data["totals"]["cost"]) == 0
    assert data["totals"]["avg_latency_ms"] is None
    assert data["totals"]["p95_latency_ms"] is None
    assert data["series"] == []
    assert data["top_models"] == [] and data["top_endpoints"] == [] and data["top_countries"] == []
