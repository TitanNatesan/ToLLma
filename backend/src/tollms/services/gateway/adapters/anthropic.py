"""Anthropic messages adapter (SSE streaming)."""

import json
import logging
import time
from collections.abc import AsyncIterator

from tollms.services.gateway.caching import anthropic_messages, anthropic_system
from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    BaseProviderAdapter,
    ChatMessage,
    DiscoveredModel,
    StreamChunk,
    thinking_params,
    usage_extras,
)

logger = logging.getLogger(__name__)


class AnthropicAdapter(BaseProviderAdapter):
    endpoint_type = "messages"
    supports_vision = True

    def _content(self, m: ChatMessage):
        if not m.media:
            return m.content
        blocks: list[dict] = []
        if m.content:
            blocks.append({"type": "text", "text": m.content})
        blocks.extend(self._image_blocks(m))
        return blocks or m.content

    def _image_blocks(self, m: ChatMessage) -> list[dict]:
        blocks: list[dict] = []
        for part in m.media:
            if part.kind == "image":
                blocks.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": part.mime_type, "data": part.data_b64},
                })
        return blocks

    def _request_content(self, m: ChatMessage):
        """Message content with tool blocks preserved (tool_use / tool_result)."""
        extra = m.extra or {}
        if m.role == "tool":
            return [{
                "type": "tool_result",
                "tool_use_id": extra.get("tool_call_id") or extra.get("tool_use_id") or "",
                "content": m.content,
            }]
        native = extra.get("blocks") or []
        calls = extra.get("tool_calls") or []
        if not native and not calls:
            return self._content(m)
        blocks: list[dict] = []
        if m.content:
            blocks.append({"type": "text", "text": m.content})
        blocks.extend(self._image_blocks(m))
        for call in calls:
            function = call.get("function") or {}
            blocks.append({
                "type": "tool_use",
                "id": call.get("id"),
                "name": function.get("name"),
                "input": _parse_tool_arguments(function.get("arguments")),
            })
        blocks.extend(dict(block) for block in native if isinstance(block, dict))
        return blocks

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.credentials["api_key"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    async def _get_models(self) -> tuple[bool, str, float, list]:
        if not self.credentials.get("api_key"):
            return False, "api_key is required", 0, []
        start = time.monotonic()
        try:
            async with self._client() as client:
                r = await client.get("https://api.anthropic.com/v1/models", headers=self._headers(), timeout=10.0)
            ms = (time.monotonic() - start) * 1000
            if r.status_code >= 400:
                logger.warning("anthropic models %s: %s", r.status_code, r.text[:200])
                return False, f"provider rejected credentials ({r.status_code})", ms, []
            return True, "credentials valid", ms, r.json().get("data", [])
        except Exception as e:
            logger.exception("anthropic models request failed")
            return False, f"validation request failed: {e}", (time.monotonic() - start) * 1000, []

    async def validate_credentials(self) -> tuple[bool, str, float]:
        valid, message, ms, _ = await self._get_models()
        return valid, message, ms

    async def discover_models(self) -> list[DiscoveredModel]:
        valid, _, _, data = await self._get_models()
        if not valid:
            return []
        return [
            DiscoveredModel(model_id=m["id"], name=m.get("display_name", m["id"]), endpoint_type=self.endpoint_type)
            for m in data
            if isinstance(m, dict) and m.get("id")
        ]

    async def chat_stream(
        self, messages: list[ChatMessage], tools: list[dict] | None = None, tool_choice: dict | str | None = None
    ) -> AsyncIterator[StreamChunk]:
        system = "\n".join(m.content for m in messages if m.role == "system")
        rest = [
            {"role": "user" if m.role == "tool" else m.role, "content": self._request_content(m)}
            for m in messages
            if m.role != "system"
        ]
        rest = anthropic_messages(self.prompt_cache, rest)
        body: dict = {"model": self.model_id, "messages": rest, "stream": True, "max_tokens": 4096}
        if tools is not None:
            body["tools"] = tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice
        if system:
            body["system"] = anthropic_system(self.prompt_cache, system)
        params = thinking_params(self.reasoning_level, self.max_output_tokens)
        if params is not None:
            # Extended thinking must be explicitly requested or Claude emits
            # no thinking blocks at all. max_tokens must exceed the budget.
            budget, max_tokens = params
            body["thinking"] = {"type": "enabled", "budget_tokens": budget}
            body["max_tokens"] = max_tokens
        headers = self._headers()
        try:
            async with self._client() as client, client.stream(
                "POST", "https://api.anthropic.com/v1/messages", json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("anthropic error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                in_reasoning = False
                tool_ids: dict = {}
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload:
                        continue
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    etype = event.get("type")
                    if etype == "message_start":
                        usage = ((event.get("message") or {}).get("usage")) or {}
                        if usage.get("input_tokens"):
                            extras = usage_extras(usage)
                            yield StreamChunk(
                                prompt_tokens=usage["input_tokens"],
                                cache_read_tokens=extras["cache_read_tokens"],
                                cache_write_tokens=extras["cache_write_tokens"],
                            )
                    elif etype == "content_block_start":
                        block = event.get("content_block") or {}
                        if block.get("type") == "tool_use":
                            index = event.get("index")
                            tool_ids[index] = block.get("id") or ""
                            yield StreamChunk(tool_call_delta={
                                "index": index,
                                "id": block.get("id") or "",
                                "name": block.get("name") or "",
                                "arguments_delta": "",
                            })
                        elif block.get("type") == "redacted_thinking":
                            # Safety redaction: show a placeholder, not silence.
                            if not in_reasoning:
                                yield StreamChunk(delta=THINK_OPEN)
                                in_reasoning = True
                            yield StreamChunk(delta="(Thinking redacted by the provider)")
                    elif etype == "content_block_delta":
                        delta = event.get("delta") or {}
                        dtype = delta.get("type")
                        if dtype == "input_json_delta":
                            index = event.get("index")
                            yield StreamChunk(tool_call_delta={
                                "index": index,
                                "id": tool_ids.get(index, ""),
                                "arguments_delta": delta.get("partial_json", ""),
                            })
                        elif dtype == "text_delta":
                            if in_reasoning:
                                yield StreamChunk(delta=THINK_CLOSE)
                                in_reasoning = False
                            yield StreamChunk(delta=delta.get("text", ""))
                        elif dtype == "thinking_delta":
                            # Signature deltas carry integrity tokens for
                            # multi-turn continuity, not displayable text.
                            thinking = delta.get("thinking", "")
                            if thinking:
                                if not in_reasoning:
                                    yield StreamChunk(delta=THINK_OPEN)
                                    in_reasoning = True
                                yield StreamChunk(delta=thinking)
                    elif etype in ("content_block_stop", "message_stop"):
                        if in_reasoning:
                            yield StreamChunk(delta=THINK_CLOSE)
                            in_reasoning = False
                    elif etype == "message_delta":
                        stop_reason = (event.get("delta") or {}).get("stop_reason")
                        if stop_reason:
                            yield StreamChunk(finish_reason=stop_reason)
                        usage = event.get("usage") or {}
                        if usage.get("output_tokens"):
                            extras = usage_extras(usage)
                            yield StreamChunk(
                                completion_tokens=usage["output_tokens"],
                                reasoning_tokens=extras["reasoning_tokens"],
                            )
                if in_reasoning:
                    yield StreamChunk(delta=THINK_CLOSE)
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("anthropic stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


def _parse_tool_arguments(arguments) -> dict:
    """OpenAI-style tool arguments (JSON string) -> Anthropic input object."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str) and arguments.strip():
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            logger.warning("anthropic: dropping unparseable tool arguments")
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}
