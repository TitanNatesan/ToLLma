"""OpenAI chat-completions + responses adapters (+ OpenAI-compatible CUSTOM)."""

import json
import logging
from collections.abc import AsyncIterator

from tollms.modules.gateway.adapters.base import BaseProviderAdapter, ChatMessage, StreamChunk, sse_data_lines

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

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        body = {
            "model": self.model_id,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        headers = {"Authorization": f"Bearer {self.credentials['api_key']}"}
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


class OpenAIResponsesAdapter(BaseProviderAdapter):
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

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        self.base_url = self.credentials["base_url"].rstrip("/")
        headers: dict[str, str] = {}
        if self.credentials.get("api_key"):
            headers = {"Authorization": f"Bearer {self.credentials['api_key']}"}
        # Reuse chat-completions streaming against the custom base URL.
        body = {
            "model": self.model_id,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        try:
            async with self._client() as client, client.stream(
                "POST", f"{self.base_url}/chat/completions", json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("custom provider error %s: %s", resp.status_code, detail)
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
            logger.exception("custom provider stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
