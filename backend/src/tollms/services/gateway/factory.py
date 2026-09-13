"""Adapter factory. One place maps provider type -> implementation."""

import httpx

from tollms.core.exceptions import ProviderError
from tollms.services.gateway.adapters.anthropic import AnthropicAdapter
from tollms.services.gateway.adapters.base import BaseProviderAdapter
from tollms.services.gateway.adapters.bedrock import BedrockAdapter
from tollms.services.gateway.adapters.gemini import GeminiAdapter, VertexAdapter
from tollms.services.gateway.adapters.openai import CustomAdapter, OpenAIChatAdapter, OpenAIResponsesAdapter
from tollms.models.registered_model import AIModel
from tollms.models.provider import Provider, ProviderType


def build_adapter(
    provider: Provider,
    model: AIModel | None,
    credentials: dict,
    transport: httpx.AsyncBaseTransport | None = None,
) -> BaseProviderAdapter:
    cls: type[BaseProviderAdapter]
    match provider.provider_type:
        case ProviderType.OPENAI_RESPONSES:
            cls = OpenAIResponsesAdapter
        case ProviderType.OPENAI_CHAT:
            cls = OpenAIChatAdapter
        case ProviderType.ANTHROPIC_MESSAGES:
            cls = AnthropicAdapter
        case ProviderType.GEMINI:
            cls = GeminiAdapter
        case ProviderType.VERTEX_AI:
            cls = VertexAdapter
        case ProviderType.BEDROCK_CONVERSE:
            cls = BedrockAdapter
        case ProviderType.CUSTOM:
            cls = CustomAdapter
        case _:
            raise ProviderError(f"unsupported provider type {provider.provider_type}")
    return cls(credentials=credentials, model_id=model.model_id if model else "", transport=transport)
