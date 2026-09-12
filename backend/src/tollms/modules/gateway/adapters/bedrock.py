"""Bedrock converse-stream adapter via boto3 (SigV4 handled by the SDK)."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from tollms.modules.gateway.adapters.base import BaseProviderAdapter, ChatMessage, DiscoveredModel, StreamChunk

logger = logging.getLogger(__name__)


class BedrockAdapter(BaseProviderAdapter):
    endpoint_type = "converse"

    def _check_config(self) -> str | None:
        missing = [k for k in ("access_key", "secret_key", "region") if not self.credentials.get(k)]
        if missing:
            return f"missing fields: {', '.join(missing)}"
        return None

    def _mgmt_client(self):
        import boto3

        return boto3.client(
            "bedrock",
            aws_access_key_id=self.credentials["access_key"],
            aws_secret_access_key=self.credentials["secret_key"],
            region_name=self.credentials["region"],
        )

    async def validate_credentials(self) -> tuple[bool, str, float]:
        if (err := self._check_config()) is not None:
            return False, err, 0
        start = time.monotonic()
        try:
            await asyncio.to_thread(self._mgmt_client().list_foundation_models)
            return True, "credentials valid", (time.monotonic() - start) * 1000
        except Exception as e:
            logger.exception("bedrock validation failed")
            return False, f"bedrock rejected credentials: {e}", (time.monotonic() - start) * 1000

    async def discover_models(self) -> list[DiscoveredModel]:
        if self._check_config() is not None:
            return []
        try:
            resp = await asyncio.to_thread(self._mgmt_client().list_foundation_models)
            return [
                DiscoveredModel(model_id=s["modelId"], name=s.get("modelName", s["modelId"]), endpoint_type=self.endpoint_type)
                for s in resp.get("modelSummaries", [])
                if s.get("modelId")
            ]
        except Exception:
            logger.exception("bedrock discovery failed")
            return []
    def _stream_events(self, payload: dict):
        import boto3

        client = boto3.client(
            "bedrock-runtime",
            aws_access_key_id=self.credentials["access_key"],
            aws_secret_access_key=self.credentials["secret_key"],
            region_name=self.credentials["region"],
        )
        return client.converse_stream(**payload)["stream"]

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        system = [{"text": m.content} for m in messages if m.role == "system"]
        rest = [{"role": "user" if m.role == "user" else "assistant", "content": [{"text": m.content}]} for m in messages if m.role != "system"]
        payload: dict = {"modelId": self.model_id, "messages": rest}
        if system:
            payload["system"] = system
        try:
            stream = await asyncio.to_thread(self._stream_events, payload)
            for event in stream:
                if "contentBlockDelta" in event:
                    text = (event["contentBlockDelta"].get("delta") or {}).get("text", "")
                    if text:
                        yield StreamChunk(delta=text)
                elif "metadata" in event:
                    usage = (event["metadata"].get("usage")) or {}
                    if usage.get("totalTokens"):
                        yield StreamChunk(
                            prompt_tokens=usage.get("inputTokens"),
                            completion_tokens=usage.get("outputTokens"),
                            total_tokens=usage.get("totalTokens"),
                        )
        except Exception as e:
            logger.exception("bedrock stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
