"""Adapter validate/discover + service persistence tests (mocked transports)."""

import asyncio
import uuid

import httpx
import pytest
from sqlalchemy.orm import Session

from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.bedrock import BedrockAdapter
from tollms.services.gateway.adapters.gemini import GeminiAdapter, VertexAdapter
from tollms.services.gateway.adapters.openai import CustomAdapter, OpenAIChatAdapter, OpenAIResponsesAdapter
from tollms.services.gateway.factory import build_adapter
from tollms.api.models.service import list_models
from tollms.models.provider import Provider, ProviderType
from tollms.api.providers.service import discover_provider_models, validate_provider


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
    # Without base_url or key the unified OpenAI-compatible adapter reports the
    # missing key (OpenAI default); a base_url override makes the key optional.
    result = asyncio.run(CustomAdapter(credentials={}, model_id="m").validate_credentials())
    assert result[0] is False and "api_key" in result[1]
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


def test_validate_persists_but_discover_only_caches(db: Session, provider_factory, model_factory) -> None:
    p = provider_factory("D", creds={"base_url": "http://mock"})
    t = _mock({"/models": (200, {"data": [{"id": "disc-a"}, {"id": "disc-b"}]})})

    valid, _, _ = asyncio.run(validate_provider(db, uuid.UUID(p["id"]), t))
    assert valid is True
    stored = asyncio.run(_read_provider(db, p["id"]))
    assert stored["validation_status"] == "valid"
    assert stored["last_validated_at"] is not None

    # Refresh discovers and caches — it registers nothing.
    first = asyncio.run(discover_provider_models(db, uuid.UUID(p["id"]), t))
    assert first.total == 2
    assert first.new_count == 2
    assert sorted(i.model_id for i in first.discovered) == ["disc-a", "disc-b"]
    assert len(list_models(db, provider_id=uuid.UUID(p["id"]))) == 0

    # Cache persisted on provider metadata for the Available/Registered panels.
    cached = asyncio.run(_read_provider(db, p["id"]))["metadata"]["discovery"]
    assert cached["total"] == 2
    assert cached["last_discovery_at"] is not None
    assert {m["model_id"] for m in cached["models"]} == {"disc-a", "disc-b"}
    assert all("suggested" in m and "match_type" in m for m in cached["models"])

    # Registering one model flips it from available to registered on re-refresh.
    from tollms.api.models.schemas import ModelCreate
    from tollms.models.registered_model import EndpointType

    from tollms.api.models.service import create_model as _create

    _create(db, ModelCreate(provider_id=uuid.UUID(p["id"]), model_id="disc-a", name="A",
                            endpoint_type=EndpointType.CHAT_COMPLETIONS))
    second = asyncio.run(discover_provider_models(db, uuid.UUID(p["id"]), t))
    assert second.total == 2
    assert second.new_count == 1  # idempotent w.r.t. registration
    assert second.registered_count == 1
    assert len(list_models(db, provider_id=uuid.UUID(p["id"]))) == 1


def test_bedrock_converse_discovery_sets_converse_endpoint(
    db: Session, provider_factory, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tollms.services.gateway.adapters.base import DiscoveredModel

    # Personal provider via HTTP: owned row (both-null rows are rejected by
    # ck_providers_owner_scope).
    p = provider_factory(
        "BedrockTest", ptype="BEDROCK_CONVERSE",
        creds={"access_key": "ak", "secret_key": "sk", "region": "us-east-1"},
    )

    async def _mock_discover(self):
        return [
            DiscoveredModel(
                model_id="anthropic.claude-3-haiku-20240307-v1:0",
                name="Claude 3 Haiku",
                endpoint_type="converse",
                context_window=200000,
                max_output_tokens=4096,
            )
        ]

    monkeypatch.setattr(BedrockAdapter, "discover_models", _mock_discover)

    res = asyncio.run(discover_provider_models(db, uuid.UUID(p["id"])))
    assert res.total == 1
    info = res.discovered[0]
    assert info.endpoint_type == "converse"
    assert info.suggested["endpoint_type"] == "converse"
    assert info.context_window == 200000
    assert info.suggested["context_window"] == 200000


async def _read_provider(db: Session, pid: str) -> dict:
    from tollms.api.providers.service import get_provider

    p = get_provider(db, uuid.UUID(pid))
    return {"validation_status": p.validation_status, "last_validated_at": p.last_validated_at, "metadata": p.metadata_}
