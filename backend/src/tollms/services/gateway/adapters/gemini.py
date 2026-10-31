"""Gemini (API key) + Vertex AI (service account) adapters. Same wire shape."""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator

from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    BaseProviderAdapter,
    ChatMessage,
    DiscoveredModel,
    StreamChunk,
    thinking_budget,
    usage_extras,
)

logger = logging.getLogger(__name__)


def _gemini_parts(m: ChatMessage) -> list[dict]:
    parts: list[dict] = []
    if m.content:
        parts.append({"text": m.content})
    for part in m.media:
        if part.kind in ("image", "audio", "video"):
            parts.append({"inline_data": {"mime_type": part.mime_type, "data": part.data_b64}})
    return parts or [{"text": ""}]


def _gemini_body(
    messages: list[ChatMessage], *, image_output: bool = False, reasoning_level: str | None = None
) -> dict:
    contents = []
    for m in messages:
        role = "user" if m.role in ("user", "system") else "model"
        contents.append({"role": role, "parts": _gemini_parts(m)})
    body: dict = {"contents": contents}
    generation_config: dict = {}
    if image_output:
        # Image-capable models (nano-banana / gemini-*-image*) default to
        # text-only responses; ask for both so inlineData parts flow back
        # through the existing image extraction below. Image models reject
        # thinkingConfig, so it is never combined with responseModalities.
        generation_config["responseModalities"] = ["TEXT", "IMAGE"]
    elif (budget := thinking_budget(reasoning_level)) is not None:
        # Thinking models emit thought:true parts (split out by
        # _gemini_thought_and_text); without a budget they stay silent, so
        # thought content only renders when a level maps to a budget here.
        generation_config["thinkingConfig"] = {"thinkingBudget": budget}
    if generation_config:
        body["generationConfig"] = generation_config
    return body


def _gemini_text(item: dict) -> str:
    try:
        return item["candidates"][0]["content"]["parts"][0].get("text", "")
    except (KeyError, IndexError, TypeError):
        return ""


def _gemini_thought_and_text(item: dict) -> tuple[str, str]:
    """Split a response chunk into (thought text, answer text).

    Thinking models mark reasoning parts with thought:true (thought
    signatures carry no text and are skipped). Unknown future part shapes
    with text default to answer text — never silently dropped.
    """
    thought: list[str] = []
    answer: list[str] = []
    try:
        parts = item["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return "", ""
    if not isinstance(parts, list):
        return "", ""
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text") or ""
        if not text:
            continue
        (thought if part.get("thought") is True else answer).append(text)
    return "".join(thought), "".join(answer)


# Cap on accumulated inline image base64 per response (~20MB b64 ~= 15MB raw).
MAX_INLINE_IMAGES_B64 = 20 * 1024 * 1024


def _gemini_images(item: dict) -> list[dict]:
    """Image parts from one response chunk. Never raises."""
    try:
        parts = item["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return []
    if not isinstance(parts, list):
        return []
    out: list[dict] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        inline = part.get("inlineData") or part.get("inline_data")
        if not isinstance(inline, dict):
            continue
        mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
        data = inline.get("data") or ""
        if not data:
            continue
        out.append({"mime_type": str(mime), "data_b64": str(data)})
    return out


def _capped_images(item: dict, state: dict) -> list[dict]:
    """Images from one chunk, enforcing the per-response b64 cap."""
    images = _gemini_images(item)
    if not images:
        return []
    out: list[dict] = []
    for img in images:
        size = len(img.get("data_b64") or "")
        if state["total"] + size > MAX_INLINE_IMAGES_B64:
            if not state["capped"]:
                logger.warning(
                    "gemini inline images exceed %d bytes, dropping remainder",
                    MAX_INLINE_IMAGES_B64,
                )
                state["capped"] = True
            continue
        state["total"] += size
        out.append(img)
    return out


class GeminiAdapter(BaseProviderAdapter):
    endpoint_type = "chat_completions"
    supports_vision = True
    supports_audio = True
    supports_video = True

    async def validate_credentials(self) -> tuple[bool, str, float]:
        if not self.credentials.get("api_key"):
            return False, "api_key is required", 0
        start = time.monotonic()
        try:
            async with self._client() as client:
                r = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={self.credentials['api_key']}",
                    timeout=10.0,
                )
            ms = (time.monotonic() - start) * 1000
            if r.status_code >= 400:
                logger.warning("gemini models %s: %s", r.status_code, r.text[:200])
                return False, f"provider rejected credentials ({r.status_code})", ms
            return True, "credentials valid", ms
        except Exception as e:
            logger.exception("gemini models request failed")
            return False, f"validation request failed: {e}", (time.monotonic() - start) * 1000

    async def discover_models(self) -> list[DiscoveredModel]:
        if not self.credentials.get("api_key"):
            return []
        try:
            async with self._client() as client:
                r = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={self.credentials['api_key']}",
                    timeout=10.0,
                )
            if r.status_code >= 400:
                return []
            out = []
            for m in r.json().get("models", []):
                name = m.get("name", "").removeprefix("models/")
                if name:
                    out.append(DiscoveredModel(model_id=name, name=m.get("displayName", name), endpoint_type=self.endpoint_type))
            return out
        except Exception:
            logger.exception("gemini discovery failed")
            return []
    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        # Text-only by design: Gemini function calling (tools/functionCall
        # parts) is not mapped yet, so the gateway never forwards tools here.
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_id}"
            f":streamGenerateContent?alt=sse&key={self.credentials['api_key']}"
        )
        try:
            async with self._client() as client, client.stream(
                "POST", url, json=_gemini_body(
                    messages, image_output=self.image_output, reasoning_level=self.reasoning_level
                )
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("gemini error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                in_reasoning = False
                _img_state = {"total": 0, "capped": False}
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        item = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    thought, text = _gemini_thought_and_text(item)
                    if thought:
                        if not in_reasoning:
                            yield StreamChunk(delta=THINK_OPEN)
                            in_reasoning = True
                        yield StreamChunk(delta=thought)
                    if text:
                        if in_reasoning:
                            yield StreamChunk(delta=THINK_CLOSE)
                            in_reasoning = False
                        yield StreamChunk(delta=text)
                    for img in _capped_images(item, _img_state):
                        yield StreamChunk(delta="", images=[img])
                    meta = item.get("usageMetadata") or {}
                    if meta.get("totalTokenCount"):
                        extras = usage_extras(meta)
                        yield StreamChunk(
                            prompt_tokens=meta.get("promptTokenCount"),
                            completion_tokens=meta.get("candidatesTokenCount"),
                            total_tokens=meta.get("totalTokenCount"),
                            cache_read_tokens=extras["cache_read_tokens"],
                            cache_write_tokens=extras["cache_write_tokens"],
                            reasoning_tokens=extras["reasoning_tokens"],
                        )
                if in_reasoning:
                    yield StreamChunk(delta=THINK_CLOSE)
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("gemini stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class VertexAdapter(BaseProviderAdapter):
    endpoint_type = "chat_completions"
    supports_vision = True
    supports_audio = True
    supports_video = True

    def _check_config(self) -> str | None:
        missing = [k for k in ("project_id", "location", "credentials_json") if not self.credentials.get(k)]
        if missing:
            return f"missing fields: {', '.join(missing)}"
        try:
            info = json.loads(self.credentials["credentials_json"])
            if info.get("type") != "service-account" or not info.get("private_key"):
                return "credentials_json is not a service-account key"
        except json.JSONDecodeError:
            return "credentials_json is not valid JSON"
        return None

    def _publisher_url(self, suffix: str) -> str:
        project = self.credentials["project_id"]
        location = self.credentials.get("location", "us-central1")
        return (
            f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{location}/publishers/google/{suffix}"
        )

    async def validate_credentials(self) -> tuple[bool, str, float]:
        if (err := self._check_config()) is not None:
            return False, err, 0
        start = time.monotonic()
        try:
            token = await asyncio.to_thread(self._access_token)
            async with self._client() as client:
                r = await client.get(
                    self._publisher_url("models"),
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10.0,
                )
            ms = (time.monotonic() - start) * 1000
            if r.status_code >= 400:
                logger.warning("vertex models %s: %s", r.status_code, r.text[:200])
                return False, f"provider rejected credentials ({r.status_code})", ms
            return True, "credentials valid", ms
        except Exception as e:
            logger.exception("vertex validation failed")
            return False, f"validation request failed: {e}", (time.monotonic() - start) * 1000

    async def discover_models(self) -> list[DiscoveredModel]:
        if self._check_config() is not None:
            return []
        try:
            token = await asyncio.to_thread(self._access_token)
            async with self._client() as client:
                r = await client.get(
                    self._publisher_url("models"),
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10.0,
                )
            if r.status_code >= 400:
                return []
            out = []
            for m in r.json().get("models", []):
                name = (m.get("name") or "").split("/")[-1]
                if name:
                    out.append(DiscoveredModel(model_id=name, name=m.get("displayName", name), endpoint_type=self.endpoint_type))
            return out
        except Exception:
            logger.exception("vertex discovery failed")
            return []
    def _access_token(self) -> str:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        info = json.loads(self.credentials["credentials_json"])
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        creds.refresh(Request())
        if not creds.token:
            raise RuntimeError("vertex: failed to obtain access token")
        return creds.token

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        # Text-only by design, same as GeminiAdapter above: tools are not forwarded.
        project = self.credentials["project_id"]
        location = self.credentials.get("location", "us-central1")
        url = (
            f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{location}/publishers/google/models/{self.model_id}:streamGenerateContent?alt=sse"
        )
        try:
            token = self._access_token()
        except Exception as e:
            logger.exception("vertex auth failed")
            raise RuntimeError(f"vertex auth failed: {e}") from e
        try:
            async with self._client() as client, client.stream(
                "POST",
                url,
                json=_gemini_body(
                    messages, image_output=self.image_output, reasoning_level=self.reasoning_level
                ),
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("vertex error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                in_reasoning = False
                _img_state = {"total": 0, "capped": False}
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        item = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    thought, text = _gemini_thought_and_text(item)
                    if thought:
                        if not in_reasoning:
                            yield StreamChunk(delta=THINK_OPEN)
                            in_reasoning = True
                        yield StreamChunk(delta=thought)
                    if text:
                        if in_reasoning:
                            yield StreamChunk(delta=THINK_CLOSE)
                            in_reasoning = False
                        yield StreamChunk(delta=text)
                    for img in _capped_images(item, _img_state):
                        yield StreamChunk(delta="", images=[img])
                    meta = item.get("usageMetadata") or {}
                    if meta.get("totalTokenCount"):
                        extras = usage_extras(meta)
                        yield StreamChunk(
                            prompt_tokens=meta.get("promptTokenCount"),
                            completion_tokens=meta.get("candidatesTokenCount"),
                            total_tokens=meta.get("totalTokenCount"),
                            cache_read_tokens=extras["cache_read_tokens"],
                            cache_write_tokens=extras["cache_write_tokens"],
                            reasoning_tokens=extras["reasoning_tokens"],
                        )
                if in_reasoning:
                    yield StreamChunk(delta=THINK_CLOSE)
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("vertex stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
