"""API-key management tests: raw-once contract, rotation, scoping, validation.

Targeted coverage per the API-key deliverable: create/list masking, stored
hash, rotation + cache invalidation, disable/delete revocation, CIDR and
policy bounds, ownership 404s and analytics aggregation.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tollms.models.api_key import ApiKey, ApiRequestLog
from tollms.models.user import User
from tollms.services.api_keys import keys as key_engine

# The keys router is wired into `tollms.main` by the orchestrator; until then
# this module mounts it for its own tests (guarded so a future main.py
# registration never double-registers).
from tollms.api.keys.router import router as keys_router  # noqa: E402
from tollms.main import app  # noqa: E402

_KEYS_PREFIX = "/api/v1/keys"
if not any(getattr(route, "path", "").startswith(_KEYS_PREFIX) for route in app.routes):
    app.include_router(keys_router)


def _create(client: TestClient, **overrides) -> dict:
    payload = {"name": "CI key", **overrides}
    response = client.post("/api/v1/keys", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_raw_once_and_list_never_exposes_it(
    client: TestClient, db, user_factory
) -> None:
    user_factory()
    created = _create(client, name="Primary", policy={"max_budget_usd": "5", "budget_reset_days": 30})
    raw = created["raw_key"]
    key = created["key"]

    assert raw.startswith("tma_sk_live_")
    assert key["key_prefix"] == raw[:20]
    assert key["masked"] == f"{raw[:16]}…"
    assert "key_hash" not in key
    assert raw not in json.dumps(key)

    _create(client, name="Secondary")
    listed = client.get("/api/v1/keys")
    assert listed.status_code == 200
    names = [item["name"] for item in listed.json()]
    assert "Primary key" in names  # auto-provisioned on signup
    assert [n for n in names if n != "Primary key"] == ["Secondary", "Primary"]
    assert raw not in listed.text
    assert "key_hash" not in listed.text

    detail = client.get(f"/api/v1/keys/{key['id']}")
    assert detail.status_code == 200
    assert raw not in detail.text
    assert Decimal(detail.json()["policy"]["max_budget_usd"]) == Decimal("5")

    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(key["id"])))
    assert stored is not None
    assert stored.key_hash == key_engine.hash_key(raw)
    assert stored.key_hash != raw


def test_rotate_replaces_hash_and_increments_count(client: TestClient, db, user_factory) -> None:
    user_factory()
    created = _create(client, name="Rotating")
    old_raw, old_prefix = created["raw_key"], created["key"]["key_prefix"]
    key_id = created["key"]["id"]
    assert key_engine.authenticate(db, old_raw) is not None  # warm the context cache

    rotated = client.post(f"/api/v1/keys/{key_id}/rotate")
    assert rotated.status_code == 200, rotated.text
    new_raw = rotated.json()["raw_key"]
    body = rotated.json()["key"]
    assert new_raw != old_raw
    assert body["key_prefix"] == new_raw[:20]
    assert body["key_prefix"] != old_prefix
    assert body["rotation_count"] == 1

    stored = db.scalar(select(ApiKey).where(ApiKey.id == uuid.UUID(key_id)))
    assert stored is not None and stored.key_hash == key_engine.hash_key(new_raw)
    assert key_engine.authenticate(db, old_raw) is None
    fresh = key_engine.authenticate(db, new_raw)
    assert fresh is not None and fresh.enabled is True


def test_disable_and_delete_block_authentication(client: TestClient, db, user_factory) -> None:
    user_factory()
    created = _create(client, name="Disable me")
    key_id, raw = created["key"]["id"], created["raw_key"]

    patched = client.patch(f"/api/v1/keys/{key_id}", json={"enabled": False})
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    context = key_engine.authenticate(db, raw)
    assert context is not None and context.enabled is False

    assert client.delete(f"/api/v1/keys/{key_id}").status_code == 204
    assert client.get(f"/api/v1/keys/{key_id}").status_code == 404
    remaining = client.get("/api/v1/keys").json()
    assert [k["name"] for k in remaining] == ["Primary key"]  # signup primary survives
    assert remaining[0]["is_primary"] is True
    assert key_engine.authenticate(db, raw) is None


def test_cidr_validation_and_normalization(client: TestClient, user_factory) -> None:
    user_factory()
    bad = client.post(
        "/api/v1/keys", json={"name": "Bad", "ip_rules": [{"type": "allow", "cidr": "not-an-ip"}]}
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "VALIDATION_ERROR"

    created = _create(
        client,
        name="Rules",
        ip_rules=[
            {"type": "allow", "cidr": "203.0.113.7"},
            {"type": "deny", "cidr": "10.0.0.5/24"},
        ],
    )
    by_type = {rule["type"]: rule["cidr"] for rule in created["key"]["ip_rules"]}
    assert by_type == {"allow": "203.0.113.7/32", "deny": "10.0.0.0/24"}

    key_id = created["key"]["id"]
    replaced = client.put(f"/api/v1/keys/{key_id}/ip-rules", json=[{"type": "allow", "cidr": "2001:db8::1"}])
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["ip_rules"][0]["cidr"] == "2001:db8::1/128"

    duplicate = client.put(
        f"/api/v1/keys/{key_id}/ip-rules",
        json=[{"type": "allow", "cidr": "1.2.3.4"}, {"type": "allow", "cidr": "1.2.3.4/32"}],
    )
    assert duplicate.status_code == 422

    garbage = client.put(f"/api/v1/keys/{key_id}/ip-rules", json=[{"type": "deny", "cidr": "999.1.1.1"}])
    assert garbage.status_code == 422
    # The failed replace must not have wiped the existing rule.
    assert client.get(f"/api/v1/keys/{key_id}").json()["ip_rules"][0]["cidr"] == "2001:db8::1/128"


def test_policy_upsert_and_bounds(client: TestClient, user_factory) -> None:
    user_factory()
    created = _create(client, name="Policy")
    key_id = created["key"]["id"]
    assert created["key"]["policy"] is None

    ok = client.put(
        f"/api/v1/keys/{key_id}/policy",
        json={"rpm": 60, "budget_reset_days": 30, "max_budget_usd": "10", "daily_spend_limit": "5"},
    )
    assert ok.status_code == 200, ok.text
    policy = ok.json()["policy"]
    assert policy["rpm"] == 60
    assert policy["budget_reset_days"] == 30
    assert Decimal(policy["max_budget_usd"]) == Decimal("10")
    assert policy["monthly_spend_limit"] is None

    for payload in (
        {"budget_reset_days": 0},
        {"budget_reset_days": 366},
        {"rpm": -1},
        {"max_budget_usd": "-1"},
    ):
        response = client.put(f"/api/v1/keys/{key_id}/policy", json=payload)
        assert response.status_code == 422, payload


def test_other_users_keys_are_404(client: TestClient, user_factory) -> None:
    user_factory("owner@tollma.ai")
    created = _create(client, name="Mine")
    key_id = created["key"]["id"]

    user_factory("intruder@tollma.ai")
    calls = (
        ("get", f"/api/v1/keys/{key_id}", None),
        ("patch", f"/api/v1/keys/{key_id}", {"name": "Stolen"}),
        ("delete", f"/api/v1/keys/{key_id}", None),
        ("post", f"/api/v1/keys/{key_id}/rotate", None),
        ("put", f"/api/v1/keys/{key_id}/policy", {}),
        ("put", f"/api/v1/keys/{key_id}/ip-rules", []),
        ("put", f"/api/v1/keys/{key_id}/model-permissions", []),
        ("get", f"/api/v1/keys/{key_id}/analytics", None),
    )
    for method, path, payload in calls:
        response = getattr(client, method)(path) if payload is None else getattr(client, method)(path, json=payload)
        assert response.status_code == 404, (method, path, response.text)
    intruder_keys = client.get("/api/v1/keys").json()
    assert key_id not in [k["id"] for k in intruder_keys]
    assert [k["name"] for k in intruder_keys] == ["Primary key"]  # intruder signup primary
    assert intruder_keys[0]["is_primary"] is True


def test_model_permissions_reference_and_replace(
    client: TestClient, user_factory, provider_factory, model_factory
) -> None:
    user_factory()
    provider = provider_factory("Scope provider")
    model = model_factory(provider["id"])

    created = _create(
        client,
        name="Scoped",
        model_permissions=[{"provider_id": provider["id"], "model_id": model["id"], "rpm": 10}],
    )
    key_id = created["key"]["id"]
    permissions = created["key"]["model_permissions"]
    assert len(permissions) == 1
    assert permissions[0]["enabled"] is True and permissions[0]["rpm"] == 10

    replaced = client.put(
        f"/api/v1/keys/{key_id}/model-permissions",
        json=[{"provider_id": provider["id"], "enabled": False}],
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["model_permissions"][0]["provider_id"] == provider["id"]

    unknown = "00000000-0000-0000-0000-000000000000"
    invalid = client.put(f"/api/v1/keys/{key_id}/model-permissions", json=[{"provider_id": unknown}])
    assert invalid.status_code == 422


def test_analytics_zeros_on_empty_key(client: TestClient, user_factory) -> None:
    user_factory()
    created = _create(client, name="Analytics")
    key_id = created["key"]["id"]

    response = client.get(f"/api/v1/keys/{key_id}/analytics?preset=last_7d")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["range"] == "last_7d"
    assert data["requests"] == 0
    assert data["tokens"] == 0
    assert Decimal(data["cost"]) == 0
    assert data["avg_latency_ms"] is None
    assert data["p95_latency_ms"] is None
    assert data["error_rate"] == 0
    assert data["series"] == []
    assert data["top_models"] == []
    assert data["top_endpoints"] == []
    assert data["top_countries"] == []

    unknown = client.get(f"/api/v1/keys/{key_id}/analytics?preset=all_time")
    assert unknown.status_code == 422


def test_analytics_aggregates_request_logs(client: TestClient, db, user_factory) -> None:
    user = user_factory()
    created = _create(client, name="Usage")
    key_id = uuid.UUID(created["key"]["id"])
    user_id = uuid.UUID(user["id"])
    db.add_all(
        [
            ApiRequestLog(
                request_id="req-1", api_key_id=key_id, user_id=user_id, provider="openai",
                model="gpt-4o", endpoint="/v1/chat/completions", status="success",
                latency_ms=100.0, cost=Decimal("0.01"), total_tokens=100, country="US",
            ),
            ApiRequestLog(
                request_id="req-2", api_key_id=key_id, user_id=user_id, provider="openai",
                model="gpt-4o", endpoint="/v1/chat/completions", status="error",
                error_code="RATE_LIMITED", latency_ms=300.0, cost=Decimal("0.02"),
                total_tokens=200, country="DE", created_at=datetime.now(timezone.utc),
            ),
            ApiRequestLog(
                request_id="req-3", api_key_id=key_id, user_id=user_id, provider="anthropic",
                model="claude", endpoint="/v1/messages", status="success",
                latency_ms=200.0, cost=Decimal("0.05"), total_tokens=300,
            ),
        ]
    )
    db.commit()

    response = client.get(f"/api/v1/keys/{key_id}/analytics?preset=last_7d")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["requests"] == 3
    assert data["tokens"] == 600
    assert Decimal(data["cost"]) == Decimal("0.08")
    assert data["avg_latency_ms"] == pytest.approx(200.0)
    assert data["p95_latency_ms"] == pytest.approx(290.0)
    assert data["error_rate"] == pytest.approx(1 / 3, abs=1e-4)
    assert len(data["series"]) == 1
    assert data["series"][0]["requests"] == 3
    assert data["series"][0]["errors"] == 1
    assert data["top_models"][0]["model"] == "claude"  # spend-descending
    assert data["top_endpoints"][0]["endpoint"] == "/v1/chat/completions"
    assert {row["country"] for row in data["top_countries"]} == {"US", "DE"}


# --- Phase 8: ownership & key security -----------------------------------------

PENDING_CODE = "ACCOUNT_PENDING_DELETION"
PENDING_MESSAGE = "Account scheduled for deletion."


def _gateway(client: TestClient, raw: str, path: str = "/v1/models"):
    """Cheapest authenticated gateway probe: auth runs before any provider I/O."""
    return client.get(path, headers={"Authorization": f"Bearer {raw}"})


def _owner_row(db, user_id: str) -> User:
    db.expire_all()
    row = db.get(User, uuid.UUID(user_id))
    assert row is not None
    return row


def test_owner_soft_deleted_key_gateway_forbidden(client: TestClient, db, user_factory) -> None:
    user = user_factory()
    created = _create(client, name="Owner gone")
    raw = created["raw_key"]
    assert key_engine.authenticate(db, raw) is not None  # warm the context cache

    row = _owner_row(db, user["id"])
    row.is_deleted = True
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))

    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None and ctx.owner_is_deleted is True
    response = _gateway(client, raw)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_owner_inactive_key_gateway_forbidden(client: TestClient, db, user_factory) -> None:
    user = user_factory()
    created = _create(client, name="Owner inactive")
    raw = created["raw_key"]
    assert key_engine.authenticate(db, raw) is not None

    row = _owner_row(db, user["id"])
    row.is_active = False
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))

    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None and ctx.owner_is_active is False
    response = _gateway(client, raw)
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_owner_pending_deletion_key_gateway_blocked(client: TestClient, db, user_factory) -> None:
    user = user_factory()
    created = _create(client, name="Owner pending")
    raw = created["raw_key"]
    assert key_engine.authenticate(db, raw) is not None

    now = datetime.now(timezone.utc)
    row = _owner_row(db, user["id"])
    row.deletion_requested_at = now
    row.deletion_scheduled_for = now + timedelta(days=15)
    row.deletion_notice_stage = 1
    db.commit()
    key_engine.invalidate_context(key_engine.hash_key(raw))

    ctx = key_engine.authenticate(db, raw)
    assert ctx is not None and ctx.owner_pending_deletion is True
    response = _gateway(client, raw)
    assert response.status_code == 403, response.text
    payload = response.json()["error"]
    assert payload["code"] == PENDING_CODE
    assert payload["message"] == PENDING_MESSAGE


def test_owner_purged_key_gateway_unauthenticated(client: TestClient, db, user_factory) -> None:
    user = user_factory()
    created = _create(client, name="Owner purged")
    raw, key_hash = created["raw_key"], key_engine.hash_key(created["raw_key"])
    assert key_engine.authenticate(db, raw) is not None

    db.delete(_owner_row(db, user["id"]))  # hard purge: FK CASCADE removes the key rows
    db.commit()
    key_engine.invalidate_context(key_hash)

    assert db.scalar(select(ApiKey).where(ApiKey.key_hash == key_hash)) is None
    assert key_engine.authenticate(db, raw) is None
    response = _gateway(client, raw)
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_rotated_hash_tombstone_beats_recached_context(
    client: TestClient, db, user_factory
) -> None:
    """A stale context re-cached in the invalidate race window must stay dead."""
    from tollms.services.cache.manager import cache_get_sync, cache_set_sync

    user_factory()
    created = _create(client, name="Race")
    old_raw, key_id = created["raw_key"], created["key"]["id"]
    old_hash = key_engine.hash_key(old_raw)
    assert key_engine.authenticate(db, old_raw) is not None
    stale = cache_get_sync(key_engine._cache_key(old_hash))  # noqa: SLF001
    assert isinstance(stale, dict)

    rotated = client.post(f"/api/v1/keys/{key_id}/rotate")
    assert rotated.status_code == 200, rotated.text
    new_raw = rotated.json()["raw_key"]

    # Simulate the race: the pre-rotation context reappears after invalidation.
    assert cache_set_sync(key_engine._cache_key(old_hash), stale, ttl=30) is True  # noqa: SLF001
    assert key_engine.authenticate(db, old_raw) is None
    assert key_engine.authenticate(db, old_raw) is None
    response = _gateway(client, old_raw)
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
    # The replacement hash is unaffected.
    assert key_engine.authenticate(db, new_raw) is not None


def test_deleted_key_gateway_unauthenticated(client: TestClient, db, user_factory) -> None:
    user_factory()
    created = _create(client, name="Doomed")
    raw, key_id = created["raw_key"], created["key"]["id"]
    assert key_engine.authenticate(db, raw) is not None

    assert client.delete(f"/api/v1/keys/{key_id}").status_code == 204
    assert key_engine.authenticate(db, raw) is None
    assert key_engine.authenticate(db, raw) is None
    response = _gateway(client, raw)
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_allow_deny_overlap_rejected(client: TestClient, user_factory) -> None:
    user_factory()
    overlapped = client.post(
        "/api/v1/keys",
        json={
            "name": "Overlap",
            "ip_rules": [
                {"type": "allow", "cidr": "1.2.3.4"},
                {"type": "deny", "cidr": "1.2.3.4/32"},
            ],
        },
    )
    assert overlapped.status_code == 422, overlapped.text
    assert overlapped.json()["error"]["code"] == "VALIDATION_ERROR"

    created = _create(client, name="Rules", ip_rules=[{"type": "allow", "cidr": "9.9.9.9"}])
    replaced = client.put(
        f"/api/v1/keys/{created['key']['id']}/ip-rules",
        json=[{"type": "allow", "cidr": "5.6.7.8"}, {"type": "deny", "cidr": "5.6.7.8"}],
    )
    assert replaced.status_code == 422, replaced.text
    assert replaced.json()["error"]["code"] == "VALIDATION_ERROR"


def test_past_expiry_rejected_and_null_clears(client: TestClient, user_factory) -> None:
    user_factory()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    assert client.post("/api/v1/keys", json={"name": "Past", "expires_at": past}).status_code == 422

    created = _create(client, name="Expiring", expires_at=future)
    key_id = created["key"]["id"]

    assert client.patch(f"/api/v1/keys/{key_id}", json={"expires_at": past}).status_code == 422
    cleared = client.patch(f"/api/v1/keys/{key_id}", json={"expires_at": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["expires_at"] is None

    past_policy = client.put(f"/api/v1/keys/{key_id}/policy", json={"expires_at": past})
    assert past_policy.status_code == 422, past_policy.text
    assert past_policy.json()["error"]["code"] == "VALIDATION_ERROR"
    nulled = client.put(f"/api/v1/keys/{key_id}/policy", json={})
    assert nulled.status_code == 200, nulled.text
    assert nulled.json()["policy"]["expires_at"] is None


def test_negative_budget_rejected_and_nan_guards(client: TestClient, user_factory) -> None:
    from tollms.api.keys import service as key_service
    from tollms.core.exceptions import ValidationError

    user_factory()
    negative = client.post(
        "/api/v1/keys", json={"name": "Neg", "policy": {"max_budget_usd": "-1"}}
    )
    assert negative.status_code == 422, negative.text
    assert negative.json()["error"]["code"] == "VALIDATION_ERROR"

    # Service-level guards for direct callers (NaN never survives JSON anyway).
    for value in (float("nan"), Decimal("NaN"), Decimal("-1"), -1, -0.5):
        with pytest.raises(ValidationError):
            key_service._reject_bad_number(value, field="policy.max_budget_usd")  # noqa: SLF001
    assert key_service._reject_bad_number(None, field="policy.max_budget_usd") is None  # noqa: SLF001
    assert key_service._reject_bad_number(Decimal("0"), field="policy.max_budget_usd") is None  # noqa: SLF001
