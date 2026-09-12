"""Anthropic messages adapter (SSE streaming)."""

import json
import logging
from collections.abc import AsyncIterator

from tollms.modules.gateway.adapters.base import BaseProviderAdapter, ChatMessage, StreamChunk

logger = logging.getLogger(__name__)


class AnthropicAdapter(BaseProviderAdapter):
    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        system = "\n".join(m.content for m in messages if m.role == "system")
        rest = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]
        body: dict = {"model": self.model_id, "messages": rest, "stream": True, "max_tokens": 4096}
        if system:
            body["system"] = system
        headers = {
            "x-api-key": self.credentials["api_key"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            async with self._client() as client, client.stream(
                "POST", "https://api.anthropic.com/v1/messages", json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("anthropic error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
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
                            yield StreamChunk(prompt_tokens=usage["input_tokens"])
                    elif etype == "content_block_delta":
                        if (event.get("delta") or {}).get("type") == "text_delta":
                            yield StreamChunk(delta=event["delta"].get("text", ""))
                    elif etype == "message_delta":
                        usage = event.get("usage") or {}
                        if usage.get("output_tokens"):
                            yield StreamChunk(completion_tokens=usage["output_tokens"])
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("anthropic stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
