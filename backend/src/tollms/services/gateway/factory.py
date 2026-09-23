"""Adapter factory. Provider family + model endpoint -> implementation.

Routing rule: the provider decides the family (OpenAI-compatible, Anthropic,
Gemini, Vertex, Bedrock), the model's `primary_endpoint` decides the adapter.
Endpoint strings are wire paths (see models.registered_model.ENDPOINT_WIRE).
"""

import httpx

from tollms.core.exceptions import ProviderError
from tollms.models.provider import Provider, ProviderType
from tollms.models.registered_model import CHAT_ENDPOINTS, endpoint_wire
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import BaseProviderAdapter
from tollms.services.gateway.adapters.bedrock import BedrockAdapter
from tollms.services.gateway.adapters.gemini import GeminiAdapter, VertexAdapter
from tollms.services.gateway.adapters.openai import (
    CustomAdapter,
    OpenAIAudioSpeechAdapter,
    OpenAIAudioTranscriptionsAdapter,
    OpenAIChatAdapter,
    OpenAIEmbeddingsAdapter,
    OpenAIImagesAdapter,
    OpenAIResponsesAdapter,
    OpenAIVideoAdapter,
)

# OpenAI-compatible gateway: every endpoint the OpenAI family implements.
_OPENAI_ENDPOINT_ADAPTERS: dict[str, type[BaseProviderAdapter]] = {
    "responses": OpenAIResponsesAdapter,
    "chat_completions": OpenAIChatAdapter,
    "embeddings": OpenAIEmbeddingsAdapter,
    "images/generations": OpenAIImagesAdapter,
    "audio/transcriptions": OpenAIAudioTranscriptionsAdapter,
    "audio/speech": OpenAIAudioSpeechAdapter,
    "video/generations": OpenAIVideoAdapter,
}

# Fixed-endpoint providers: their wire shape is tied to one endpoint.
_PROVIDER_DEFAULTS: dict[ProviderType, tuple[str, type[BaseProviderAdapter]]] = {
    ProviderType.OPENAI: ("chat_completions", OpenAIChatAdapter),
    ProviderType.ANTHROPIC_MESSAGES: ("messages", AnthropicAdapter),
    ProviderType.GEMINI: ("chat_completions", GeminiAdapter),
    ProviderType.VERTEX_AI: ("chat_completions", VertexAdapter),
    ProviderType.BEDROCK_CONVERSE: ("converse", BedrockAdapter),
    ProviderType.CUSTOM: ("chat_completions", CustomAdapter),
}


def default_endpoint(provider: Provider) -> str:
    """Provider-level endpoint used when no model is available (validation,
    discovery, or a legacy row without `primary_endpoint`)."""
    default, _ = _PROVIDER_DEFAULTS[provider.provider_type]
    return default


def provider_supported_endpoints(provider: Provider) -> list[str]:
    """Endpoints this provider family can route."""
    if provider.provider_type in (ProviderType.OPENAI, ProviderType.CUSTOM):
        return list(_OPENAI_ENDPOINT_ADAPTERS)
    return [default_endpoint(provider)]


def resolve_endpoint(provider: Provider, model) -> str:
    """Model endpoint wins; fall back to the provider default or family chat."""
    for candidate in (getattr(model, "primary_endpoint", None), endpoint_wire(getattr(model, "endpoint_type", None))):
        if candidate:
            return candidate
    return default_endpoint(provider)


def adapter_class(provider: Provider, endpoint: str) -> type[BaseProviderAdapter]:
    if provider.provider_type in (ProviderType.OPENAI, ProviderType.CUSTOM):
        cls = _OPENAI_ENDPOINT_ADAPTERS.get(endpoint)
        if cls is None:
            raise ProviderError(
                f"{provider.provider_type.value} does not support endpoint '{endpoint}'"
            )
        return cls
    default, cls = _PROVIDER_DEFAULTS[provider.provider_type]
    if endpoint not in ({default} | CHAT_ENDPOINTS):
        raise ProviderError(
            f"{provider.provider_type.value} does not support endpoint '{endpoint}'"
        )
    return cls


def build_adapter(
    provider: Provider,
    model,
    credentials: dict,
    transport: httpx.AsyncBaseTransport | None = None,
) -> BaseProviderAdapter:
    endpoint = resolve_endpoint(provider, model)
    cls = adapter_class(provider, endpoint)
    return cls(credentials=credentials, model_id=model.model_id if model else "", transport=transport)
