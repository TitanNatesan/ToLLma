"""Public gateway request schemas (OpenAI / Anthropic / Responses / media).

Payloads stay intentionally loose (messages are typed as objects) so every
provider extension passes through to the translators and adapters; the
translators own the semantic validation with clear `ValidationError`s.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _Loose(BaseModel):
    """Base for wire payloads: unknown fields are kept for pass-through."""

    model_config = ConfigDict(extra="allow")


class ChatCompletionRequest(_Loose):
    """POST /v1/chat/completions (OpenAI chat shape)."""

    model: str = Field(min_length=1)
    messages: list[dict[str, Any]] = Field(min_length=1)
    stream: bool = False
    max_tokens: int | None = Field(default=None, ge=1)
    max_completion_tokens: int | None = Field(default=None, ge=1)
    temperature: float | None = None
    top_p: float | None = None
    stop: str | list[str] | None = None
    tools: list[dict[str, Any]] | None = None
    tool_choice: Any = None


class ResponsesRequest(_Loose):
    """POST /v1/responses (OpenAI Responses shape)."""

    model: str = Field(min_length=1)
    input: str | list[Any]
    instructions: str | None = None
    stream: bool = False
    max_output_tokens: int | None = Field(default=None, ge=1)
    temperature: float | None = None
    top_p: float | None = None
    tools: list[dict[str, Any]] | None = None
    tool_choice: Any = None


class AnthropicMessagesRequest(_Loose):
    """POST /v1/messages (Anthropic Messages shape; max_tokens required)."""

    model: str = Field(min_length=1)
    max_tokens: int = Field(gt=0)
    messages: list[dict[str, Any]] = Field(min_length=1)
    system: str | list[dict[str, Any]] | None = None
    stream: bool = False
    temperature: float | None = None
    top_p: float | None = None
    stop_sequences: str | list[str] | None = None
    tools: list[dict[str, Any]] | None = None
    tool_choice: Any = None


class ImageGenerationRequest(_Loose):
    """POST /v1/images/generations."""

    model: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    size: str = "1024x1024"
    quality: str = "low"
    n: int = Field(default=1, ge=1, le=10)


class ImageEditRequest(ImageGenerationRequest):
    """POST /v1/images/edits (base64 image + prompt)."""

    image: str = Field(min_length=1)


class VideoGenerationRequest(_Loose):
    """POST /v1/videos/generations."""

    model: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    size: str = "1280x720"
    seconds: str | int | float | None = None
