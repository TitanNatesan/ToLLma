"""OpenAI family adapters: one provider, one adapter per endpoint.

`OpenAI` (and the OpenAI-compatible `CUSTOM` gateway) share these classes:
the endpoint always comes from the model (`responses`, `chat_completions`,
`embeddings`, `images/generations`, `audio/*`), never from the provider type.
A `base_url` credential makes any of them an OpenAI-compatible gateway.
"""

import asyncio
import base64
import io
import json
import logging
import time
from collections.abc import AsyncIterator

import httpx

from tollms.services.gateway.caching import openai_params
from tollms.services.gateway.adapters.base import (
    THINK_CLOSE,
    THINK_OPEN,
    BaseProviderAdapter,
    ChatMessage,
    DiscoveredModel,
    StreamChunk,
    reasoning_effort,
    sse_data_lines,
    usage_extras,
)

logger = logging.getLogger(__name__)


def _reasoning_text(delta: dict) -> str:
    """Reasoning text across OpenAI-compatible surfaces.

    - reasoning_content: DeepSeek native, LiteLLM, many gateways
    - reasoning: OpenRouter legacy / various proxies
    - reasoning_details: OpenRouter normalized entries — reasoning.text and
      reasoning.summary carry text; reasoning.encrypted carries opaque data
      (not displayable) and is skipped.
    """
    out: list[str] = []
    for key in ("reasoning_content", "reasoning"):
        value = delta.get(key)
        if isinstance(value, str) and value:
            out.append(value)
    details = delta.get("reasoning_details")
    if isinstance(details, list):
        for item in details:
            if not isinstance(item, dict):
                continue
            text = item.get("text") or item.get("summary")
            if isinstance(text, str) and text:
                out.append(text)
    return "".join(out)


def _parse_chat_sse(payload: str) -> tuple[str, str, dict, list, str | None]:
    """(answer text, reasoning text, usage, tool deltas, finish reason)."""
    data = json.loads(payload)
    text = ""
    reasoning = ""
    tool_deltas: list = []
    finish_reason: str | None = None
    try:
        choice = data["choices"][0]
        delta = choice.get("delta", {})
        text = delta.get("content") or ""
        reasoning = _reasoning_text(delta)
        for call in delta.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            function = call.get("function") or {}
            tool_deltas.append({
                "index": call.get("index"),
                "id": call.get("id") or "",
                "name": function.get("name") or "",
                "arguments_delta": function.get("arguments") or "",
            })
        finish_reason = choice.get("finish_reason")
    except (KeyError, IndexError, TypeError):
        pass
    return text, reasoning, data.get("usage") or {}, tool_deltas, finish_reason


async def _with_transport_retries(call, *, attempts: int = 3, base_delay: float = 1.5):
    """Run an HTTP call, retrying transient transport/DNS failures.

    Long-lived jobs (video polling) make dozens of requests; a single
    getaddrinfo hiccup must not kill an otherwise healthy generation.
    """
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await call()
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last = exc
            logger.warning("openai transient transport error (attempt %s/%s): %s", attempt, attempts, exc)
            if attempt < attempts:
                await asyncio.sleep(base_delay * attempt)
    assert last is not None
    raise last


def _match_reference_size(image: bytes, size: str) -> tuple[bytes, bool]:
    """Cover-crop + resize a reference image to the requested WxH.

    The Videos API rejects references whose dimensions differ from `size`;
    returns (bytes, changed).
    """
    try:
        from PIL import Image
    except ImportError:  # pillow optional at runtime
        return image, False
    try:
        width, height = (int(part) for part in size.lower().split("x", 1))
    except (ValueError, AttributeError):
        return image, False
    if width <= 0 or height <= 0:
        return image, False
    try:
        with Image.open(io.BytesIO(image)) as source:
            frame = source.convert("RGB")
            if frame.size == (width, height):
                return image, False
            scale = max(width / frame.width, height / frame.height)
            resized = frame.resize(
                (max(1, round(frame.width * scale)), max(1, round(frame.height * scale)))
            )
            left = (resized.width - width) // 2
            top = (resized.height - height) // 2
            cropped = resized.crop((left, top, left + width, top + height))
            buffer = io.BytesIO()
            cropped.save(buffer, format="PNG")
            return buffer.getvalue(), True
    except Exception:
        logger.warning("reference image normalization failed; sending as-is", exc_info=True)
        return image, False


class OpenAIBaseAdapter(BaseProviderAdapter):
    """Shared OpenAI wire plumbing: base URL, auth headers, model discovery."""

    base_url = "https://api.openai.com/v1"
    endpoint = "chat_completions"
    endpoint_type = "chat_completions"  # legacy mirror used by discovery
    supported_endpoints = frozenset({"chat_completions"})
    requires_key = True
    supports_vision = True
    supports_audio = True

    def _base_url(self) -> str:
        override = self.credentials.get("base_url")
        if isinstance(override, str) and override.strip():
            return override.strip().rstrip("/")
        return self.base_url.rstrip("/")

    def _is_compatible_gateway(self) -> bool:
        """A base_url override marks an OpenAI-compatible deployment.

        Gateways (Ollama, vLLM, LiteLLM, Azure-compatible proxies) authenticate
        by other means, so an API key is optional there.
        """
        override = self.credentials.get("base_url")
        return isinstance(override, str) and bool(override.strip())

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        api_key = self.credentials.get("api_key")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        extra = self.credentials.get("extra_headers") or {}
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except json.JSONDecodeError:
                logger.warning("openai-compatible: extra_headers is not valid JSON, ignoring")
                extra = {}
        if isinstance(extra, dict):
            headers.update({str(k): str(v) for k, v in extra.items()})
        return headers

    async def _get_models(self) -> tuple[bool, str, float, list]:
        if self.requires_key and not self._is_compatible_gateway() and not self.credentials.get("api_key"):
            return False, "api_key is required", 0, []
        start = time.monotonic()
        try:
            async with self._client() as client:
                r = await client.get(
                    f"{self._base_url()}/models", headers=self._headers(), timeout=10.0
                )
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
            DiscoveredModel(
                model_id=m["id"],
                name=m["id"],
                endpoint_type=self.endpoint_type,
                primary_endpoint=self.endpoint,
                supported_endpoints=sorted(self.supported_endpoints),
            )
            for m in data
            if isinstance(m, dict) and m.get("id")
        ]


class OpenAIChatAdapter(OpenAIBaseAdapter):
    endpoint = "chat_completions"
    endpoint_type = "chat_completions"
    supported_endpoints = frozenset({"chat_completions"})

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

    def _message(self, m: ChatMessage) -> dict:
        """Wire message with tool envelopes preserved (calls, results, legacy)."""
        message: dict = {"role": m.role, "content": self._content(m)}
        extra = m.extra or {}
        if extra.get("tool_calls") is not None:message["tool_calls"] = extra["tool_calls"]
        if extra.get("function_call") is not None:message["function_call"] = extra["function_call"]
        if extra.get("tool_call_id") is not None:message["tool_call_id"] = extra["tool_call_id"]
        if extra.get("name") is not None and m.role in ("tool", "function", "assistant"):message["name"] = extra["name"]
        return message

    async def chat_stream(
        self, messages: list[ChatMessage], tools: list[dict] | None = None, tool_choice: dict | str | None = None
    ) -> AsyncIterator[StreamChunk]:
        body = {
            "model": self.model_id,
            "messages": [self._message(m) for m in messages],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools is not None:body["tools"] = tools
        if tool_choice is not None:body["tool_choice"] = tool_choice
        body.update(openai_params(self.prompt_cache))
        effort = reasoning_effort(self.reasoning_level)
        if effort:body["reasoning_effort"] = effort
        headers = self._headers()
        in_reasoning = False
        try:
            async with self._client() as client, client.stream(
                "POST", f"{self._base_url()}/chat/completions", json=body, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode()[:500]
                    logger.warning("openai chat error %s: %s", resp.status_code, detail)
                    raise RuntimeError(f"provider error {resp.status_code}: {detail}")
                async for line in resp.aiter_lines():
                    for payload in sse_data_lines(line):
                        try:
                            text, reasoning, usage, tool_deltas, finish_reason = _parse_chat_sse(payload)
                        except json.JSONDecodeError:
                            continue
                        for tool_delta in tool_deltas:
                            yield StreamChunk(tool_call_delta=tool_delta)
                        if finish_reason:yield StreamChunk(finish_reason=finish_reason)
                        if reasoning:
                            if not in_reasoning:
                                yield StreamChunk(delta=THINK_OPEN)
                                in_reasoning = True
                            yield StreamChunk(delta=reasoning)
                            continue
                        if text:
                            if in_reasoning:
                                yield StreamChunk(delta=THINK_CLOSE)
                                in_reasoning = False
                            yield StreamChunk(delta=text)
                            continue
                        if usage:
                            extras = usage_extras(usage)
                            yield StreamChunk(
                                prompt_tokens=usage.get("prompt_tokens"),
                                completion_tokens=usage.get("completion_tokens"),
                                total_tokens=usage.get("total_tokens"),
                                cache_read_tokens=extras["cache_read_tokens"],
                                cache_write_tokens=extras["cache_write_tokens"],
                                reasoning_tokens=extras["reasoning_tokens"],
                            )
                if in_reasoning:yield StreamChunk(delta=THINK_CLOSE)
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("openai chat stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class OpenAIResponsesAdapter(OpenAIChatAdapter):
    endpoint = "responses"
    endpoint_type = "responses"
    supported_endpoints = frozenset({"responses"})
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

    def _input_items(self, messages: list[ChatMessage]) -> list[dict]:
        """Responses input with function-call history preserved verbatim."""
        items: list[dict] = []
        for m in messages:
            extra = m.extra or {}
            if extra.get("response_item") is not None:
                items.append(extra["response_item"])
                continue
            if m.role == "tool":
                items.append({
                    "type": "function_call_output",
                    "call_id": extra.get("tool_call_id") or extra.get("call_id") or "",
                    "output": m.content,
                })
                continue
            items.append({"role": m.role, "content": self._content(m)})
            for call in extra.get("tool_calls") or []:
                function = call.get("function") or {}
                items.append({
                    "type": "function_call",
                    "call_id": call.get("id") or "",
                    "name": function.get("name") or "",
                    "arguments": function.get("arguments") or "",
                })
        return items

    async def chat_stream(
        self, messages: list[ChatMessage], tools: list[dict] | None = None, tool_choice: dict | str | None = None
    ) -> AsyncIterator[StreamChunk]:
        body = {
            "model": self.model_id,
            "input": self._input_items(messages),
            "stream": True,
        }
        if tools is not None:
            body["tools"] = tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice
        body.update(openai_params(self.prompt_cache))
        effort = reasoning_effort(self.reasoning_level)
        if effort:
            # Summary must be requested explicitly or the API streams no
            # reasoning text; "auto" is cheapest and works for gpt-5/o-series.
            body["reasoning"] = {"effort": effort, "summary": "auto"}
        headers = self._headers()
        in_reasoning = False
        try:
            async with self._client() as client, client.stream(
                "POST", f"{self._base_url()}/responses", json=body, headers=headers
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
                    etype = event.get("type", "")
                    if etype == "response.output_item.added":
                        item = event.get("item") or {}
                        if item.get("type") == "function_call":
                            yield StreamChunk(tool_call_delta={
                                "index": event.get("output_index"),
                                "id": item.get("call_id") or item.get("id") or "",
                                "name": item.get("name") or "",
                                "arguments_delta": "",
                            })
                    elif etype == "response.function_call_arguments.delta":
                        yield StreamChunk(tool_call_delta={
                            "index": None,
                            "id": event.get("item_id") or "",
                            "arguments_delta": event.get("delta") or "",
                        })
                    elif etype == "response.function_call_arguments.done":
                        if event.get("item_id"):
                            yield StreamChunk(finish_reason="tool_calls")
                    elif etype in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
                        # Encrypted reasoning internals never stream as text;
                        # summaries do. Unknown future reasoning event types
                        # carrying text fall through to the prefix check below.
                        text = event.get("delta") or event.get("text") or ""
                        if text:
                            if not in_reasoning:
                                yield StreamChunk(delta=THINK_OPEN)
                                in_reasoning = True
                            yield StreamChunk(delta=text)
                    elif etype.startswith("response.reasoning") and isinstance(event.get("delta"), str):
                        if event["delta"]:
                            if not in_reasoning:
                                yield StreamChunk(delta=THINK_OPEN)
                                in_reasoning = True
                            yield StreamChunk(delta=event["delta"])
                    elif etype == "response.output_text.delta":
                        if in_reasoning:
                            yield StreamChunk(delta=THINK_CLOSE)
                            in_reasoning = False
                        yield StreamChunk(delta=event.get("delta", ""))
                    elif etype == "response.completed":
                        if in_reasoning:
                            yield StreamChunk(delta=THINK_CLOSE)
                            in_reasoning = False
                        usage = (event.get("response") or {}).get("usage") or {}
                        extras = usage_extras(usage)
                        yield StreamChunk(
                            prompt_tokens=usage.get("input_tokens"),
                            completion_tokens=usage.get("output_tokens"),
                            total_tokens=usage.get("total_tokens"),
                            cache_read_tokens=extras["cache_read_tokens"],
                            cache_write_tokens=extras["cache_write_tokens"],
                            reasoning_tokens=extras["reasoning_tokens"],
                        )
                if in_reasoning:
                    yield StreamChunk(delta=THINK_CLOSE)
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("openai responses stream failed")
            raise RuntimeError(f"streaming failed: {e}") from e


class OpenAIEmbeddingsAdapter(OpenAIBaseAdapter):
    endpoint = "embeddings"
    endpoint_type = "embeddings"
    supported_endpoints = frozenset({"embeddings"})
    supports_vision = False
    supports_audio = False

    async def embed(self, inputs: list[str]) -> list[list[float]]:
        async with self._client() as client:
            r = await client.post(
                f"{self._base_url()}/embeddings",
                json={"model": self.model_id, "input": inputs},
                headers=self._headers(),
            )
        if r.status_code >= 400:
            detail = r.text[:500]
            logger.warning("openai embeddings error %s: %s", r.status_code, detail)
            raise RuntimeError(f"provider error {r.status_code}: {detail}")
        data = r.json().get("data") or []
        return [item["embedding"] for item in data if isinstance(item, dict) and item.get("embedding")]


class OpenAIImagesAdapter(OpenAIBaseAdapter):
    endpoint = "images/generations"
    endpoint_type = "images_generations"
    supported_endpoints = frozenset({"images/generations"})
    supports_vision = False
    supports_audio = False

    async def _first_image_bytes(self, client: httpx.AsyncClient, payload: dict) -> bytes:
        """First image from a generations/edits payload (b64 inline or URL)."""
        usage = payload.get("usage")
        self.last_media_usage = usage if isinstance(usage, dict) else None
        items = payload.get("data") or []
        if not items:
            raise RuntimeError("provider returned no image data")
        item = items[0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        url = item.get("url")
        if not url:
            raise RuntimeError("provider returned neither b64_json nor url")
        fetched = await client.get(url)
        if fetched.status_code >= 400:
            raise RuntimeError(f"image download failed ({fetched.status_code})")
        return fetched.content

    async def generate_image(
        self,
        prompt: str,
        *,
        size: str | None = None,
        quality: str | None = None,
        image_bytes: bytes | None = None,
    ) -> bytes:
        """One image for one prompt; with `image_bytes` this is an edit call.

        Only the user prompt is sent by default: size/quality ride along
        solely when the caller passes them explicitly (public API callers
        forwarding user-supplied params). The model interprets prose like
        "2:1" or "high quality" itself; the backend never invents technical
        params that would override that interpretation.
        Extra params stay keyword-only so existing callers are unaffected.
        """
        if image_bytes is not None:
            return await self._edit_image(prompt, size=size, image=image_bytes)
        body: dict = {"model": self.model_id, "prompt": prompt}
        if size:
            body["size"] = size
        if quality:
            body["quality"] = quality
        async with self._client() as client:
            r = await client.post(
                f"{self._base_url()}/images/generations", json=body, headers=self._headers()
            )
            if r.status_code >= 400:
                detail = r.text[:500]
                logger.warning("openai images error %s: %s", r.status_code, detail)
                raise RuntimeError(f"provider error {r.status_code}: {detail}")
            return await self._first_image_bytes(client, r.json())

    async def _edit_image(self, prompt: str, *, size: str | None, image: bytes) -> bytes:
        """POST multipart {base}/images/edits (model, prompt, image[, size])."""
        files = {
            "model": (None, self.model_id),
            "prompt": (None, prompt),
            "image": ("input_reference.png", image, "image/png"),
        }
        if size:
            files["size"] = (None, size)
        async with self._client() as client:
            r = await client.post(
                f"{self._base_url()}/images/edits", files=files, headers=self._headers()
            )
            if r.status_code >= 400:
                detail = r.text[:500]
                logger.warning("openai image edits error %s: %s", r.status_code, detail)
                raise RuntimeError(f"provider error {r.status_code}: {detail}")
            return await self._first_image_bytes(client, r.json())


class OpenAIAudioTranscriptionsAdapter(OpenAIBaseAdapter):
    endpoint = "audio/transcriptions"
    endpoint_type = "audio_transcriptions"
    supported_endpoints = frozenset({"audio/transcriptions"})
    supports_vision = False

    async def transcribe(self, audio: bytes, filename: str, mime_type: str) -> str:
        async with self._client() as client:
            r = await client.post(
                f"{self._base_url()}/audio/transcriptions",
                data={"model": self.model_id},
                files={"file": (filename, audio, mime_type or "application/octet-stream")},
                headers=self._headers(),
            )
        if r.status_code >= 400:
            detail = r.text[:500]
            logger.warning("openai transcription error %s: %s", r.status_code, detail)
            raise RuntimeError(f"provider error {r.status_code}: {detail}")
        return str(r.json().get("text") or "")


class OpenAIAudioSpeechAdapter(OpenAIBaseAdapter):
    endpoint = "audio/speech"
    endpoint_type = "audio_speech"
    supported_endpoints = frozenset({"audio/speech"})
    supports_vision = False

    async def speak(self, text: str, *, voice: str = "alloy", response_format: str = "mp3") -> bytes:
        async with self._client() as client:
            r = await client.post(
                f"{self._base_url()}/audio/speech",
                json={
                    "model": self.model_id,
                    "input": text,
                    "voice": voice,
                    "response_format": response_format,
                },
                headers=self._headers(),
            )
        if r.status_code >= 400:
            detail = r.text[:500]
            logger.warning("openai speech error %s: %s", r.status_code, detail)
            raise RuntimeError(f"provider error {r.status_code}: {detail}")
        return r.content


class OpenAIVideoAdapter(OpenAIBaseAdapter):
    """Videos API (Sora): create a job, poll it, download the MP4.

    `input_reference` turns the job into image-to-video; the reference must
    match the requested output size/aspect.
    """

    endpoint = "video/generations"
    endpoint_type = "chat_completions"  # legacy mirror (no enum member yet)
    supported_endpoints = frozenset({"video/generations"})
    supports_vision = False
    supports_audio = False

    async def generate_video(
        self,
        prompt: str,
        *,
        size: str = "1280x720",
        seconds: str = "4",
        image: bytes | None = None,
        image_filename: str = "input_reference.png",
        image_mime: str = "image/png",
        poll_interval: float = 5.0,
        deadline: float = 900.0,
    ) -> bytes:
        # Videos API is multipart: plain fields as (None, value), optional image file.
        multipart: dict = {
            "model": (None, self.model_id),
            "prompt": (None, prompt),
            "size": (None, size),
            "seconds": (None, seconds),
        }
        if image:
            normalized, resized = _match_reference_size(image, size)
            if resized:
                image = normalized
                image_mime = "image/png"
                image_filename = f"{image_filename.rsplit('.', 1)[0]}.png"
            multipart["input_reference"] = (image_filename, image, image_mime or "image/png")
        async with self._client() as client:
            created = await _with_transport_retries(
                lambda: client.post(
                    f"{self._base_url()}/videos",
                    files=multipart,
                    headers=self._headers(),
                )
            )
            if created.status_code >= 400:
                detail = created.text[:500]
                logger.warning("openai video create error %s: %s", created.status_code, detail)
                raise RuntimeError(f"provider error {created.status_code}: {detail}")
            job = created.json()
            video_id = job.get("id")
            if not video_id:
                raise RuntimeError("provider returned no video id")

            start = time.monotonic()
            status = job.get("status", "queued")
            while status in ("queued", "in_progress", "processing"):
                if time.monotonic() - start > deadline:
                    raise RuntimeError(f"video {video_id} not ready after {int(deadline)}s (status={status})")
                await asyncio.sleep(poll_interval)
                poll = await _with_transport_retries(
                    lambda: client.get(f"{self._base_url()}/videos/{video_id}", headers=self._headers())
                )
                if poll.status_code >= 400:
                    detail = poll.text[:300]
                    raise RuntimeError(f"video poll failed ({poll.status_code}): {detail}")
                payload = poll.json()
                status = payload.get("status", status)
                if status == "failed":
                    raise RuntimeError(f"video {video_id} failed: {payload.get('error') or 'provider reported failure'}")
                logger.info("openai video %s status=%s (%.0fs)", video_id, status, time.monotonic() - start)
            if status != "completed":
                raise RuntimeError(f"video {video_id} ended in status={status}")

            content = await _with_transport_retries(
                lambda: client.get(f"{self._base_url()}/videos/{video_id}/content", headers=self._headers())
            )
        if content.status_code >= 400:
            detail = content.text[:300]
            raise RuntimeError(f"video download failed ({content.status_code}): {detail}")
        return content.content


# Backwards-compatible name: custom OpenAI-compatible gateways now use the
# same classes because every OpenAI adapter honors base_url/extra_headers.
CustomAdapter = OpenAIChatAdapter
