"""Endpoint-aware architecture: factory routing, adapter wire calls, repository
endpoint metadata, and discovery precedence (all mocked, no live providers)."""

import asyncio
import uuid

import httpx
import pytest
from sqlalchemy.orm import Session

from tollms.api.models.schemas import ModelCreate
from tollms.api.models.service import create_model
from tollms.api.providers.schemas import ProviderCreate
from tollms.api.providers.service import create_provider, discover_provider_models
from tollms.models.model_repository import RepositoryModel
from tollms.models.provider import Provider, ProviderType
from tollms.models.registered_model import (
    EndpointType,
    endpoint_enum,
    normalize_endpoints,
)
from tollms.services.gateway.adapters.openai import (
    OpenAIAudioSpeechAdapter,
    OpenAIAudioTranscriptionsAdapter,
    OpenAIChatAdapter,
    OpenAIEmbeddingsAdapter,
    OpenAIImagesAdapter,
    OpenAIResponsesAdapter,
)
from tollms.services.gateway.factory import (
    adapter_class,
    build_adapter,
    default_endpoint,
    provider_supported_endpoints,
)
from tollms.services.model_repository.sources import derive_endpoints, normalize_endpoint
from tollms.services.model_repository.sync import merge_records
from tollms.services.model_repository.sources import NormalizedModel


def _provider(ptype: ProviderType = ProviderType.OPENAI, creds: dict | None = None) -> Provider:
    return Provider(
        name="p",
        provider_type=ptype,
        credentials_encrypted="",
        metadata_={},
    )


def _model(primary: str, legacy: EndpointType | None = None):
    return type(
        "M",
        (),
        {
            "model_id": "m",
            "primary_endpoint": primary,
            "endpoint_type": legacy or (endpoint_enum(primary) or EndpointType.CHAT_COMPLETIONS),
        },
    )()


def _mock(handler):
    return httpx.MockTransport(handler)


# --------------------------------------------------------------------------
# Endpoint vocabulary + normalization
# --------------------------------------------------------------------------


def test_normalize_endpoint_aliases() -> None:
    assert normalize_endpoint("/v1/chat/completions") == "chat_completions"
    assert normalize_endpoint("responses") == "responses"
    assert normalize_endpoint("embedding") == "embeddings"
    assert normalize_endpoint("image_generation") == "images/generations"
    assert normalize_endpoint("audio_transcription") == "audio/transcriptions"
    assert normalize_endpoint("audio_speech") == "audio/speech"
    assert normalize_endpoint("not-a-thing") is None


def test_derive_endpoints_from_mode_and_supported_list() -> None:
    assert derive_endpoints(mode="embedding") == ["embeddings"]
    assert derive_endpoints(mode="image_generation") == ["images/generations"]
    assert derive_endpoints(mode="chat") == ["chat_completions"]
    # Explicit upstream list wins and is normalized.
    assert derive_endpoints(
        mode="chat", supported=["/v1/responses", "/v1/chat/completions"]
    ) == ["responses", "chat_completions"]
    # Modality fallback for sources without mode/endpoint lists.
    assert derive_endpoints(in_modalities=["text", "audio"], out_modalities=["text"]) == [
        "chat_completions",
        "audio/transcriptions",
    ]


def test_normalize_endpoints_keeps_primary_in_supported() -> None:
    enum, primary, supported = normalize_endpoints("images/generations", ["embeddings"], None)
    assert enum is EndpointType.IMAGES_GENERATIONS
    assert primary == "images/generations"
    assert supported == ["images/generations", "embeddings"]

    # Unknown future endpoint keeps the wire string, degrades the legacy enum.
    enum, primary, supported = normalize_endpoints("video/generations", None, None)
    assert enum is EndpointType.CHAT_COMPLETIONS
    assert primary == "video/generations"
    assert supported == ["video/generations"]


# --------------------------------------------------------------------------
# Factory routing
# --------------------------------------------------------------------------


def test_factory_routes_openai_by_model_endpoint() -> None:
    provider = _provider(ProviderType.OPENAI, {"api_key": "k"})
    cases = {
        "responses": OpenAIResponsesAdapter,
        "chat_completions": OpenAIChatAdapter,
        "embeddings": OpenAIEmbeddingsAdapter,
        "images/generations": OpenAIImagesAdapter,
        "audio/transcriptions": OpenAIAudioTranscriptionsAdapter,
        "audio/speech": OpenAIAudioSpeechAdapter,
    }
    for endpoint, expected in cases.items():
        adapter = build_adapter(provider, _model(endpoint), {"api_key": "k"})
        assert isinstance(adapter, expected), endpoint


def test_factory_routes_custom_by_model_endpoint() -> None:
    provider = _provider(ProviderType.CUSTOM, {"base_url": "http://mock"})
    responses = build_adapter(provider, _model("responses"), {"base_url": "http://mock"})
    assert isinstance(responses, OpenAIResponsesAdapter)
    assert responses._base_url() == "http://mock"
    embeddings = build_adapter(provider, _model("embeddings"), {"base_url": "http://mock"})
    assert isinstance(embeddings, OpenAIEmbeddingsAdapter)


def test_factory_rejects_non_chat_for_fixed_families() -> None:
    from tollms.core.exceptions import ProviderError

    provider = _provider(ProviderType.ANTHROPIC_MESSAGES, {"api_key": "k"})
    assert isinstance(
        build_adapter(provider, _model("messages"), {"api_key": "k"}), object
    )
    with pytest.raises(ProviderError):
        build_adapter(provider, _model("embeddings"), {"api_key": "k"})
    assert default_endpoint(provider) == "messages"
    assert provider_supported_endpoints(provider) == ["messages"]
    # OpenAI advertises the full endpoint family.
    assert "images/generations" in provider_supported_endpoints(_provider())


# --------------------------------------------------------------------------
# Adapter wire calls
# --------------------------------------------------------------------------


def test_embeddings_adapter_posts_to_embeddings() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"data": [{"embedding": [0.1, 0.2]}]})

    adapter = OpenAIEmbeddingsAdapter(
        credentials={"api_key": "k"}, model_id="text-embedding-3-small", transport=_mock(handler)
    )
    vectors = asyncio.run(adapter.embed(["hello"]))
    assert vectors == [[0.1, 0.2]]
    assert seen["path"] == "/v1/embeddings"
    assert '"input":[["hello"]]' not in seen["body"] or "hello" in seen["body"]


def test_image_adapter_returns_bytes() -> None:
    import base64

    png = base64.b64encode(b"\x89PNG-fake").decode()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        return httpx.Response(200, json={"data": [{"b64_json": png}]})

    adapter = OpenAIImagesAdapter(credentials={"api_key": "k"}, model_id="gpt-image-1", transport=_mock(handler))
    image = asyncio.run(adapter.generate_image("green circle", quality="low"))
    assert image == b"\x89PNG-fake"


def test_audio_adapters_transcribe_and_speak() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/audio/transcriptions":
            assert request.headers["content-type"].startswith("multipart/form-data")
            return httpx.Response(200, json={"text": "hello"})
        if request.url.path == "/v1/audio/speech":
            return httpx.Response(200, content=b"mp3-bytes", headers={"content-type": "audio/mpeg"})
        return httpx.Response(404)

    transcriptions = OpenAIAudioTranscriptionsAdapter(
        credentials={"api_key": "k"}, model_id="whisper-1", transport=_mock(handler)
    )
    assert asyncio.run(transcriptions.transcribe(b"audio", "hello.mp3", "audio/mpeg")) == "hello"

    speech = OpenAIAudioSpeechAdapter(credentials={"api_key": "k"}, model_id="tts-1", transport=_mock(handler))
    assert asyncio.run(speech.speak("hello")) == b"mp3-bytes"


def test_responses_and_chat_share_custom_base_url() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "m"}]})
        return httpx.Response(
            200,
            content=b'data: {"type": "response.output_text.delta", "delta": "hi"}\n\ndata: [DONE]\n\n',
            headers={"content-type": "text/event-stream"},
        )

    provider = _provider(ProviderType.CUSTOM, {"base_url": "http://gateway/v1"})
    adapter = build_adapter(provider, _model("responses"), {"base_url": "http://gateway/v1"}, _mock(handler))
    result = asyncio.run(adapter.chat([]))
    assert result.text == "hi"
    assert paths[-1] == "/v1/responses"

    chat = build_adapter(provider, _model("chat_completions"), {"base_url": "http://gateway/v1"}, _mock(handler))
    asyncio.run(chat.chat([]))
    assert paths[-1] == "/v1/chat/completions"


# --------------------------------------------------------------------------
# Repository endpoint metadata
# --------------------------------------------------------------------------


def test_repository_merge_keeps_endpoint_union() -> None:
    litellm = NormalizedModel(
        source="litellm",
        model_key="openai/gpt-5",
        canonical_name="openai/gpt-5",
        provider="openai",
        provider_model_id="gpt-5",
        endpoint_type="chat_completions",
        primary_endpoint="responses",
        supported_endpoints=["responses", "chat_completions"],
        caps={"supports_chat": True},
    )
    openrouter = NormalizedModel(
        source="openrouter",
        model_key="openai/gpt-5",
        canonical_name="openai/gpt-5",
        provider="openai",
        provider_model_id="gpt-5",
        endpoint_type="chat_completions",
        primary_endpoint="chat_completions",
        supported_endpoints=["chat_completions"],
        caps={},
    )
    merged = merge_records({"openai/gpt-5": [litellm, openrouter]})["openai/gpt-5"]
    assert merged["primary_endpoint"] == "responses"
    assert merged["supported_endpoints"] == ["responses", "chat_completions"]
    assert merged["supports_chat"] is True


# --------------------------------------------------------------------------
# Discovery: repository endpoint beats the adapter default
# --------------------------------------------------------------------------


def test_discovery_repository_endpoint_wins_over_adapter_hint(
    db: Session, provider_factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tollms.services.gateway.adapters.base import DiscoveredModel

    p = create_provider(
        db,
        ProviderCreate(name="OpenAIDisc", provider_type=ProviderType.OPENAI, credentials={"api_key": "k"}),
    )
    db.add(
        RepositoryModel(
            model_key="openai/gpt-5",
            canonical_name="openai/gpt-5",
            provider="openai",
            provider_model_id="gpt-5",
            endpoint_type="chat_completions",
            primary_endpoint="responses",
            supported_endpoints=["responses", "chat_completions"],
            supports_chat=True,
            is_active=True,
        )
    )
    db.add(
        RepositoryModel(
            model_key="openai/text-embedding-3-large",
            canonical_name="openai/text-embedding-3-large",
            provider="openai",
            provider_model_id="text-embedding-3-large",
            endpoint_type="embeddings",
            primary_endpoint="embeddings",
            supported_endpoints=["embeddings"],
            supports_embeddings=True,
            supports_chat=False,
            is_active=True,
        )
    )
    db.commit()

    async def fake_discover(self):
        # The adapter only knows chat; the repository must correct the endpoint.
        return [
            DiscoveredModel(model_id="gpt-5", name="gpt-5"),
            DiscoveredModel(model_id="text-embedding-3-large", name="text-embedding-3-large"),
        ]

    monkeypatch.setattr(OpenAIChatAdapter, "discover_models", fake_discover)
    res = asyncio.run(discover_provider_models(db, p.id))
    by_id = {item.model_id: item for item in res.discovered}
    assert by_id["gpt-5"].primary_endpoint == "responses"
    assert by_id["gpt-5"].suggested["endpoint_type"] == "responses"
    assert by_id["text-embedding-3-large"].primary_endpoint == "embeddings"
    assert by_id["text-embedding-3-large"].suggested["supports_embeddings"] is True
    assert by_id["text-embedding-3-large"].suggested["endpoint_type"] == "embeddings"


def test_registered_model_mirrors_primary_endpoint(db: Session, provider_factory) -> None:
    p = provider_factory("OAEndpoint", ptype="OPENAI", creds={"api_key": "k"})
    model = create_model(
        db,
        ModelCreate(
            provider_id=uuid.UUID(p["id"]),
            model_id="gpt-5",
            name="GPT-5",
            endpoint_type=EndpointType.RESPONSES,
            primary_endpoint="responses",
            supported_endpoints=["responses", "chat_completions"],
        ),
    )
    assert model.endpoint_type is EndpointType.RESPONSES
    assert model.primary_endpoint == "responses"
    assert model.supported_endpoints == ["responses", "chat_completions"]
