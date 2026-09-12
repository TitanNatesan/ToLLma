"""Gemini (API key) + Vertex AI (service account) adapters. Same wire shape."""

import json
import logging
from collections.abc import AsyncIterator

from tollms.modules.gateway.adapters.base import BaseProviderAdapter, ChatMessage, StreamChunk

logger = logging.getLogger(__name__)


def _gemini_body(messages: list[ChatMessage]) -> dict:
    contents = []
    for m in messages:
        role = "user" if m.role in ("user", "system") else "model"
        contents.append({"role": role, "parts": [{"text": m.content}]})
    return {"contents": contents}


def _gemini_text(item: dict) -> str:
    try:
        return item["candidates"][0]["content"]["parts"][0].get("text", "")
    except (KeyError, IndexError, TypeError):
        return ""


class GeminiAdapter(BaseProviderAdapter):
    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_id}"
            f":streamGenerateContent?alt=sse&key={self.credentials['api_key']}"
        )
        try:
            async with self._client() as client, client.stream(
                "POST", url, json=_gemini_body(messages)
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("gemini error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        item = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    text = _gemini_text(item)
                    if text:
                        yield StreamChunk(delta=text)
                    meta = item.get("usageMetadata") or {}
                    if meta.get("totalTokenCount"):
                        yield StreamChunk(
                            prompt_tokens=meta.get("promptTokenCount"),
                            completion_tokens=meta.get("candidatesTokenCount"),
                            total_tokens=meta.get("totalTokenCount"),
                        )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("gemini stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class VertexAdapter(BaseProviderAdapter):
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
                "POST", url, json=_gemini_body(messages), headers={"Authorization": f"Bearer {token}"}
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("vertex error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        item = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    text = _gemini_text(item)
                    if text:
                        yield StreamChunk(delta=text)
                    meta = item.get("usageMetadata") or {}
                    if meta.get("totalTokenCount"):
                        yield StreamChunk(
                            prompt_tokens=meta.get("promptTokenCount"),
                            completion_tokens=meta.get("candidatesTokenCount"),
                            total_tokens=meta.get("totalTokenCount"),
                        )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("vertex stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
