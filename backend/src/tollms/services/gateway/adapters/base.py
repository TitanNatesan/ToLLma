"""Adapter contracts. All adapters stream normalized chunks; chat() collects."""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import ClassVar

import httpx

from tollms.services.gateway.caching import CachingPlan

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
    images: list = field(default_factory=list)


@dataclass
class ChatResult:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    images: list = field(default_factory=list)


# Reasoning normalization contract (provider-agnostic rendering).
#
# Every adapter maps its wire-specific reasoning format into <think> spans
# embedded in the delta text — the same convention Bedrock established.
# Gateway, SSE, persistence, and the frontend all treat these spans
# identically, so reasoning-capable models work with zero provider-specific
# handling downstream. The chat UI renders <think>…</think> as the
# collapsible Thinking pill for every provider.
THINK_OPEN = "<think>\n"
THINK_CLOSE = "\n</think>\n\n"

# Composer levels that mean "do not request reasoning". "none" is the
# explicit UI off switch; "default" predates it and maps the same way, so
# adapters omit thinking/reasoning request fields for either.
REASONING_OFF_LEVELS = ("none", "default")

# Composer reasoning level -> thinking token budgets (Claude semantics; used
# by both the native Anthropic API and Bedrock Converse).
THINKING_BUDGETS = {"low": 1024, "medium": 4096, "high": 10000, "ultra": 32000}
THINKING_MIN_BUDGET = 1024
THINKING_HEADROOM = 4096  # max_tokens must exceed the thinking budget


def thinking_budget(level: str | None) -> int | None:
    """Composer level -> thinking budget. Off for none/default/unset;
    unknown future levels fall back to medium."""
    if not level or level in REASONING_OFF_LEVELS:
        return None
    return THINKING_BUDGETS.get(level, THINKING_BUDGETS["medium"])


def thinking_params(
    level: str | None, max_output_tokens: int | None = None
) -> tuple[int, int] | None:
    """Valid (budget_tokens, max_tokens) pair, or None when thinking is off.

    Providers require budget < max_tokens. The model's declared max output
    (when known) keeps the budget in range without capping long answers.
    """
    budget = thinking_budget(level)
    if budget is None:
        return None
    if max_output_tokens is None:
        return budget, budget + THINKING_HEADROOM
    if max_output_tokens <= THINKING_MIN_BUDGET:
        return None  # no room for thinking on this model
    budget = min(budget, max(THINKING_MIN_BUDGET, max_output_tokens - THINKING_HEADROOM))
    return budget, max_output_tokens


def reasoning_effort(level: str | None) -> str | None:
    """Composer level -> OpenAI-style effort, or None when thinking is off.

    OpenAI-compatible surfaces (native OpenAI, LiteLLM, OpenRouter, vLLM)
    accept minimal/low/medium/high. Composer-only levels clamp to high.
    """
    if not level or level in REASONING_OFF_LEVELS:
        return None
    if level in ("minimal", "low", "medium", "high"):
        return level
    return "high"


@dataclass
class DiscoveredModel:
    """Normalized model discovery entry.

    `endpoint_type` is the legacy mirror of `primary_endpoint`; adapters that
    know the real endpoint set fill `primary_endpoint`/`supported_endpoints`.
    """

    model_id: str
    name: str
    endpoint_type: str = "chat_completions"
    context_window: int | None = None
    max_output_tokens: int | None = None
    primary_endpoint: str | None = None
    supported_endpoints: list[str] = field(default_factory=list)
    # Repository intelligence filled in by the discovery services (API layer),
    # never by adapters. Default empty so adapter-level tests stay simple.
    suggested: dict = field(default_factory=dict)


@dataclass
class BaseProviderAdapter:
    credentials: dict
    model_id: str
    transport: httpx.AsyncBaseTransport | None = None
    timeout: float = 120.0
    # Composer-selected reasoning level (e.g. "low"/"medium"/"high"/None).
    # Adapters that must explicitly request thinking (Anthropic, Bedrock
    # Claude, OpenAI-style effort) read it; others ignore it. Never inspected
    # for model names.
    reasoning_level: str | None = None
    # Registered model's declared max output; lets thinking budgets clamp
    # without capping long answers. None = unknown.
    max_output_tokens: int | None = None
    # Prompt-cache plan (services/gateway/caching). None = caching unsupported
    # or not requested; adapters then send their default request body.
    prompt_cache: CachingPlan | None = None
    # Last non-chat provider usage payload (image generation reports token
    # usage); None when the provider reported none. Actual cost wins over
    # estimates when this is present.
    last_media_usage: dict | None = None

    # Native wire support per media kind. Document text needs no wire support:
    # the gateway injects extracted text as plain content (supports_files=True).
    supports_vision: ClassVar[bool] = False
    supports_audio: ClassVar[bool] = False
    supports_video: ClassVar[bool] = False
    supports_files: ClassVar[bool] = True
    # Endpoint this adapter speaks. "supported_endpoints" advertises the full
    # set when one adapter class covers several (OpenAI audio does not).
    endpoint: ClassVar[str] = "chat_completions"
    supported_endpoints: ClassVar[frozenset[str]] = frozenset({"chat_completions"})

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
            if getattr(chunk, "images", None):
                usage.images.extend(chunk.images)
        usage.text = "".join(parts)
        return usage

    # --- Non-chat endpoints (embeddings, images, audio) ---------------------
    # Adapters implement only what their endpoint supports; the gateway
    # dispatches by endpoint and lets unsupported calls fail clearly.

    async def embed(self, inputs: list[str]) -> list[list[float]]:
        """Embedding vectors for each input. Unsupported on this endpoint."""
        raise NotImplementedError(f"{self.endpoint} does not support embeddings")

    async def generate_image(
        self, prompt: str, *, size: str = "1024x1024", quality: str = "low"
    ) -> bytes:
        """Raw image bytes for one prompt. Unsupported on this endpoint."""
        raise NotImplementedError(f"{self.endpoint} does not support image generation")

    async def transcribe(self, audio: bytes, filename: str, mime_type: str) -> str:
        """Audio -> text. Unsupported on this endpoint."""
        raise NotImplementedError(f"{self.endpoint} does not support transcription")

    async def speak(self, text: str, *, voice: str = "alloy", response_format: str = "mp3") -> bytes:
        """Text -> audio bytes. Unsupported on this endpoint."""
        raise NotImplementedError(f"{self.endpoint} does not support speech")

    async def generate_video(
        self,
        prompt: str,
        *,
        size: str = "1280x720",
        seconds: str = "4",
        image: bytes | None = None,
        image_filename: str = "input_reference.png",
        image_mime: str = "image/png",
        poll_interval: float = 5.0,
        deadline: float = 900.0,
    ) -> bytes:
        """Text (optionally + reference image) -> video bytes. Unsupported here."""
        raise NotImplementedError(f"{self.endpoint} does not support video generation")


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
                or usage.get("cacheReadInputTokens")
                or usage.get("cachedContentTokenCount")
                or prompt_details.get("cached_tokens")
            ),
            "cache_write_tokens": _as_int(
                usage.get("cache_creation_input_tokens")
                or usage.get("cacheWriteInputTokens")
            ),
            "reasoning_tokens": _as_int(
                usage.get("thoughtsTokenCount") or completion_details.get("reasoning_tokens")
            ),
        }
    except Exception:
        logger.exception("usage extras extraction failed")
        return {"cache_read_tokens": None, "cache_write_tokens": None, "reasoning_tokens": None}
