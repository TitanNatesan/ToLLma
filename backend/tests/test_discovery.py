"""Adapter validate/discover + service persistence tests (mocked transports)."""

import asyncio
import uuid

import httpx
import pytest
from sqlalchemy.orm import Session

from tollms.modules.gateway.adapters.anthropic import AnthropicAdapter
from tollms.modules.gateway.adapters.bedrock import BedrockAdapter
from tollms.modules.gateway.adapters.gemini import GeminiAdapter, VertexAdapter
from tollms.modules.gateway.adapters.openai import CustomAdapter, OpenAIChatAdapter, OpenAIResponsesAdapter
from tollms.modules.gateway.factory import build_adapter
from tollms.modules.models.service import list_models
from tollms.modules.providers.models import Provider, ProviderType
from tollms.modules.providers.service import discover_provider_models, validate_provider


def _mock(routes: dict[str, tuple[int, dict]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        for path, (status, payload) in routes.items():
            if request.url.path.endswith(path):
                return httpx.Response(status, json=payload)
        return httpx.Response(404, json={})

    return httpx.MockTransport(handler)


def test_openai_validate_and_discover() -> None:
    t = _mock({"/v1/models": (200, {"data": [{"id": "gpt-x"}]})})
    adapter = OpenAIChatAdapter(credentials={"api_key": "k"}, model_id="gpt-x", transport=t)
    valid, message, _ = asyncio.run(adapter.validate_credentials())
    assert valid and message == "credentials valid"
    found = asyncio.run(adapter.discover_models())
    assert [(d.model_id, d.endpoint_type) for d in found] == [("gpt-x", "chat_completions")]

    resp = OpenAIResponsesAdapter(credentials={"api_key": "k"}, model_id="m", transport=t)
    found = asyncio.run(resp.discover_models())
    assert found[0].endpoint_type == "responses"

    bad = OpenAIChatAdapter(credentials={}, model_id="m")
    assert asyncio.run(bad.validate_credentials())[0] is False


def test_anthropic_and_gemini_discover() -> None:
    t = _mock({"/v1/models": (200, {"data": [{"id": "claude-x", "display_name": "Claude X"}]})})
    found = asyncio.run(AnthropicAdapter(credentials={"api_key": "k"}, model_id="m", transport=t).discover_models())
    assert [(d.model_id, d.endpoint_type) for d in found] == [("claude-x", "messages")]

    g = _mock({"/models": (200, {"models": [{"name": "models/gemini-x", "displayName": "Gemini X"}]})})
    found = asyncio.run(GeminiAdapter(credentials={"api_key": "k"}, model_id="m", transport=g).discover_models())
    assert [(d.model_id, d.name) for d in found] == [("gemini-x", "Gemini X")]


def test_vertex_discover_with_mock_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(VertexAdapter, "_access_token", lambda self: "tok")
    t = _mock({"/publishers/google/models": (200, {"models": [{"name": "projects/p/locations/l/publishers/google/models/vx"}]})})
    adapter = VertexAdapter(
        credentials={
            "project_id": "p",
            "location": "l",
            "credentials_json": '{"type": "service-account", "private_key": "x"}',
        },
        model_id="m",
        transport=t,
    )
    found = asyncio.run(adapter.discover_models())
    assert [d.model_id for d in found] == ["vx"]
    assert asyncio.run(VertexAdapter(credentials={}, model_id="m").validate_credentials())[0] is False


def test_custom_requires_base_url_and_factory_covers_all_types(db: Session, provider_factory) -> None:
    assert asyncio.run(CustomAdapter(credentials={}, model_id="m").validate_credentials()) == (False, "base_url is required", 0)
    assert asyncio.run(CustomAdapter(credentials={}, model_id="m").discover_models()) == []

    # Extra headers (dict or JSON string) are merged into every custom request.
    seen: dict = {}

    def capture(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, json={"data": []})

    t = httpx.MockTransport(capture)
    asyncio.run(
        CustomAdapter(
            credentials={"base_url": "http://x", "extra_headers": {"x-opencode-session": "s1"}},
            model_id="m",
            transport=t,
        ).validate_credentials()
    )
    assert seen["x-opencode-session"] == "s1"
    assert "authorization" not in seen
    asyncio.run(
        CustomAdapter(
            credentials={"base_url": "http://x", "api_key": "k", "extra_headers": '{"x-a": "b"}'},
            model_id="m",
            transport=t,
        ).validate_credentials()
    )
    assert seen["authorization"] == "Bearer k"
    assert seen["x-a"] == "b"
    assert asyncio.run(BedrockAdapter(credentials={}, model_id="m").validate_credentials())[0] is False

    for ptype in ProviderType:
        p = Provider(name="x", provider_type=ptype, credentials_encrypted="e")
        adapter = build_adapter(p, None, {})
        assert adapter is not None


def test_validate_and_discover_persist(db: Session, provider_factory, model_factory) -> None:
    p = provider_factory("D", creds={"base_url": "http://mock"})
    t = _mock({"/models": (200, {"data": [{"id": "disc-a"}, {"id": "disc-b"}]})})

    valid, _, _ = asyncio.run(validate_provider(db, uuid.UUID(p["id"]), t))
    assert valid is True
    stored = asyncio.run(_read_provider(db, p["id"]))
    assert stored["validation_status"] == "valid"
    assert stored["last_validated_at"] is not None

    first = asyncio.run(discover_provider_models(db, uuid.UUID(p["id"]), t))
    assert first.created == 2
    assert sorted(first.discovered) == ["disc-a", "disc-b"]
    assert len(list_models(db, provider_id=uuid.UUID(p["id"]))) == 2

    second = asyncio.run(discover_provider_models(db, uuid.UUID(p["id"]), t))
    assert second.created == 0  # idempotent


async def _read_provider(db: Session, pid: str) -> dict:
    from tollms.modules.providers.service import get_provider

    p = get_provider(db, uuid.UUID(pid))
    return {"validation_status": p.validation_status, "last_validated_at": p.last_validated_at}
