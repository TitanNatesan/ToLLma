"""Anthropic messages adapter (SSE streaming)."""

import json
import logging
import time
from collections.abc import AsyncIterator

from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatMessage, DiscoveredModel, StreamChunk, usage_extras

logger = logging.getLogger(__name__)


class AnthropicAdapter(BaseProviderAdapter):
    endpoint_type = "messages"

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

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        system = "\n".join(m.content for m in messages if m.role == "system")
        rest = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]
        body: dict = {"model": self.model_id, "messages": rest, "stream": True, "max_tokens": 4096}
        if system:
            body["system"] = system
        headers = self._headers()
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
                            extras = usage_extras(usage)
                            yield StreamChunk(
                                prompt_tokens=usage["input_tokens"],
                                cache_read_tokens=extras["cache_read_tokens"],
                                cache_write_tokens=extras["cache_write_tokens"],
                            )
                    elif etype == "content_block_delta":
                        if (event.get("delta") or {}).get("type") == "text_delta":
                            yield StreamChunk(delta=event["delta"].get("text", ""))
                    elif etype == "message_delta":
                        usage = event.get("usage") or {}
                        if usage.get("output_tokens"):
                            extras = usage_extras(usage)
                            yield StreamChunk(
                                completion_tokens=usage["output_tokens"],
                                reasoning_tokens=extras["reasoning_tokens"],
                            )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("anthropic stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
