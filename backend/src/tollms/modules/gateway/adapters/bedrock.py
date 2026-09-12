"""Bedrock converse-stream adapter via boto3 (SigV4 handled by the SDK)."""

import asyncio
import logging
from collections.abc import AsyncIterator

from tollms.modules.gateway.adapters.base import BaseProviderAdapter, ChatMessage, StreamChunk

logger = logging.getLogger(__name__)


class BedrockAdapter(BaseProviderAdapter):
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
