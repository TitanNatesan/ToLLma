"""Live health SSE endpoint: admin gate, framing, and frozen payload contract.

`TestClient` buffers a response until the ASGI app returns, which an
open-ended SSE stream never does, so the 200-path test drives the real ASGI
interface directly through the TestClient portal: request first, then
`http.disconnect` as soon as the first frame is sent.
"""

import asyncio
import json
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tollms.api.admin import schemas
from tollms.models.user import PlatformRole, User
from tollms.services.admin import live_health

STREAM_PATH = "/api/admin/health/stream"

TOP_LEVEL_KEYS = {"timestamp", "server", "process", "database", "cache", "queue"}
SERVER_KEYS = {
    "cpu_percent",
    "memory_percent",
    "memory_used_mb",
    "memory_total_mb",
    "disk_percent",
    "disk_used_gb",
    "disk_total_gb",
    "load_average",
}
PROCESS_KEYS = {"backend_uptime_seconds", "active_requests", "active_generations"}
DATABASE_KEYS = {"status", "connections", "latency_ms"}
CACHE_KEYS = {"status", "memory_mb"}
QUEUE_KEYS = {"pending_jobs", "running_jobs"}


def _promote(db: Session, user_id: str) -> None:
    user = db.get(User, uuid.UUID(user_id))
    assert user is not None, "signup did not persist the user"
    user.platform_role = PlatformRole.PLATFORM_ADMIN
    db.commit()


def _assert_frozen_contract(payload: dict[str, Any]) -> None:
    """Exact key sets + always-present numerics, per the frozen contract."""
    assert set(payload) == TOP_LEVEL_KEYS
    assert set(payload["server"]) == SERVER_KEYS
    assert set(payload["process"]) == PROCESS_KEYS
    assert set(payload["database"]) == DATABASE_KEYS
    assert set(payload["cache"]) == CACHE_KEYS
    assert set(payload["queue"]) == QUEUE_KEYS

    assert isinstance(payload["timestamp"], str) and payload["timestamp"].endswith("Z")

    assert payload["server"]["cpu_percent"] >= 0
    assert 0 <= payload["server"]["memory_percent"] <= 100
    assert payload["server"]["memory_used_mb"] >= 0
    assert payload["server"]["memory_total_mb"] >= 0
    assert 0 <= payload["server"]["disk_percent"] <= 100
    assert payload["server"]["disk_used_gb"] >= 0
    assert payload["server"]["disk_total_gb"] >= 0
    assert payload["server"]["load_average"] >= 0

    assert payload["process"]["backend_uptime_seconds"] >= 0
    assert payload["process"]["active_requests"] >= 0
    assert payload["process"]["active_generations"] >= 0

    assert payload["database"]["status"] in {"ok", "down"}
    assert payload["database"]["connections"] >= 0
    latency = payload["database"]["latency_ms"]
    assert latency is None or latency >= 0

    assert payload["cache"]["status"] in {"ok", "degraded", "down"}
    assert payload["cache"]["memory_mb"] >= 0

    assert payload["queue"]["pending_jobs"] >= 0
    assert payload["queue"]["running_jobs"] >= 0


def _drive_first_sse_frame(client: TestClient, path: str) -> list[dict[str, Any]]:
    """Run the real ASGI app until exactly one streamed frame has been sent.

    The app runs in the TestClient portal loop, so loop-bound clients (Valkey)
    stay valid; `send` signals `http.disconnect` after the first body chunk and
    the StreamingResponse task group cancels the generator.
    """
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


def test_stream_requires_authentication(client: TestClient) -> None:
    client.cookies.clear()  # no leakage from other helpers
    r = client.get(STREAM_PATH)
    assert r.status_code == 401, r.text


def test_stream_forbidden_for_regular_users(client: TestClient, user_factory) -> None:
    user_factory("live-health-regular@tollma.ai")
    r = client.get(STREAM_PATH)
    assert r.status_code == 403, r.text


def test_stream_emits_frozen_payload_for_platform_admins(
    client: TestClient, db: Session, user_factory
) -> None:
    user = user_factory("live-health-admin@tollma.ai")
    _promote(db, user["id"])

    events = _drive_first_sse_frame(client, STREAM_PATH)

    start = next(e for e in events if e["type"] == "http.response.start")
    headers = {key.decode(): value.decode() for key, value in start["headers"]}
    assert start["status"] == 200
    assert headers["content-type"].startswith("text/event-stream")
    assert headers["cache-control"] == "no-cache"
    assert headers["x-accel-buffering"] == "no"
    assert headers["connection"] == "keep-alive"

    body = b"".join(
        e.get("body", b"") for e in events if e["type"] == "http.response.body"
    ).decode()
    frames = [frame for frame in body.split("\n\n") if frame]
    assert frames, "no SSE frame was streamed"
    assert frames[0].startswith("data: "), frames[0]
    payload = json.loads(frames[0][len("data: ") :])
    validated = schemas.AdminLiveHealth.model_validate(payload)
    _assert_frozen_contract(validated.model_dump())


def test_sample_matches_frozen_contract(db: Session) -> None:
    payload = schemas.AdminLiveHealth.model_validate(live_health.sample(db))
    dumped = payload.model_dump()
    _assert_frozen_contract(dumped)
    # The probe ran against the test database, so it must have succeeded.
    assert dumped["database"]["status"] == "ok"
    assert dumped["database"]["latency_ms"] is not None
