"""OpenAI chat-completions + responses adapters (+ OpenAI-compatible CUSTOM)."""

import json
import logging
import time
from collections.abc import AsyncIterator

from tollms.modules.gateway.adapters.base import (
    BaseProviderAdapter,
    ChatMessage,
    DiscoveredModel,
    StreamChunk,
    sse_data_lines,
)

logger = logging.getLogger(__name__)


def _parse_chat_sse(payload: str) -> tuple[str, dict]:
    data = json.loads(payload)
    text = ""
    try:
        text = data["choices"][0].get("delta", {}).get("content") or ""
    except (KeyError, IndexError, TypeError):
        pass
    return text, data.get("usage") or {}


class OpenAIChatAdapter(BaseProviderAdapter):
    base_url = "https://api.openai.com/v1"
    endpoint_type = "chat_completions"
    requires_key = True

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.credentials['api_key']}"}

    async def _get_models(self) -> tuple[bool, str, float, list]:
        if self.requires_key and not self.credentials.get("api_key"):
            return False, "api_key is required", 0, []
        start = time.monotonic()
        try:
            async with self._client() as client:
                r = await client.get(f"{self.base_url}/models", headers=self._headers(), timeout=10.0)
            ms = (time.monotonic() - start) * 1000
            if r.status_code >= 400:
                logger.warning("openai models %s: %s", r.status_code, r.text[:200])
                return False, f"provider rejected credentials ({r.status_code})", ms, []
            return True, "credentials valid", ms, r.json().get("data", [])
        except Exception as e:
            logger.exception("openai models request failed")
            return False, f"validation request failed: {e}", (time.monotonic() - start) * 1000, []

    async def validate_credentials(self) -> tuple[bool, str, float]:
        valid, message, ms, _ = await self._get_models()
        return valid, message, ms

    async def discover_models(self) -> list[DiscoveredModel]:
        valid, _, _, data = await self._get_models()
        if not valid:
            return []
        return [
            DiscoveredModel(model_id=m["id"], name=m["id"], endpoint_type=self.endpoint_type)
            for m in data
            if isinstance(m, dict) and m.get("id")
        ]

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        body = {
            "model": self.model_id,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = self._headers()
        try:
            async with self._client() as client, client.stream(
                "POST", f"{self.base_url}/chat/completions", json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("openai chat error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                async for line in resp.aiter_lines():
                    for payload in sse_data_lines(line):
                        try:
                            text, usage = _parse_chat_sse(payload)
                        except json.JSONDecodeError:
                            continue
                        if text or usage:
                            yield StreamChunk(
                                delta=text,
                                prompt_tokens=usage.get("prompt_tokens"),
                                completion_tokens=usage.get("completion_tokens"),
                                total_tokens=usage.get("total_tokens"),
                            )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("openai chat stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class OpenAIResponsesAdapter(OpenAIChatAdapter):
    endpoint_type = "responses"

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        body = {
            "model": self.model_id,
            "input": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {self.credentials['api_key']}"}
        try:
            async with self._client() as client, client.stream(
                "POST", "https://api.openai.com/v1/responses", json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("openai responses error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "response.output_text.delta":
                        yield StreamChunk(delta=event.get("delta", ""))
                    elif event.get("type") == "response.completed":
                        usage = (event.get("response") or {}).get("usage") or {}
                        yield StreamChunk(
                            prompt_tokens=usage.get("input_tokens"),
                            completion_tokens=usage.get("output_tokens"),
                            total_tokens=usage.get("total_tokens"),
                        )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("openai responses stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class CustomAdapter(OpenAIChatAdapter):
    """Any OpenAI-compatible /chat/completions endpoint (vLLM, Ollama, mock servers)."""

    requires_key = False

    def _headers(self) -> dict[str, str]:
        if self.credentials.get("api_key"):
            return {"Authorization": f"Bearer {self.credentials['api_key']}"}
        return {}

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        self.base_url = self.credentials["base_url"].rstrip("/")
        async for chunk in super().chat_stream(messages):
            yield chunk

    async def validate_credentials(self) -> tuple[bool, str, float]:
        if not self.credentials.get("base_url"):
            return False, "base_url is required", 0
        self.base_url = self.credentials["base_url"].rstrip("/")
        return await super().validate_credentials()

    async def discover_models(self) -> list[DiscoveredModel]:
        if not self.credentials.get("base_url"):
            return []
        self.base_url = self.credentials["base_url"].rstrip("/")
        return await super().discover_models()
