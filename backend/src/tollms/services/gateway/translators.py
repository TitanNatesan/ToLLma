"""Pure payload -> UnifiedRequest translators for the public API surface.

No database, no network: each function deterministically maps the JSON a
client sent into the frozen unified contract. Malformed payloads raise
`ValidationError` naming the offending field.
"""

import logging
from typing import Any

from tollms.core.exceptions import ValidationError
from tollms.services.gateway.adapters.base import ChatMessage, MediaPart
from tollms.services.gateway.unified import UnifiedRequest, media_parts_from_openai

logger = logging.getLogger(__name__)

_TEXT_BLOCK_TYPES = ("text", "input_text", "output_text", "summary_text", "thinking", "tool_result")


# --- shared helpers ---------------------------------------------------------


def _body(payload: Any) -> dict:
    if not isinstance(payload, dict):
        raise ValidationError("request body must be a JSON object")
    return payload


def _required_str(payload: dict, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{key} is required")
    return value.strip()


def _optional_int(payload: dict, key: str) -> int | None:
    value = payload.get(key)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{key} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{key} must be an integer") from None


def _optional_float(payload: dict, key: str) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{key} must be a number")
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{key} must be a number") from None


def _stop_list(value: Any, field: str = "stop") -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return list(value)
    raise ValidationError(f"{field} must be a string or a list of strings")


def _tool_list(value: Any) -> list[dict[str, Any]] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValidationError("tools must be a list")
    tools = [item for item in value if isinstance(item, dict)]
    if len(tools) != len(value):
        raise ValidationError("tools entries must be objects")
    return tools


def _content_text(content: Any, field: str) -> str:
    """Flatten wire content (string or part list) into plain text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        raise ValidationError(f"{field} must be a string or a list of content parts")
    parts: list[str] = []
    for index, block in enumerate(content):
        if isinstance(block, str):
            parts.append(block)
            continue
        if not isinstance(block, dict):
            raise ValidationError(f"{field}[{index}] must be a string or an object")
        block_type = block.get("type")
        if block_type in _TEXT_BLOCK_TYPES:
            text = block.get("text")
        elif block_type in ("image_url", "input_image"):
            continue  # extracted into media parts
        else:
            text = block.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(part for part in parts if part)


# --- OpenAI chat completions -------------------------------------------------


def _openai_message(item: Any, index: int) -> ChatMessage:
    if not isinstance(item, dict):
        raise ValidationError(f"messages[{index}] must be an object")
    role = item.get("role")
    if not isinstance(role, str) or not role.strip():
        raise ValidationError(f"messages[{index}].role is required")
    content = item.get("content")
    return ChatMessage(
        role=role.strip(),
        content=_content_text(content, f"messages[{index}].content"),
        media=media_parts_from_openai(content),
    )


def from_openai_chat(payload: Any) -> UnifiedRequest:
    """POST /v1/chat/completions body -> UnifiedRequest."""
    body = _body(payload)
    model = _required_str(body, "model")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValidationError("messages must be a non-empty list")
    max_tokens = _optional_int(body, "max_tokens")
    if max_tokens is None:
        max_tokens = _optional_int(body, "max_completion_tokens")
    return UnifiedRequest(
        endpoint="chat_completions",
        model_identifier=model,
        messages=[_openai_message(item, index) for index, item in enumerate(messages)],
        stream=bool(body.get("stream", False)),
        max_tokens=max_tokens,
        temperature=_optional_float(body, "temperature"),
        top_p=_optional_float(body, "top_p"),
        stop=_stop_list(body.get("stop")),
        tools=_tool_list(body.get("tools")),
        tool_choice=body.get("tool_choice"),
        raw=dict(body),
        response_format="openai",
    )


# --- Anthropic messages ------------------------------------------------------


def _anthropic_system(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return _content_text(value, "system") or None
    raise ValidationError("system must be a string or a list of content blocks")


def _anthropic_image(block: dict, field: str) -> MediaPart | None:
    source = block.get("source")
    if not isinstance(source, dict) or source.get("type") != "base64":
        return None
    data = source.get("data")
    if not isinstance(data, str) or not data:
        raise ValidationError(f"{field}.source.data is required")
    mime = source.get("media_type") or "image/png"
    return MediaPart(kind="image", mime_type=str(mime), data_b64=data)


def _anthropic_message(item: Any, index: int) -> ChatMessage:
    if not isinstance(item, dict):
        raise ValidationError(f"messages[{index}] must be an object")
    role = item.get("role")
    if not isinstance(role, str) or not role.strip():
        raise ValidationError(f"messages[{index}].role is required")
    content = item.get("content")
    if content is None or isinstance(content, str):
        return ChatMessage(role=role.strip(), content=content or "")
    if not isinstance(content, list):
        raise ValidationError(f"messages[{index}].content must be a string or a list of blocks")
    texts: list[str] = []
    media: list[MediaPart] = []
    for block_index, block in enumerate(content):
        field = f"messages[{index}].content[{block_index}]"
        if isinstance(block, str):
            texts.append(block)
            continue
        if not isinstance(block, dict):
            raise ValidationError(f"{field} must be a string or an object")
        block_type = block.get("type")
        if block_type == "image":
            image = _anthropic_image(block, field)
            if image is not None:
                media.append(image)
        elif block_type == "tool_result":
            texts.append(_content_text(block.get("content"), f"{field}.content"))
        elif block_type in _TEXT_BLOCK_TYPES:
            text = block.get("text")
            if isinstance(text, str):
                texts.append(text)
    return ChatMessage(role=role.strip(), content="\n".join(texts), media=media)


def from_anthropic_messages(payload: Any) -> UnifiedRequest:
    """POST /v1/messages body -> UnifiedRequest (max_tokens is required)."""
    body = _body(payload)
    model = _required_str(body, "model")
    max_tokens = _optional_int(body, "max_tokens")
    if max_tokens is None or max_tokens <= 0:
        raise ValidationError("max_tokens is required")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValidationError("messages must be a non-empty list")
    return UnifiedRequest(
        endpoint="messages",
        model_identifier=model,
        messages=[_anthropic_message(item, index) for index, item in enumerate(messages)],
        stream=bool(body.get("stream", False)),
        system=_anthropic_system(body.get("system")),
        max_tokens=max_tokens,
        temperature=_optional_float(body, "temperature"),
        top_p=_optional_float(body, "top_p"),
        stop=_stop_list(body.get("stop_sequences"), "stop_sequences"),
        tools=_tool_list(body.get("tools")),
        tool_choice=body.get("tool_choice"),
        raw=dict(body),
        response_format="anthropic",
    )


# --- OpenAI Responses --------------------------------------------------------


def _responses_item(item: Any, index: int) -> ChatMessage | None:
    if isinstance(item, str):
        return ChatMessage(role="user", content=item)
    if not isinstance(item, dict):
        raise ValidationError(f"input[{index}] must be a string or an object")
    role = item.get("role") or "user"
    if not isinstance(role, str) or not role.strip():
        raise ValidationError(f"input[{index}].role must be a string")
    content = item.get("content", item.get("text"))
    return ChatMessage(
        role=role.strip(),
        content=_content_text(content, f"input[{index}].content"),
        media=media_parts_from_openai(content),
    )


def from_responses(payload: Any) -> UnifiedRequest:
    """POST /v1/responses body -> UnifiedRequest."""
    body = _body(payload)
    model = _required_str(body, "model")
    input_value = body.get("input")
    if input_value is None:
        raise ValidationError("input is required")
    if isinstance(input_value, str):
        messages = [ChatMessage(role="user", content=input_value)]
    elif isinstance(input_value, list) and input_value:
        messages = [message for index, item in enumerate(input_value) if (message := _responses_item(item, index))]
    else:
        raise ValidationError("input must be a string or a non-empty list of items")
    instructions = body.get("instructions")
    if instructions is not None and not isinstance(instructions, str):
        raise ValidationError("instructions must be a string")
    return UnifiedRequest(
        endpoint="responses",
        model_identifier=model,
        messages=messages,
        stream=bool(body.get("stream", False)),
        system=instructions,
        max_tokens=_optional_int(body, "max_output_tokens"),
        temperature=_optional_float(body, "temperature"),
        top_p=_optional_float(body, "top_p"),
        tools=_tool_list(body.get("tools")),
        tool_choice=body.get("tool_choice"),
        raw=dict(body),
        response_format="responses",
    )


# --- media -------------------------------------------------------------------


def from_images(payload: Any, *, edits: bool) -> UnifiedRequest:
    """POST /v1/images/generations (.edits) body -> UnifiedRequest."""
    body = _body(payload)
    model = _required_str(body, "model")
    prompt = _required_str(body, "prompt")
    size = body.get("size") or "1024x1024"
    quality = body.get("quality") or "low"
    n = _optional_int(body, "n")
    if n is None:
        n = 1
    if n < 1:
        raise ValidationError("n must be at least 1")
    options: dict[str, Any] = {"size": str(size), "quality": str(quality), "n": n}
    if edits:
        image = body.get("image")
        if not isinstance(image, str) or not image.strip():
            raise ValidationError("image is required for image edits")
        options["image"] = image.strip()
    return UnifiedRequest(
        endpoint="image_edits" if edits else "images",
        model_identifier=model,
        prompt=prompt,
        media_options=options,
        raw=dict(body),
    )


def from_videos(payload: Any) -> UnifiedRequest:
    """POST /v1/videos/generations body -> UnifiedRequest."""
    body = _body(payload)
    model = _required_str(body, "model")
    prompt = _required_str(body, "prompt")
    seconds = body.get("seconds")
    if seconds is None:
        seconds = body.get("duration")
    options: dict[str, Any] = {
        "size": str(body.get("size") or "1280x720"),
        "seconds": str(seconds if seconds is not None else 4),
    }
    return UnifiedRequest(
        endpoint="videos",
        model_identifier=model,
        prompt=prompt,
        media_options=options,
        raw=dict(body),
    )
