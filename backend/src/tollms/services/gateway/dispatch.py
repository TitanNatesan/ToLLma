"""Endpoint dispatch. One place maps an endpoint to the adapter method.

Chat endpoints stream assistant text; utility endpoints (embeddings, images,
audio) call their dedicated adapter methods. The validation suite and any
future REST surface share this dispatcher so routing stays endpoint-aware.
"""

from typing import Any

from tollms.core.exceptions import ProviderError
from tollms.models.registered_model import CHAT_ENDPOINTS
from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatMessage


async def call_endpoint(adapter: BaseProviderAdapter, endpoint: str, **kwargs: Any) -> Any:
    """Invoke `endpoint` on `adapter`.

    Keyword args per endpoint:
      chat*:               messages: list[ChatMessage]
      embeddings:          inputs: list[str]
      images/generations:  prompt: str, options: dict (size/quality)
      audio/transcriptions: audio: bytes, filename: str, mime_type: str
      audio/speech:        text: str, voice: str
    """
    if endpoint in CHAT_ENDPOINTS:
        return await adapter.chat(kwargs["messages"])
    if endpoint == "embeddings":
        return await adapter.embed(kwargs["inputs"])
    if endpoint == "images/generations":
        return await adapter.generate_image(kwargs["prompt"], **(kwargs.get("options") or {}))
    if endpoint == "audio/transcriptions":
        return await adapter.transcribe(kwargs["audio"], kwargs["filename"], kwargs["mime_type"])
    if endpoint == "audio/speech":
        return await adapter.speak(kwargs["text"], **(kwargs.get("options") or {}))
    if endpoint == "video/generations":
        return await adapter.generate_video(kwargs["prompt"], **(kwargs.get("options") or {}))
    raise ProviderError(f"unsupported endpoint '{endpoint}'")


def chat_text(result: Any) -> str:
    """Answer text from a dispatched chat call (ChatResult)."""
    return getattr(result, "text", "") or ""


__all__ = ["call_endpoint", "chat_text", "ChatMessage"]
