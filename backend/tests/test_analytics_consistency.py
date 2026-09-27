"""Phase 12 analytics-consistency contract (test-only).

Landed contract under test:

* ``services/analytics/presets.py`` is the canonical preset vocabulary with
  gateway / chat / keys / gateway_keys families (legacy aliases accepted,
  per-surface defaults and the keys-surface 422 preserved).
* ``projected_run_rate()`` is the single forecast helper with a
  ``run_rate_projection`` alias — except ``GET /api/admin/costs``, whose exact
  shape has no alias key.
* ``GET /api/analytics/platform/export`` (platform admin) and
  ``GET /api/analytics/api-keys/{id}/export`` (owner) accept dataset/format.
* Keys analytics (``/api/v1/keys``) is cached 60s in Valkey.
* Admin docstrings record each surface's fact-table source.

Zero breaking changes: every assertion below pins the landed behavior.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.user import PlatformRole, User
from tollms.services.analytics import presets as preset_vocab
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache.manager import call_sync, get_manager


# --- helpers -----------------------------------------------------------------


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _login(client: TestClient, email: str, password: str = "Password123") -> None:
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text


def _make_key(db: Session, user_id: uuid.UUID, name: str = "Key") -> ApiKey:
    key = ApiKey(
        user_id=user_id,
        name=name,
        key_prefix=f"tma_sk_live_{uuid.uuid4().hex[:8]}",
        key_hash=uuid.uuid4().hex + uuid.uuid4().hex,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


def _seed_log(
    db: Session,
    key: ApiKey,
    when: datetime,
    *,
    cost: str = "0.02",
    tokens: int = 200,
    model: str = "consistency-model",
) -> ApiRequestLog:
    row = ApiRequestLog(
        request_id=f"req-{uuid.uuid4().hex[:12]}",
        api_key_id=key.id,
        user_id=key.user_id,
        provider="openai",
        model=model,
        endpoint="/v1/chat/completions",
        status="success",
        latency_ms=120.0,
        cost=Decimal(cost),
        input_tokens=tokens // 2,
        output_tokens=tokens - tokens // 2,
        total_tokens=tokens,
        created_at=when,
    )
    db.add(row)
    db.commit()
    return row


def _valkey_keys(pattern: str) -> list[str]:
    async def _scan() -> list[str]:
        client = await get_manager().resolved_client()
        if client is None:
            return []
        found: list[str] = []
        async for key in client.scan_iter(match=pattern, count=200):
            found.append(key.decode() if isinstance(key, bytes) else str(key))
        return found

    return call_sync(_scan(), default=[])


# --- alias normalization: unit matrix ----------------------------------------


def test_preset_normalize_matrix() -> None:
    # Equivalent trailing-day tokens map to each family's native preset.
    assert preset_vocab.normalize("7d", family="gateway") == "7d"
    assert preset_vocab.normalize("last_7d", family="gateway") == "7d"
    assert preset_vocab.normalize("last_30d", family="gateway") == "30d"
    assert preset_vocab.normalize("7d", family="chat") == "last_7d"
    assert preset_vocab.normalize("30d", family="chat") == "last_30d"
    assert preset_vocab.normalize("7d", family="keys") == "last_7d"
    assert preset_vocab.normalize("30d", family="keys") == "last_30d"
    assert preset_vocab.normalize("7d", family="gateway_keys") == "last_7d"
    # Unknown tokens fall back to the surface default...
    assert preset_vocab.normalize("banana", family="gateway") == "7d"
    assert preset_vocab.normalize("banana", family="chat") == "this_month"
    assert preset_vocab.normalize("banana", family="gateway_keys") == "this_month"


def test_preset_normalize_keys_unknown_raises() -> None:
    from tollms.core.exceptions import ValidationError

    for bad in ("banana", "custom", "all_time"):
        try:
            preset_vocab.normalize(bad, family="keys")
        except ValidationError:
            continue
        raise AssertionError(f"keys family must reject {bad!r} (HTTP 422)")


# --- alias normalization: gateway surface (/api/analytics) --------------------


def test_gateway_alias_last_7d_matches_7d(client: TestClient, user_factory) -> None:
    user_factory("consistency-gateway-alias@tollma.ai")

    native = client.get("/api/analytics/api-keys", params={"preset": "7d"})
    alias = client.get("/api/analytics/api-keys", params={"preset": "last_7d"})
    assert native.status_code == 200, native.text
    assert alias.status_code == 200, alias.text
    assert native.json()["range"]["preset"] == "7d"
    assert alias.json()["range"]["preset"] == "7d"

    monthly = client.get("/api/analytics/api-keys", params={"preset": "last_30d"})
    assert monthly.status_code == 200, monthly.text
    assert monthly.json()["range"]["preset"] == "30d"


def test_gateway_unknown_preset_falls_back_to_default(client: TestClient, user_factory) -> None:
    user_factory("consistency-gateway-default@tollma.ai")

    r = client.get("/api/analytics/api-keys", params={"preset": "banana"})
    assert r.status_code == 200, r.text
    assert r.json()["range"]["preset"] == "7d"

    custom = client.get("/api/analytics/api-keys", params={"preset": "custom"})
    assert custom.status_code == 422


# --- alias normalization: chat surface (/api/v1/analytics) --------------------


def test_chat_alias_7d_matches_last_7d(client: TestClient, user_factory) -> None:
    user_factory("consistency-chat-alias@tollma.ai")

    native = client.get("/api/v1/analytics/summary", params={"range": "last_7d", "tz": "UTC"})
    alias = client.get("/api/v1/analytics/summary", params={"range": "7d", "tz": "UTC"})
    assert native.status_code == 200, native.text
    assert alias.status_code == 200, alias.text
    assert native.json()["range"]["preset"] == "last_7d"
    assert alias.json()["range"]["preset"] == "last_7d"


def test_chat_unknown_preset_falls_back_to_default(client: TestClient, user_factory) -> None:
    user_factory("consistency-chat-default@tollma.ai")

    r = client.get("/api/v1/analytics/summary", params={"range": "banana"})
    assert r.status_code == 200, r.text
    assert r.json()["range"]["preset"] == "this_month"


# --- alias normalization: keys surface (/api/v1/keys) -------------------------


def test_keys_alias_and_unknown_422(client: TestClient, user_factory) -> None:
    user_factory("consistency-keys-alias@tollma.ai")
    created = client.post("/api/v1/keys", json={"name": "Alias"})
    assert created.status_code == 201, created.text
    key_id = created.json()["key"]["id"]

    for preset, canonical in (("last_7d", "last_7d"), ("7d", "last_7d"), ("30d", "last_30d")):
        r = client.get(f"/api/v1/keys/{key_id}/analytics", params={"preset": preset})
        assert r.status_code == 200, (preset, r.text)
        assert r.json()["range"] == canonical, preset

    approx = client.get(f"/api/v1/keys/{key_id}/analytics", params={"preset": "24h"})
    assert approx.status_code == 200, approx.text
    assert approx.json()["range"] == "today"

    assert client.get(f"/api/v1/keys/{key_id}/analytics", params={"preset": "banana"}).status_code == 422
    assert client.get(f"/api/v1/keys/{key_id}/analytics", params={"preset": "custom"}).status_code == 422


# --- alias normalization: gateway_keys family (gateway api_logs engine) -------


def test_gateway_keys_engine_alias_and_default(client: TestClient, db: Session, user_factory) -> None:
    from tollms.services.gateway.api_logs import key_analytics

    user = user_factory("consistency-gateway-keys@tollma.ai")
    uid = uuid.UUID(user["id"])
    created = client.post("/api/v1/keys", json={"name": "Engine"})
    assert created.status_code == 201, created.text
    key_id = uuid.UUID(created.json()["key"]["id"])

    assert key_analytics(db, key_id, uid, "7d")["range"]["preset"] == "last_7d"
    assert key_analytics(db, key_id, uid, "last_7d")["range"]["preset"] == "last_7d"
    assert key_analytics(db, key_id, uid, "banana")["range"]["preset"] == "this_month"


# --- forecast alias equality --------------------------------------------------


def test_projected_run_rate_single_helper_unit() -> None:
    from tollms.services.analytics.costs import (
        cost_payload,
        projected_month_cost,
        projected_run_rate,
    )

    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    end = datetime(2026, 9, 8, tzinfo=timezone.utc)
    window = SimpleNamespace(start=start, end=end)
    total = Decimal("1.234567")

    assert projected_run_rate(total, start, end) == projected_month_cost(total, window)

    payload = cost_payload(
        total=total,
        trailing={"today": Decimal("0.1"), "last_7d": total, "last_30d": total},
        window=window,
        tokens_total=100,
        requests_total=4,
        expensive=None,
    )
    assert payload["run_rate_projection"] == payload["projected_month"]
    assert payload["run_rate_projection"] != Decimal(0)


def test_forecast_alias_equality_gateway_api(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("consistency-forecast-gateway@tollma.ai")
    key = _make_key(db, uuid.UUID(user["id"]))
    _seed_log(db, key, datetime.now(timezone.utc) - timedelta(hours=1))

    r = client.get(f"/api/analytics/api-keys/{key.id}", params={"preset": "7d"})
    assert r.status_code == 200, r.text
    cost = r.json()["cost"]
    assert Decimal(str(cost["run_rate_projection"])) == Decimal(str(cost["projected_month"]))
    assert Decimal(str(cost["total"])) == Decimal("0.02")


def test_forecast_alias_equality_chat_api(client: TestClient, user_factory) -> None:
    user_factory("consistency-forecast-chat@tollma.ai")

    r = client.get("/api/v1/analytics/summary", params={"range": "last_7d"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert str(body["run_rate_projection"]) == str(body["projected_month_spend"])


# --- platform export (admin) --------------------------------------------------


def test_platform_export_gating_and_formats(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("consistency-platform-export@tollma.ai")
    key = _make_key(db, uuid.UUID(user["id"]))
    _seed_log(db, key, datetime.now(timezone.utc) - timedelta(hours=1))

    forbidden = client.get(
        "/api/analytics/platform/export",
        params={"preset": "7d", "dataset": "summary", "format": "csv"},
    )
    assert forbidden.status_code == 403

    _promote(db, user["id"])

    csv_res = client.get(
        "/api/analytics/platform/export",
        params={"preset": "last_7d", "dataset": "summary", "format": "csv"},
    )
    assert csv_res.status_code == 200, csv_res.text
    assert "text/csv" in csv_res.headers["content-type"]
    assert "attachment" in csv_res.headers["content-disposition"]
    header = csv_res.text.splitlines()[0]
    assert "requests" in header and "spend" in header

    models_csv = client.get(
        "/api/analytics/platform/export",
        params={"preset": "7d", "dataset": "models", "format": "csv"},
    )
    assert models_csv.status_code == 200, models_csv.text
    assert "consistency-model" in models_csv.text

    json_res = client.get(
        "/api/analytics/platform/export",
        params={"preset": "7d", "dataset": "summary", "format": "json"},
    )
    assert json_res.status_code == 200, json_res.text
    assert "application/json" in json_res.headers["content-type"]
    payload = json_res.json()
    assert payload["dataset"] == "summary"
    assert payload["rows"][0]["requests"] == 1

    xlsx_res = client.get(
        "/api/analytics/platform/export",
        params={"preset": "7d", "dataset": "models", "format": "xlsx"},
    )
    assert xlsx_res.status_code == 200
    assert "spreadsheetml" in xlsx_res.headers["content-type"]
    assert xlsx_res.content[:2] == b"PK"

    bad_dataset = client.get(
        "/api/analytics/platform/export",
        params={"preset": "7d", "dataset": "nope", "format": "csv"},
    )
    assert bad_dataset.status_code == 422
    bad_format = client.get(
        "/api/analytics/platform/export",
        params={"preset": "7d", "dataset": "summary", "format": "parquet"},
    )
    assert bad_format.status_code == 422


# --- per-key export (owner scoping) -------------------------------------------


def test_api_key_export_owner_scoping_and_formats(
    client: TestClient, db: Session, user_factory
) -> None:
    owner = user_factory("consistency-export-owner@tollma.ai")
    other = user_factory("consistency-export-other@tollma.ai")  # authed as other
    own = _make_key(db, uuid.UUID(owner["id"]), "Own")
    foreign = _make_key(db, uuid.UUID(other["id"]), "Foreign")
    now = datetime.now(timezone.utc)
    _seed_log(db, own, now - timedelta(hours=1), cost="0.02", model="own-model")
    _seed_log(db, foreign, now - timedelta(hours=1), cost="9.99", model="foreign-model")

    cross = client.get(
        f"/api/analytics/api-keys/{own.id}/export",
        params={"preset": "7d", "dataset": "summary", "format": "csv"},
    )
    assert cross.status_code == 404

    _login(client, owner["email"])

    json_res = client.get(
        f"/api/analytics/api-keys/{own.id}/export",
        params={"preset": "7d", "dataset": "summary", "format": "json"},
    )
    assert json_res.status_code == 200, json_res.text
    payload = json_res.json()
    assert payload["dataset"] == "summary"
    assert payload["rows"][0]["requests"] == 1
    assert Decimal(str(payload["rows"][0]["spend"])) == Decimal("0.02")

    models_csv = client.get(
        f"/api/analytics/api-keys/{own.id}/export",
        params={"preset": "7d", "dataset": "models", "format": "csv"},
    )
    assert models_csv.status_code == 200, models_csv.text
    assert "text/csv" in models_csv.headers["content-type"]
    assert "own-model" in models_csv.text
    assert "foreign-model" not in models_csv.text

    xlsx_res = client.get(
        f"/api/analytics/api-keys/{own.id}/export",
        params={"preset": "7d", "dataset": "models", "format": "xlsx"},
    )
    assert xlsx_res.status_code == 200
    assert "spreadsheetml" in xlsx_res.headers["content-type"]
    assert xlsx_res.content[:2] == b"PK"

    missing = client.get(
        f"/api/analytics/api-keys/{uuid.uuid4()}/export",
        params={"preset": "7d", "dataset": "summary", "format": "csv"},
    )
    assert missing.status_code == 404

    bad = client.get(
        f"/api/analytics/api-keys/{own.id}/export",
        params={"preset": "7d", "dataset": "nope", "format": "csv"},
    )
    assert bad.status_code == 422


# --- keys analytics cache -----------------------------------------------------


def test_keys_analytics_cache_hit_and_valkey_key(client: TestClient, db: Session, user_factory) -> None:
    assert cache_ttl.ANALYTICS == 60

    user = user_factory("consistency-keys-cache@tollma.ai")
    created = client.post("/api/v1/keys", json={"name": "Cached"})
    assert created.status_code == 201, created.text
    key_id = created.json()["key"]["id"]
    key = db.get(ApiKey, uuid.UUID(key_id))
    assert key is not None
    _seed_log(db, key, datetime.now(timezone.utc) - timedelta(hours=1))

    first = client.get(f"/api/v1/keys/{key_id}/analytics", params={"preset": "last_7d"})
    assert first.status_code == 200, first.text
    assert first.json()["requests"] == 1

    pattern = f"tollma:analytics:{user['id']}:*"
    entries = _valkey_keys(pattern)
    assert entries, "expected a Valkey analytics entry after the first call"
    ttls = [call_sync(get_manager().ttl(entry), default=None) for entry in entries]
    assert any(ttl is not None and 0 < ttl <= 60 for ttl in ttls), ttls

    _seed_log(db, key, datetime.now(timezone.utc) - timedelta(hours=2))
    second = client.get(f"/api/v1/keys/{key_id}/analytics", params={"preset": "last_7d"})
    assert second.status_code == 200, second.text
    assert second.json() == first.json(), "second identical call must be served from the 60s cache"
    assert second.json()["requests"] == 1


# --- admin costs exact shape (no alias key) ------------------------------------


def test_admin_costs_exact_shape_no_alias(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("consistency-admin-costs@tollma.ai")
    assert client.get("/api/admin/costs", params={"preset": "last_7d"}).status_code == 403

    _promote(db, user["id"])
    r = client.get("/api/admin/costs", params={"preset": "last_7d"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {
        "range",
        "total_cost",
        "previous_cost",
        "change_pct",
        "projected_month_cost",
        "input_cost",
        "output_cost",
        "cache_cost",
        "reasoning_cost",
        "cache_savings",
        "estimated_share",
        "series",
        "by_model",
        "by_provider",
        "top_users",
    }
    assert "run_rate_projection" not in body
    assert "projected_month_cost" in body


# --- admin docstring source notes ----------------------------------------------


def test_admin_docstrings_record_fact_table_source() -> None:
    from tollms.api.admin import router as admin_router
    from tollms.services.admin import costs as admin_costs

    assert "assistant message" in (admin_costs.__doc__ or "")
    assert "api_request_logs" in (admin_router.api_keys.__doc__ or "")
