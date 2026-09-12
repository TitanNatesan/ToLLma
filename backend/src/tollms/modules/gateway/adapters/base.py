"""Adapter contracts. All adapters stream normalized chunks; chat() collects."""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    role: str
    content: str


@dataclass
class StreamChunk:
    delta: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


@dataclass
class ChatResult:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class DiscoveredModel:
    """Normalized model discovery entry. endpoint_type matches EndpointType values."""

    model_id: str
    name: str
    endpoint_type: str = "chat_completions"
    context_window: int | None = None
    max_output_tokens: int | None = None


@dataclass
class BaseProviderAdapter:
    credentials: dict
    model_id: str
    transport: httpx.AsyncBaseTransport | None = None
    timeout: float = 120.0

    def _client(self, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.transport, timeout=self.timeout, **kwargs)

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        raise NotImplementedError
        yield  # make it an async generator for type checkers

    async def validate_credentials(self) -> tuple[bool, str, float]:
        """Live credential check. Returns (valid, message, latency_ms). Never raises."""
        raise NotImplementedError

    async def discover_models(self) -> list[DiscoveredModel]:
        """List models available to these credentials. Never raises."""
        raise NotImplementedError

    async def chat(self, messages: list[ChatMessage]) -> ChatResult:
        """Non-streaming convenience built on chat_stream. No duplicate logic."""
        parts: list[str] = []
        usage = ChatResult(text="")
        async for chunk in self.chat_stream(messages):
            parts.append(chunk.delta)
            if chunk.prompt_tokens is not None:
                usage.prompt_tokens = chunk.prompt_tokens
            if chunk.completion_tokens is not None:
                usage.completion_tokens = chunk.completion_tokens
            if chunk.total_tokens is not None:
                usage.total_tokens = chunk.total_tokens
        usage.text = "".join(parts)
        return usage


def sse_data_lines(text: str) -> list[str]:
    """Extract `data:` payloads from an SSE byte stream buffer."""
    out = []
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload and payload != "[DONE]":
                out.append(payload)
    return out
