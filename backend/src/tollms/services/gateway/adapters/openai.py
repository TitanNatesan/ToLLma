"""OpenAI chat-completions + responses adapters (+ OpenAI-compatible CUSTOM)."""

import json
import logging
import time
from collections.abc import AsyncIterator

from tollms.services.gateway.adapters.base import (
    BaseProviderAdapter,
    ChatMessage,
    DiscoveredModel,
    StreamChunk,
    sse_data_lines,
    usage_extras,
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
    supports_vision = True
    supports_audio = True

    def _content(self, m: ChatMessage):
        """Text stays a string; media becomes OpenAI content parts."""
        if not m.media:
            return m.content
        parts: list[dict] = []
        if m.content:
            parts.append({"type": "text", "text": m.content})
        for part in m.media:
            if part.kind == "image":
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{part.mime_type};base64,{part.data_b64}"},
                })
            elif part.kind == "audio":
                fmt = "wav" if "wav" in part.mime_type else "mp3"
                parts.append({"type": "input_audio", "input_audio": {"data": part.data_b64, "format": fmt}})
        return parts or m.content

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
            "messages": [{"role": m.role, "content": self._content(m)} for m in messages],
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
                            extras = usage_extras(usage)
                            yield StreamChunk(
                                delta=text,
                                prompt_tokens=usage.get("prompt_tokens"),
                                completion_tokens=usage.get("completion_tokens"),
                                total_tokens=usage.get("total_tokens"),
                                cache_read_tokens=extras["cache_read_tokens"],
                                reasoning_tokens=extras["reasoning_tokens"],
                            )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("openai chat stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class OpenAIResponsesAdapter(OpenAIChatAdapter):
    endpoint_type = "responses"
    supports_audio = False  # audio reaches responses models as transcripts

    def _content(self, m: ChatMessage):
        if not m.media:
            return m.content
        parts: list[dict] = []
        if m.content:
            parts.append({"type": "input_text", "text": m.content})
        for part in m.media:
            if part.kind == "image":
                parts.append({
                    "type": "input_image",
                    "image_url": f"data:{part.mime_type};base64,{part.data_b64}",
                })
        return parts or m.content

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        body = {
            "model": self.model_id,
            "input": [{"role": m.role, "content": self._content(m)} for m in messages],
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
                        extras = usage_extras(usage)
                        yield StreamChunk(
                            prompt_tokens=usage.get("input_tokens"),
                            completion_tokens=usage.get("output_tokens"),
                            total_tokens=usage.get("total_tokens"),
                            cache_read_tokens=extras["cache_read_tokens"],
                            reasoning_tokens=extras["reasoning_tokens"],
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
        headers: dict[str, str] = {}
        if self.credentials.get("api_key"):
            headers["Authorization"] = f"Bearer {self.credentials['api_key']}"
        extra = self.credentials.get("extra_headers") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except json.JSONDecodeError:
                logger.warning("custom provider: extra_headers is not valid JSON, ignoring")
                extra = {}
        if isinstance(extra, dict):
            headers.update({str(k): str(v) for k, v in extra.items()})
        return headers

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
