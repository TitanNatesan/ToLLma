"""Platform admin access control: 401 anonymous, 403 regular users, 200 admins.

Every `/api/admin/*` endpoint is exercised. The promoted-admin requests run
against an empty database, so a 200 with the exact schema key set proves both
the gate and the (frozen) serialization contract, not just the happy path.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.models.user import PlatformRole, User

# SSE endpoints are not JSON objects, so they stay out of ADMIN_ENDPOINTS and
# are asserted separately in each test below.
STREAM_PATH = "/api/admin/health/stream"

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
        "api_keys",
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
    "/api/admin/providers": {"range", "rows", "credential_health"},
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
    "/api/admin/api-keys": {
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
    },
}

WINDOW = {"preset": "last_7d", "timezone": "UTC"}


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None, "signup did not persist the user"
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _drive_first_sse_frame(client: TestClient, path: str) -> list[dict]:
    """Run the real ASGI app until one streamed frame has been sent.

    `TestClient` buffers a response until the app returns, which an
    open-ended SSE stream never does, so the 200-path drives the ASGI
    interface directly through the TestClient portal: request first, then
    `http.disconnect` as soon as the first frame is sent. (Mirrors
    `test_admin_live_health`; duplicated so this matrix stays self-contained.)
    """
    import asyncio
    from typing import Any

    from tollms.main import app

    cookie = "; ".join(f"{name}={value}" for name, value in client.cookies.items())
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("latin-1"),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"cookie", cookie.encode("latin-1")),
        ],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    events: list[dict[str, Any]] = []
    queue: asyncio.Queue = asyncio.Queue()
    queue.put_nowait({"type": "http.request", "body": b"", "more_body": False})

    async def receive() -> dict[str, Any]:
        return await queue.get()

    async def send(message: dict[str, Any]) -> None:
        events.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            queue.put_nowait({"type": "http.disconnect"})

    async def run() -> None:
        await app(scope, receive, send)

    assert client.portal is not None
    client.portal.call(run)
    return events


def test_admin_endpoints_require_authentication(client: TestClient) -> None:
    client.cookies.clear()  # no anonymous leakage from other helpers
    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 401, f"{path}: expected 401, got {r.status_code}: {r.text}"
    # The admin gate runs before streaming starts, so a plain GET observes the
    # denial without hanging on the open-ended stream.
    r = client.get(STREAM_PATH)
    assert r.status_code == 401, f"{STREAM_PATH}: expected 401, got {r.status_code}: {r.text}"


def test_admin_endpoints_forbidden_for_regular_users(client: TestClient, user_factory) -> None:
    user_factory("admin-gate-regular@tollma.ai")
    for path in ADMIN_ENDPOINTS:
        r = client.get(path, params=WINDOW)
        assert r.status_code == 403, f"{path}: expected 403, got {r.status_code}: {r.text}"
    # Same gate-before-stream note as above. Either denial shape is accepted:
    # the JSON error body today, or an SSE `text/event-stream` framing if a
    # gateway ever streams the denial to an EventSource client.
    r = client.get(STREAM_PATH)
    assert r.status_code == 403, f"{STREAM_PATH}: expected 403, got {r.status_code}: {r.text}"
    assert r.headers["content-type"].split(";")[0].strip() in {
        "application/json",
        "text/event-stream",
    }, f"{STREAM_PATH}: unexpected denial content-type {r.headers['content-type']!r}"


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

    # The stream is SSE, not JSON: drive the ASGI app until the first frame.
    events = _drive_first_sse_frame(client, STREAM_PATH)
    start = next(e for e in events if e["type"] == "http.response.start")
    assert start["status"] == 200, f"{STREAM_PATH}: expected 200, got {start['status']}"
    headers = {key.decode(): value.decode() for key, value in start["headers"]}
    assert headers["content-type"].startswith("text/event-stream"), headers
    body = b"".join(e.get("body", b"") for e in events if e["type"] == "http.response.body").decode()
    frames = [frame for frame in body.split("\n\n") if frame]
    assert frames and frames[0].startswith("data: "), f"{STREAM_PATH}: no SSE frame streamed"


# `/api/admin/health` takes no window params, so it is excluded here; extra
# date params are ignored there by design (still 200 — see the fallback test).
WINDOWED_ENDPOINTS = [path for path in ADMIN_ENDPOINTS if path != "/api/admin/health"]


def test_admin_window_rejects_malformed_dates(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("admin-gate-dates@tollma.ai")
    _promote(db, user["id"])

    for path in WINDOWED_ENDPOINTS:
        for params in (
            {"preset": "last_7d", "timezone": "UTC", "start": "not-a-date"},
            {"preset": "last_7d", "timezone": "UTC", "end": "2024-13-99"},
        ):
            r = client.get(path, params=params)
            assert r.status_code == 422, (
                f"{path} {params}: expected 422, got {r.status_code}: {r.text}"
            )


def test_admin_window_keeps_preset_fallback(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("admin-gate-preset@tollma.ai")
    _promote(db, user["id"])

    # Unknown presets keep the existing fallback (never 422).
    for path in WINDOWED_ENDPOINTS:
        r = client.get(path, params={"preset": "bogus-preset", "timezone": "UTC"})
        assert r.status_code == 200, f"{path}: expected 200, got {r.status_code}: {r.text}"
    # Window-less endpoints ignore date params entirely.
    r = client.get("/api/admin/health", params={"preset": "bogus-preset", "start": "not-a-date"})
    assert r.status_code == 200, f"/api/admin/health: expected 200, got {r.status_code}: {r.text}"


def test_auth_me_exposes_platform_role(client: TestClient, db: Session, user_factory) -> None:
    user = user_factory("admin-role-me@tollma.ai")
    assert client.get("/auth/me").json()["platform_role"] == "user"

    _promote(db, user["id"])
    assert client.get("/auth/me").json()["platform_role"] == "platform_admin"
