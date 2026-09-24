"""Platform admin access control: 401 anonymous, 403 regular users, 200 admins.

Every `/api/admin/*` endpoint is exercised. The promoted-admin requests run
against an empty database, so a 200 with the exact schema key set proves both
the gate and the (frozen) serialization contract, not just the happy path.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.models.user import PlatformRole, User

# Top-level response keys per `api/admin/schemas.py` (frozen contract).
ADMIN_ENDPOINTS: dict[str, set[str]] = {
    "/api/admin/dashboard": {
        "range",
        "generated_at",
        "requests",
        "active_users",
        "total_tokens",
        "total_cost",
        "cache_savings",
        "error_rate",
        "images",
        "videos",
        "spend_series",
        "token_series",
        "top_models",
        "top_providers",
        "recent_errors",
        "health",
    },
    "/api/admin/usage": {
        "range",
        "requests",
        "failed_requests",
        "active_users",
        "new_users",
        "conversations",
        "total_tokens",
        "total_cost",
        "series",
        "by_model",
        "by_provider",
    },
    "/api/admin/models": {"range", "rows"},
    "/api/admin/providers": {"range", "rows"},
    "/api/admin/users": {"range", "total_users", "active_users", "new_users", "rows"},
    "/api/admin/costs": {
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
    },
    "/api/admin/tokens": {
        "range",
        "prompt_tokens",
        "completion_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
        "total_tokens",
        "cached_share",
        "series",
        "by_model",
    },
    "/api/admin/cache": {
        "range",
        "cached_tokens",
        "cache_write_tokens",
        "cache_read_cost",
        "cache_write_cost",
        "savings",
        "hit_rate",
        "providers_with_cache",
        "by_provider",
        "by_model",
    },
    "/api/admin/media": {
        "range",
        "images",
        "videos",
        "media_bytes",
        "image_cost",
        "video_cost",
        "series",
        "by_model",
        "by_kind",
    },
    "/api/admin/errors": {
        "range",
        "failed_requests",
        "cancelled_requests",
        "error_rate",
        "by_code",
        "by_model",
        "by_provider",
        "series",
    },
    "/api/admin/health": {
        "range",
        "status",
        "checked_at",
        "uptime_seconds",
        "active_generations",
        "error_rate_1h",
        "avg_latency_ms",
        "p95_latency_ms",
        "checks",
    },
}

WINDOW = {"preset": "last_7d", "timezone": "UTC"}


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None, "signup did not persist the user"
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def test_admin_endpoints_require_authentication(client: TestClient) -> None:
    client.cookies.clear()  # no anonymous leakage from other helpers
    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 401, f"{path}: expected 401, got {r.status_code}: {r.text}"


def test_admin_endpoints_forbidden_for_regular_users(client: TestClient, user_factory) -> None:
    user_factory("admin-gate-regular@tollma.ai")
    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 403, f"{path}: expected 403, got {r.status_code}: {r.text}"


def test_admin_endpoints_allow_platform_admins_on_empty_db(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("admin-gate-admin@tollma.ai")
    _promote(db, user["id"])

    for path, expected_keys in ADMIN_ENDPOINTS.items():
        r = client.get(path, params=WINDOW)
        assert r.status_code == 200, f"{path}: expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert isinstance(body, dict), f"{path}: expected a JSON object, got {type(body).__name__}"
        missing = expected_keys - set(body)
        extra = set(body) - expected_keys
        assert not missing and not extra, (
            f"{path}: response keys drifted from the schema "
            f"(missing={sorted(missing)}, extra={sorted(extra)})"
        )


def test_auth_me_exposes_platform_role(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("admin-role-me@tollma.ai")
    assert client.get("/auth/me").json()["platform_role"] == "user"

    _promote(db, user["id"])
    assert client.get("/auth/me").json()["platform_role"] == "platform_admin"
