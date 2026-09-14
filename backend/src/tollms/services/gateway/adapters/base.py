"""Adapter contracts. All adapters stream normalized chunks; chat() collects."""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import ClassVar

import httpx

logger = logging.getLogger(__name__)


@dataclass
class MediaPart:
    """One non-text attachment payload. Gate on the adapter's supports_* flags."""

    kind: str  # "image" | "audio" | "video"
    mime_type: str
    data_b64: str
    filename: str = ""


@dataclass
class ChatMessage:
    role: str
    content: str
    media: list[MediaPart] = field(default_factory=list)


@dataclass
class StreamChunk:
    delta: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None


@dataclass
class ChatResult:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0


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

    # Native wire support per media kind. Document text needs no wire support:
    # the gateway injects extracted text as plain content (supports_files=True).
    supports_vision: ClassVar[bool] = False
    supports_audio: ClassVar[bool] = False
    supports_video: ClassVar[bool] = False
    supports_files: ClassVar[bool] = True

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
            if chunk.cache_read_tokens is not None:
                usage.cache_read_tokens = chunk.cache_read_tokens
            if chunk.cache_write_tokens is not None:
                usage.cache_write_tokens = chunk.cache_write_tokens
            if chunk.reasoning_tokens is not None:
                usage.reasoning_tokens = chunk.reasoning_tokens
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


def _as_int(value) -> int | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        return int(value)
    except (ValueError, TypeError):
        return None


def usage_extras(usage: dict) -> dict[str, int | None]:
    """Cache/reasoning tokens across OpenAI/Anthropic/Gemini usage shapes. Never raises."""
    try:
        prompt_details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
        completion_details = (
            usage.get("completion_tokens_details") or usage.get("output_tokens_details") or {}
        )
        return {
            "cache_read_tokens": _as_int(
                usage.get("cache_read_input_tokens")
                or usage.get("cachedContentTokenCount")
                or prompt_details.get("cached_tokens")
            ),
            "cache_write_tokens": _as_int(usage.get("cache_creation_input_tokens")),
            "reasoning_tokens": _as_int(
                usage.get("thoughtsTokenCount") or completion_details.get("reasoning_tokens")
            ),
        }
    except Exception:
        logger.exception("usage extras extraction failed")
        return {"cache_read_tokens": None, "cache_write_tokens": None, "reasoning_tokens": None}
