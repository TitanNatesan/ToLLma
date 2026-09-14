"""Bedrock converse-stream adapter via boto3 (SigV4 handled by the SDK)."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from tollms.services.gateway.adapters.base import BaseProviderAdapter, ChatMessage, DiscoveredModel, StreamChunk

logger = logging.getLogger(__name__)


def resolve_bedrock_model_id(model_id: str, region: str) -> str:
    """Normalize model ID for AWS Bedrock, ensuring cross-region inference profiles are used where required."""
    # Strip framework prefixes such as 'bedrock/'
    if model_id.startswith("bedrock/"):
        model_id = model_id[len("bedrock/"):]

    # If already prefixed with a cross-region routing prefix, return as is
    if any(model_id.startswith(p) for p in ("us.", "eu.", "apac.", "global.", "crce.")):
        return model_id

    reg = region.lower()
    prefix = "us" if reg.startswith("us-") else ("eu" if reg.startswith("eu-") else ("apac" if reg.startswith("ap-") else "us"))

    # Models that require an inference profile for on-demand invocation
    if model_id.startswith("anthropic.claude-") or model_id.startswith("deepseek."):
        return f"{prefix}.{model_id}"

    return model_id


class BedrockAdapter(BaseProviderAdapter):
    endpoint_type = "converse"
    supports_vision = True
    supports_video = True

    IMAGE_FORMATS = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "gif": "gif", "webp": "webp"}
    VIDEO_FORMATS = {"mp4": "mp4", "mov": "mov", "webm": "webm", "mkv": "mkv"}

    def _blocks(self, m: ChatMessage) -> list[dict]:
        import base64

        blocks: list[dict] = []
        if m.content:
            blocks.append({"text": m.content})
        for part in m.media:
            raw = base64.b64decode(part.data_b64)
            if part.kind == "image":
                ext = (part.filename.rsplit(".", 1)[-1] if "." in part.filename else "").lower()
                fmt = self.IMAGE_FORMATS.get(ext)
                if fmt is None:
                    raise ValueError(f"bedrock converse does not accept .{ext or '?'} images")
                blocks.append({"image": {"format": fmt, "source": {"bytes": raw}}})
            elif part.kind == "video":
                ext = (part.filename.rsplit(".", 1)[-1] if "." in part.filename else "").lower()
                fmt = self.VIDEO_FORMATS.get(ext)
                if fmt is None:
                    raise ValueError(f"bedrock converse does not accept .{ext or '?'} video")
                blocks.append({"video": {"format": fmt, "source": {"bytes": raw}}})
        return blocks or [{"text": ""}]

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
            mgmt = self._mgmt_client()
            models_res = await asyncio.to_thread(mgmt.list_foundation_models)
            profiles_res = await asyncio.to_thread(mgmt.list_inference_profiles)

            discovered: dict[str, DiscoveredModel] = {}

            # 1. Active cross-region inference profiles (supported for on-demand converse)
            for p in profiles_res.get("inferenceProfileSummaries", []):
                if p.get("status") == "ACTIVE" and p.get("inferenceProfileId"):
                    pid = p["inferenceProfileId"]
                    name = p.get("inferenceProfileName", pid)
                    discovered[pid] = DiscoveredModel(
                        model_id=pid,
                        name=name,
                        endpoint_type=self.endpoint_type,
                    )

            # 2. Foundation models
            for s in models_res.get("modelSummaries", []):
                mid = s.get("modelId")
                if mid and mid not in discovered:
                    discovered[mid] = DiscoveredModel(
                        model_id=mid,
                        name=s.get("modelName", mid),
                        endpoint_type=self.endpoint_type,
                    )

            return list(discovered.values())
        except Exception:
            logger.exception("bedrock discovery failed")
            return []

    def _stream_events(self, payload: dict):
        import boto3
        from botocore.exceptions import ClientError

        client = boto3.client(
            "bedrock-runtime",
            aws_access_key_id=self.credentials["access_key"],
            aws_secret_access_key=self.credentials["secret_key"],
            region_name=self.credentials["region"],
        )
        try:
            return client.converse_stream(**payload)["stream"]
        except ClientError as e:
            msg = str(e)
            if "on-demand throughput isn't supported" in msg or "inference profile" in msg:
                reg = self.credentials.get("region", "us-east-1").lower()
                prefix = "us" if reg.startswith("us-") else ("eu" if reg.startswith("eu-") else ("apac" if reg.startswith("ap-") else "us"))
                cur_id = payload.get("modelId", "")
                if not any(cur_id.startswith(p) for p in ("us.", "eu.", "apac.", "global.", "crce.")):
                    retry_id = f"{prefix}.{cur_id}"
                    logger.info("Retrying Bedrock converse_stream with inference profile %s", retry_id)
                    retry_payload = {**payload, "modelId": retry_id}
                    return client.converse_stream(**retry_payload)["stream"]
            raise

    async def chat_stream(self, messages: list[ChatMessage]) -> AsyncIterator[StreamChunk]:
        system = [{"text": m.content} for m in messages if m.role == "system"]
        rest = [
            {"role": "user" if m.role == "user" else "assistant", "content": self._blocks(m)}
            for m in messages
            if m.role != "system"
        ]
        resolved_model_id = resolve_bedrock_model_id(self.model_id, self.credentials.get("region", "us-east-1"))
        payload: dict = {"modelId": resolved_model_id, "messages": rest}
        if system:
            payload["system"] = system
        try:
            stream = await asyncio.to_thread(self._stream_events, payload)
            in_reasoning = False
            has_text = False
            for event in stream:
                if "contentBlockDelta" in event:
                    delta_obj = event["contentBlockDelta"].get("delta") or {}
                    reasoning = (delta_obj.get("reasoningContent") or {}).get("text")
                    text = delta_obj.get("text")
                    if reasoning:
                        if not in_reasoning:
                            yield StreamChunk(delta="<think>\n")
                            in_reasoning = True
                        yield StreamChunk(delta=reasoning)
                    elif text:
                        if in_reasoning:
                            yield StreamChunk(delta="\n</think>\n\n")
                            in_reasoning = False
                        has_text = True
                        yield StreamChunk(delta=text)
                elif "contentBlockStop" in event:
                    if in_reasoning:
                        yield StreamChunk(delta="\n</think>\n\n")
                        in_reasoning = False
                elif "modelStreamErrorException" in event:
                    # Bedrock delivers model output errors as stream events
                    err_detail = event["modelStreamErrorException"].get("message", "")
                    logger.warning("bedrock modelStreamErrorException for %s: %s", resolved_model_id, err_detail)
                    if "model output must contain either output text or tool calls" in err_detail:
                        if not has_text:
                            yield StreamChunk(
                                delta="*(The model completed its reasoning phase but produced no final answer text. "
                                      "This can happen with extended thinking models. Please try regenerating your message.)*"
                            )
                        return
                    raise RuntimeError(f"stream error from Bedrock: {err_detail}")
                elif "internalServerException" in event:
                    err_detail = event["internalServerException"].get("message", "")
                    logger.error("bedrock internalServerException for %s: %s", resolved_model_id, err_detail)
                    raise RuntimeError(f"Bedrock internal error: {err_detail}")
                elif "metadata" in event:
                    usage = event["metadata"].get("usage") or {}
                    if usage.get("totalTokens"):
                        yield StreamChunk(
                            prompt_tokens=usage.get("inputTokens"),
                            completion_tokens=usage.get("outputTokens"),
                            total_tokens=usage.get("totalTokens"),
                        )
            if in_reasoning:
                yield StreamChunk(delta="\n</think>\n\n")
            # If only reasoning was produced with no answer text, emit a notice so the
            # conversation record is non-empty and the user gets meaningful feedback.
            if not has_text:
                logger.warning("bedrock model %s produced only reasoning content with no answer text", resolved_model_id)
                yield StreamChunk(delta="\n\n*(The model completed its reasoning but did not produce a final answer. Try regenerating or simplify your request.)*")
        except Exception as e:
            err_msg = str(e)
            # Bedrock ValidationException: model produced empty output (reasoning-only response)
            if "model output must contain either output text or tool calls" in err_msg:
                logger.warning(
                    "bedrock model %s returned empty output (reasoning-only): %s",
                    resolved_model_id,
                    err_msg,
                )
                yield StreamChunk(
                    delta="*(The model completed its reasoning phase but produced no final answer text. "
                          "This can happen with extended thinking models. Please try regenerating your message.)*"
                )
                return
            logger.exception("bedrock stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e
