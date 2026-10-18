"""Request logging: every AI request lands in request_logs and powers analytics."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.models.request_log import RequestLog, RequestStatus
from tollms.models.request_log import ExportEvent


def test_non_streaming_chat_writes_request_log(
    client, user_factory, provider_factory, model_factory, monkeypatch
):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])

    from tollms.api.gateway import service as gateway_service
    from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatResult, StreamChunk

    class FakeAdapter(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="fake")

        async def chat_stream(self, messages):
            yield StreamChunk(delta="hello ", prompt_tokens=10, completion_tokens=5, total_tokens=15)

        async def chat(self, messages):  # type: ignore[override]
            return ChatResult(text="hello world", prompt_tokens=10, completion_tokens=5, total_tokens=15)

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: FakeAdapter())
    key_id = client.get("/api/v1/chat/keys").json()[0]["id"]

    r = client.post(
        "/api/v1/gateway/chat",
        json={"provider_id": provider["id"], "model_id": model["id"], "message": "hi", "key_id": key_id},
    )
    assert r.status_code == 200, r.text
    message_id = r.json()["message_id"]

    logs = client.get("/api/v1/request-logs").json()
    assert logs["total"] == 1
    item = logs["items"][0]
    assert item["message_id"] == message_id
    assert item["status"] == RequestStatus.SUCCESS.value
    assert item["total_tokens"] == 15
    assert item["is_streaming"] is False
    assert item["provider_name"] == provider["name"]
    assert item["model_name"] == model["name"]
    assert item["latency_ms"] is not None


def test_request_log_summary_aggregates(db: Session, client, user_factory, provider_factory, model_factory, monkeypatch):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])

    from tollms.api.gateway import service as gateway_service
    from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatResult

    class FakeAdapter(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="fake")

        async def chat_stream(self, messages):
            raise NotImplementedError
            yield  # pragma: no cover - unreachable

        async def chat(self, messages):  # type: ignore[override]
            return ChatResult(text="ok", prompt_tokens=100, completion_tokens=50, total_tokens=150)

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: FakeAdapter())
    key_id = client.get("/api/v1/chat/keys").json()[0]["id"]

    for _ in range(2):
        r = client.post(
            "/api/v1/gateway/chat",
            json={"provider_id": provider["id"], "model_id": model["id"], "message": "hi", "key_id": key_id},
        )
        assert r.status_code == 200, r.text

    summary = client.get("/api/v1/request-logs/summary?days=7").json()
    assert summary["requests"] == 2
    assert summary["total_tokens"] == 300
    assert float(summary["total_cost"]) > 0
    assert summary["failed"] == 0
    assert summary["by_provider"][0]["provider_name"] == provider["name"]
    assert summary["by_provider"][0]["requests"] == 2

    stored = db.execute(select(RequestLog)).scalars().all()
    assert len(stored) == 2


def test_request_log_filters(client, user_factory, provider_factory, model_factory, monkeypatch):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])

    from tollms.api.gateway import service as gateway_service
    from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatResult

    class FakeAdapter(BaseProviderAdapter):
        def __init__(self) -> None:
            super().__init__(credentials={}, model_id="fake")

        async def chat_stream(self, messages):
            raise NotImplementedError
            yield  # pragma: no cover - unreachable

        async def chat(self, messages):  # type: ignore[override]
            return ChatResult(text="ok", prompt_tokens=1, completion_tokens=1, total_tokens=2)

    monkeypatch.setattr(gateway_service, "build_adapter", lambda *a, **k: FakeAdapter())
    key_id = client.get("/api/v1/chat/keys").json()[0]["id"]
    r = client.post(
        "/api/v1/gateway/chat",
        json={"provider_id": provider["id"], "model_id": model["id"], "message": "hi", "key_id": key_id},
    )
    conversation_id = r.json()["conversation_id"]

    assert client.get(f"/api/v1/request-logs?conversation_id={conversation_id}").json()["total"] == 1
    assert client.get("/api/v1/request-logs?status=failed").json()["total"] == 0
    assert client.get("/api/v1/request-logs?regenerations_only=true").json()["total"] == 0


def test_export_events_are_recorded(db: Session, client, user_factory, provider_factory, model_factory):
    user_factory()
    provider = provider_factory()
    model = model_factory(provider["id"])
    created = client.post(
        "/api/v1/conversations",
        json={"title": "Exportable", "provider_id": provider["id"], "model_id": model["id"]},
    ).json()

    r = client.get(f"/api/v1/exports/conversations/{created['id']}?format=md")
    assert r.status_code == 200

    events = db.execute(select(ExportEvent)).scalars().all()
    assert len(events) == 1
    assert events[0].format == "md"
    assert events[0].item_count == 1

    history = client.get("/api/v1/exports/history").json()
    assert history and history[0]["format"] == "md"
