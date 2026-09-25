"""Unified request contract: every public endpoint normalizes into this shape.

Endpoint translators (OpenAI chat, Anthropic messages, Responses, media) build
a `UnifiedRequest`; the router resolves the model and hands the request to the
provider adapter. Adapters stay the source of truth for wire translation.
"""

from dataclasses import dataclass, field
from typing import Any

from tollms.services.gateway.adapters.base import ChatMessage, MediaPart


@dataclass
class UnifiedRequest:
    """Provider-agnostic request produced by every public endpoint."""

    endpoint: str  # chat_completions | responses | messages | images | image_edits | videos | models
    model_identifier: str  # "provider/model" or a unique short alias
    messages: list[ChatMessage] = field(default_factory=list)
    stream: bool = False
    system: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    stop: list[str] | None = None
    tools: list[dict[str, Any]] | None = None
    tool_choice: Any = None
    reasoning_level: str | None = None
    # Media requests (images/videos) carry the prompt + adapter options.
    prompt: str = ""
    media_options: dict[str, Any] = field(default_factory=dict)
    # Original payload for pass-through fields we do not model yet.
    raw: dict[str, Any] = field(default_factory=dict)
    # Response shape to emit for streaming (openai | anthropic | responses).
    response_format: str = "openai"

    def as_chat_messages(self) -> list[ChatMessage]:
        """System prompt first (adapters split it back out where needed)."""
        if self.system:
            return [ChatMessage(role="system", content=self.system), *self.messages]
        return list(self.messages)


def media_parts_from_openai(content: Any) -> list[MediaPart]:
    """Extract image parts from OpenAI-style multimodal message content."""
    parts: list[MediaPart] = []
    if not isinstance(content, list):
        return parts
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") in ("image_url", "input_image"):
            url = item.get("image_url")
            if isinstance(url, dict):
                url = url.get("url")
            if isinstance(url, str) and url.startswith("data:"):
                header, _, data = url.partition(",")
                mime = header[5:].split(";")[0] or "image/png"
                parts.append(MediaPart(kind="image", mime_type=mime, data_b64=data))
    return parts
