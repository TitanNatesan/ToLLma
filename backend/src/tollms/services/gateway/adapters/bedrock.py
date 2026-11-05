"""Bedrock converse-stream adapter via boto3 (SigV4 handled by the SDK)."""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator

from tollms.services.gateway.caching import bedrock_messages, bedrock_system
from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    BaseProviderAdapter,
    ChatMessage,
    DiscoveredModel,
    StreamChunk,
    reasoning_effort,
    thinking_params,
    usage_extras,
)

logger = logging.getLogger(__name__)

# Claude generations that accept ONLY adaptive thinking: manual
# {type: enabled, budget_tokens} returns a 400 ValidationException on these.
# Model-generation routing is a wire-level concern (same as
# resolve_bedrock_model_id); non-Claude families never get thinking fields.
_ADAPTIVE_ONLY = ("sonnet-5", "opus-5", "opus-4-7", "opus-4-8", "mythos", "fable")


def bedrock_thinking_fields(
    model_id: str, level: str | None, max_output_tokens: int | None = None
) -> tuple[dict, int | None] | None:
    """(additionalModelRequestFields, maxTokens) for Claude extended thinking.

    Returns None when thinking is off or the model is not Claude — other
    Bedrock families (DeepSeek, MiniMax, Titan, ...) reject the thinking
    field with a ValidationException. DeepSeek-R1 reasons unconditionally
    without any request fields, which is why it worked before this.
    """
    effort = reasoning_effort(level)
    if effort is None or "anthropic" not in model_id.lower():
        return None
    if any(tag in model_id.lower() for tag in _ADAPTIVE_ONLY):
        return {"thinking": {"type": "adaptive"}, "output_config": {"effort": effort}}, None
    params = thinking_params(level, max_output_tokens)
    if params is None:
        return None
    budget, max_tokens = params
    return {"thinking": {"type": "enabled", "budget_tokens": budget}}, max_tokens


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


def _parse_tool_input(arguments) -> dict:
    """OpenAI-style tool arguments (JSON string) -> Converse toolUse input object."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str) and arguments.strip():
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            logger.warning("bedrock: dropping unparseable tool arguments")
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _converse_tool_choice(value) -> dict | None:
    """Gateway tool_choice -> Converse toolChoice (None = leave provider default)."""
    if value is None:
        return None
    if isinstance(value, str):
        choice = value.strip().lower()
        if choice == "auto":
            return {"auto": {}}
        if choice in ("required", "any"):
            return {"any": {}}
        if choice == "none":
            return None  # no Converse equivalent; _tool_config omits toolConfig
        return {"tool": {"name": value}} if value.strip() else None
    if isinstance(value, dict):
        kind = value.get("type")
        if kind == "auto":
            return {"auto": {}}
        if kind == "any":
            return {"any": {}}
        if kind == "tool":
            name = value.get("name")
            return {"tool": {"name": name}} if name else None
        if kind == "function":
            function = value.get("function") or {}
            name = function.get("name")
            return {"tool": {"name": name}} if name else None
        name = value.get("name")
        if isinstance(name, str) and name:
            return {"tool": {"name": name}}
    return None


def _tool_config(tools: list[dict] | None, tool_choice) -> dict | None:
    """Gateway tool definitions -> Converse toolConfig (None = omit from payload).

    Accepts Anthropic-shaped tools ({name, description, input_schema}) and
    OpenAI-shaped tools ({type: function, function: {name, description,
    parameters}}). tool_choice "none" omits toolConfig entirely — Converse
    has no "none" toolChoice; omitting the field is how tool use is disabled.
    """
    if isinstance(tool_choice, str) and tool_choice.strip().lower() == "none":
        return None
    specs: list[dict] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function")
        if isinstance(function, dict):  # OpenAI chat function-tool shape
            name, description, schema = (
                function.get("name"),
                function.get("description"),
                function.get("parameters"),
            )
        elif tool.get("type") == "function" and isinstance(tool.get("parameters"), dict):
            # OpenAI Responses function-tool shape (parameters at top level)
            name, description, schema = (
                tool.get("name"),
                tool.get("description"),
                tool.get("parameters"),
            )
        else:  # Anthropic custom-tool shape
            name, description, schema = (
                tool.get("name"),
                tool.get("description"),
                tool.get("input_schema"),
            )
        if not name:
            continue
        spec: dict = {"name": name}
        if description:
            spec["description"] = description
        if isinstance(schema, dict):
            spec["inputSchema"] = {"json": schema}
        specs.append({"toolSpec": spec})
    if not specs:
        return None
    config: dict = {"tools": specs}
    choice = _converse_tool_choice(tool_choice)
    if choice is not None:
        config["toolChoice"] = choice
    return config


def _history_tool_names(messages: list[dict]) -> list[str]:
    """Tool names already present in Converse history (toolUse blocks).

    Bedrock requires toolConfig whenever history contains tool blocks, even
    when the current request carries no tool definitions (e.g. a tool_result
    follow-up). Names are returned in first-seen order, deduplicated.
    """
    names: list[str] = []
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            use = block.get("toolUse")
            if isinstance(use, dict) and use.get("name") and use["name"] not in names:
                names.append(use["name"])
    return names


class BedrockAdapter(BaseProviderAdapter):
    endpoint_type = "converse"
    supports_vision = True
    supports_video = True

    IMAGE_FORMATS = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "gif": "gif", "webp": "webp"}
    VIDEO_FORMATS = {"mp4": "mp4", "mov": "mov", "webm": "webm", "mkv": "mkv"}

    def _media_blocks(self, m: ChatMessage) -> list[dict]:
        import base64

        blocks: list[dict] = []
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
        return blocks

    def _blocks(self, m: ChatMessage) -> list[dict]:
        blocks: list[dict] = []
        if m.content:
            blocks.append({"text": m.content})
        blocks.extend(self._media_blocks(m))
        return blocks or [{"text": ""}]

    def _request_message(self, m: ChatMessage) -> dict:
        """One Converse message with toolUse/toolResult blocks preserved."""
        extra = m.extra or {}
        if m.role == "tool":
            result: dict = {
                "toolUseId": extra.get("tool_call_id")
                or extra.get("tool_use_id")
                or extra.get("call_id")
                or "",
                "status": "success",
            }
            if m.content:
                result["content"] = [{"text": m.content}]
            return {"role": "user", "content": [{"toolResult": result}]}
        calls = extra.get("tool_calls") or []
        native = extra.get("blocks") or []
        if not calls and not native:
            return {
                "role": "user" if m.role == "user" else "assistant",
                "content": self._blocks(m),
            }
        blocks: list[dict] = []
        # A text echo of tool_result content alongside the toolResult block
        # breaks Converse adjacency validation (a toolUse must be immediately
        # followed by its toolResult); the result text already travels inside
        # toolResult.content, so the echo is dropped on tool-result messages.
        native_has_result = any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in native
        )
        if m.content and not (native_has_result and m.role != "assistant"):
            blocks.append({"text": m.content})
        blocks.extend(self._media_blocks(m))
        for call in calls:
            function = call.get("function") or {}
            blocks.append({
                "toolUse": {
                    "toolUseId": call.get("id") or "",
                    "name": function.get("name") or "",
                    "input": _parse_tool_input(function.get("arguments")),
                }
            })
        for block in native:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                blocks.append({
                    "toolUse": {
                        "toolUseId": block.get("id") or "",
                        "name": block.get("name") or "",
                        "input": block.get("input")
                        if isinstance(block.get("input"), dict)
                        else {},
                    }
                })
            elif block.get("type") == "tool_result":
                tool_result: dict = {
                    "toolUseId": block.get("tool_use_id") or "",
                    "status": "success",
                }
                if isinstance(block.get("content"), str) and block["content"]:
                    tool_result["content"] = [{"text": block["content"]}]
                blocks.append({"toolResult": tool_result})
        return {
            "role": "user" if m.role == "user" else "assistant",
            "content": blocks or [{"text": ""}],
        }

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

    async def chat_stream(
        self, messages: list[ChatMessage], tools: list[dict] | None = None, tool_choice: dict | str | None = None
    ) -> AsyncIterator[StreamChunk]:
        system = [{"text": m.content} for m in messages if m.role == "system"]
        rest = [self._request_message(m) for m in messages if m.role != "system"]
        resolved_model_id = resolve_bedrock_model_id(self.model_id, self.credentials.get("region", "us-east-1"))
        payload: dict = {"modelId": resolved_model_id, "messages": bedrock_messages(self.prompt_cache, rest)}
        if system:
            payload["system"] = bedrock_system(self.prompt_cache, system)
        tool_config = _tool_config(tools, tool_choice)
        if tool_config is None and not (
            isinstance(tool_choice, str) and tool_choice.strip().lower() == "none"
        ):
            # Follow-up turns carry toolUse/toolResult history but no tool
            # definitions; Converse rejects those without toolConfig. Redeclare
            # the observed tools with a permissive schema — validation passes
            # and re-invocation stays possible; never silently dropped.
            # ponytail: permissive {"type":"object"} schema; tighten by caching
            # original definitions per conversation if fidelity matters.
            names = _history_tool_names(rest)
            if names:
                tool_config = {
                    "tools": [
                        {"toolSpec": {"name": n, "inputSchema": {"json": {"type": "object"}}}}
                        for n in names
                    ]
                }
        if tool_config is not None:
            payload["toolConfig"] = tool_config
        thinking = bedrock_thinking_fields(
            resolved_model_id, self.reasoning_level, self.max_output_tokens
        )
        if thinking is not None:
            # Claude only streams reasoningContent when thinking is requested.
            fields, max_tokens = thinking
            payload["additionalModelRequestFields"] = fields
            if max_tokens is not None:
                payload["inferenceConfig"] = {"maxTokens": max_tokens}
            logger.info(
                "bedrock thinking enabled for %s: %s", resolved_model_id, fields.get("thinking"),
            )
        try:
            stream = await asyncio.to_thread(self._stream_events, payload)
            in_reasoning = False
            has_text = False
            has_tool_use = False
            tool_ids: dict = {}
            for event in stream:
                if "contentBlockStart" in event:
                    start = event["contentBlockStart"].get("start") or {}
                    tool_use = start.get("toolUse") or {}
                    if tool_use:
                        index = event["contentBlockStart"].get("contentBlockIndex")
                        tool_ids[index] = tool_use.get("toolUseId") or ""
                        has_tool_use = True
                        yield StreamChunk(tool_call_delta={
                            "index": index,
                            "id": tool_use.get("toolUseId") or "",
                            "name": tool_use.get("name") or "",
                            "arguments_delta": "",
                        })
                elif "contentBlockDelta" in event:
                    delta_obj = event["contentBlockDelta"].get("delta") or {}
                    tool_use = delta_obj.get("toolUse") or {}
                    fragment = tool_use.get("input")
                    reasoning_content = delta_obj.get("reasoningContent") or {}
                    # Signature deltas carry integrity tokens, not displayable
                    # text; redacted blocks are replaced with a placeholder.
                    reasoning = reasoning_content.get("text") or (
                        "(Thinking redacted by the provider)"
                        if reasoning_content.get("redactedContent")
                        else None
                    )
                    text = delta_obj.get("text")
                    if fragment:
                        index = event["contentBlockDelta"].get("contentBlockIndex")
                        has_tool_use = True
                        yield StreamChunk(tool_call_delta={
                            "index": index,
                            "id": tool_ids.get(index, ""),
                            "arguments_delta": fragment,
                        })
                    elif reasoning:
                        if not in_reasoning:
                            yield StreamChunk(delta=THINK_OPEN)
                            in_reasoning = True
                        yield StreamChunk(delta=reasoning)
                    elif text:
                        if in_reasoning:
                            yield StreamChunk(delta=THINK_CLOSE)
                            in_reasoning = False
                        has_text = True
                        yield StreamChunk(delta=text)
                elif "contentBlockStop" in event:
                    if in_reasoning:
                        yield StreamChunk(delta=THINK_CLOSE)
                        in_reasoning = False
                elif "messageStop" in event:
                    stop_reason = event["messageStop"].get("stopReason")
                    if stop_reason:
                        yield StreamChunk(finish_reason=stop_reason)
                elif "modelStreamErrorException" in event:
                    # Bedrock delivers model output errors as stream events
                    err_detail = event["modelStreamErrorException"].get("message", "")
                    logger.warning("bedrock modelStreamErrorException for %s: %s", resolved_model_id, err_detail)
                    if "model output must contain either output text or tool calls" in err_detail:
                        if not has_text and not has_tool_use:
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
                        extras = usage_extras(usage)
                        yield StreamChunk(
                            prompt_tokens=usage.get("inputTokens"),
                            completion_tokens=usage.get("outputTokens"),
                            total_tokens=usage.get("totalTokens"),
                            cache_read_tokens=extras["cache_read_tokens"],
                            cache_write_tokens=extras["cache_write_tokens"],
                        )
            if in_reasoning:
                yield StreamChunk(delta=THINK_CLOSE)
            # If only reasoning was produced with no answer text and no tool
            # calls, emit a notice so the conversation record is non-empty and
            # the user gets meaningful feedback.
            if not has_text and not has_tool_use:
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
