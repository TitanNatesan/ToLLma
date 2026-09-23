"""External source adapters: fetch + normalize to canonical model records.

Each adapter returns a list of NormalizedModel. Normalization is defensive:
unknown shapes are skipped (never crash a sync), full raw payloads are kept
so new upstream fields survive without schema changes.
"""

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from tollms.services.model_repository.canonical import split_canonical

logger = logging.getLogger(__name__)

LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
OPENROUTER_URL = "https://openrouter.ai/api/v1/models"
_FETCH_TIMEOUT = 60.0
_FETCH_ATTEMPTS = 2


def _cost(value: Any) -> Decimal | None:
    try:
        if value is None or value == "":
            return None
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _int(value: Any) -> int | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        return int(value)
    except (ValueError, TypeError):
        return None


def _date_from_ts(value: Any) -> date | None:
    try:
        if not value:
            return None
        return datetime.fromtimestamp(int(value), tz=timezone.utc).date()
    except (ValueError, TypeError, OSError):
        return None


@dataclass
class NormalizedModel:
    """One source's view of a canonical model. Merge happens in service.py."""

    source: str
    model_key: str  # canonical: {provider}/{model}, lowercase
    canonical_name: str
    display_name: str | None = None
    family: str | None = None
    family: str | None = None
    provider: str = "unknown"
    provider_model_id: str = ""
    vendor: str | None = None
    endpoint_type: str = "chat_completions"
    primary_endpoint: str | None = None
    supported_endpoints: list[str] = field(default_factory=list)
    description: str | None = None
    documentation_url: str | None = None
    release_date: date | None = None
    caps: dict[str, bool] = field(default_factory=dict)
    context_window: int | None = None
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    max_images: int | None = None
    max_audio_length: int | None = None
    max_video_length: int | None = None
    pricing: dict[str, Decimal | None] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


def _fetch_with_retry(url: str) -> dict[str, Any]:
    """GET JSON with one retry. Raises on persistent failure (caller records it)."""
    last: Exception | None = None
    for attempt in range(1, _FETCH_ATTEMPTS + 1):
        try:
            with httpx.Client(timeout=_FETCH_TIMEOUT) as client:
                response = client.get(url)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    raise ValueError(f"{url} payload is not a JSON object")
                return data
        except Exception as e:
            last = e
            logger.warning("fetch %s attempt %s failed: %s", url, attempt, e)
    raise last or RuntimeError(f"fetch failed: {url}")


def _split_key(full_key: str, fallback_provider: str = "unknown") -> tuple[str, str, str]:
    """Return (model_key, provider, provider_model_id) for a/b style keys."""
    return split_canonical(full_key, fallback_provider)


# Upstream endpoint labels -> gateway wire paths. Unknown values are dropped.
_ENDPOINT_ALIASES = {
    "chat/completions": "chat_completions",
    "chat_completions": "chat_completions",
    "responses": "responses",
    "messages": "messages",
    "converse": "converse",
    "embedding": "embeddings",
    "embeddings": "embeddings",
    "images/generations": "images/generations",
    "image_generation": "images/generations",
    "audio/transcriptions": "audio/transcriptions",
    "audio_transcription": "audio/transcriptions",
    "audio/speech": "audio/speech",
    "audio_speech": "audio/speech",
}

# LiteLLM `mode` -> wire endpoints when the entry carries no explicit list.
_LITELLM_MODE_ENDPOINTS = {
    "chat": ["chat_completions"],
    "completion": ["chat_completions"],
    "responses": ["responses"],
    "embedding": ["embeddings"],
    "image_generation": ["images/generations"],
    "audio_transcription": ["audio/transcriptions"],
    "audio_speech": ["audio/speech"],
}


def normalize_endpoint(label: Any) -> str | None:
    """Normalize an upstream endpoint label ("/v1/chat/completions", "embedding")."""
    if not label:
        return None
    text = str(label).strip().lower().lstrip("/")
    if text.startswith("v1/"):
        text = text[3:]
    return _ENDPOINT_ALIASES.get(text)


def derive_endpoints(
    *, mode: str | None = None, supported: Any = None, in_modalities=(), out_modalities=()
) -> list[str]:
    """Endpoint set for a model: explicit upstream list first, else modality/mode."""
    endpoints: list[str] = []
    if isinstance(supported, (list, tuple)):
        for raw in supported:
            normalized = normalize_endpoint(raw)
            if normalized and normalized not in endpoints:
                endpoints.append(normalized)
    if endpoints:
        return endpoints
    if mode:
        for endpoint in _LITELLM_MODE_ENDPOINTS.get(str(mode).strip().lower(), []):
            if endpoint not in endpoints:
                endpoints.append(endpoint)
    inputs = {str(m).lower() for m in in_modalities}
    outputs = {str(m).lower() for m in out_modalities}
    if not endpoints and "text" in outputs:
        endpoints.append("chat_completions")
    if "image" in outputs and "images/generations" not in endpoints:
        endpoints.append("images/generations")
    if "audio" in inputs and "audio/transcriptions" not in endpoints:
        endpoints.append("audio/transcriptions")
    if "audio" in outputs and "audio/speech" not in endpoints:
        endpoints.append("audio/speech")
    return endpoints


class LiteLLMSourceAdapter:
    """Adapter for the LiteLLM pricing/context-window JSON."""

    name = "litellm"

    def fetch(self) -> dict[str, Any]:
        return _fetch_with_retry(LITELLM_URL)

    def normalize(self, data: dict[str, Any]) -> list[NormalizedModel]:
        out: list[NormalizedModel] = []
        for full_key, info in data.items():
            if not isinstance(info, dict):
                continue
            try:
                model = self._normalize_one(str(full_key), info)
            except Exception:
                logger.warning("litellm: skipping unparseable entry %r", full_key)
                continue
            if model is not None:
                out.append(model)
        return out

    def _normalize_one(self, full_key: str, info: dict[str, Any]) -> NormalizedModel | None:
        if not full_key or full_key.startswith("sample_spec"):
            return None
        fallback = str(info.get("litellm_provider", "unknown")).split("/")[0].strip().lower() or "unknown"
        key, provider, provider_model_id = _split_key(full_key, fallback)
        if not provider_model_id:
            return None
        mode = str(info.get("mode", "chat"))
        in_modalities = info.get("supported_input_modalities") or []
        out_modalities = info.get("supported_output_modalities") or []
        endpoints = derive_endpoints(
            mode=mode,
            supported=info.get("supported_endpoints"),
            in_modalities=in_modalities,
            out_modalities=out_modalities,
        )
        primary = endpoints[0] if endpoints else "chat_completions"
        caps = {
            "supports_text_input": True,
            "supports_text_output": mode != "embedding",
            "supports_chat": bool({"chat_completions", "responses", "messages", "converse"} & set(endpoints)),
            "supports_vision_input": bool(info.get("supports_vision")) or "image" in in_modalities,
            "supports_image_output": mode == "image_generation" or "image" in out_modalities,
            "supports_audio_input": bool(info.get("supports_audio_input")),
            "supports_audio_output": bool(info.get("supports_audio_output")),
            "supports_video_input": bool(info.get("supports_video_input")),
            "supports_video_output": False,
            "supports_reasoning": bool(info.get("supports_reasoning")),
            "supports_tool_calling": bool(info.get("supports_function_calling") or info.get("supports_parallel_function_calling")),
            "supports_structured_output": bool(info.get("supports_response_schema")),
            "supports_streaming": mode in ("chat", "completion", "responses"),
            "supports_embeddings": mode == "embedding",
            "supports_prompt_caching": bool(info.get("supports_prompt_caching")),
        }
        return NormalizedModel(
            source=self.name,
            model_key=key,
            canonical_name=full_key,
            provider=provider,
            provider_model_id=provider_model_id,
            endpoint_type="embeddings" if primary == "embeddings" else "chat_completions",
            primary_endpoint=primary,
            supported_endpoints=endpoints,
            context_window=_int(info.get("max_input_tokens")) or _int(info.get("max_tokens")),
            max_input_tokens=_int(info.get("max_input_tokens")),
            max_output_tokens=_int(info.get("max_output_tokens")),
            pricing={
                "input_cost": _cost(info.get("input_cost_per_token")),
                "output_cost": _cost(info.get("output_cost_per_token")),
                "cache_read_cost": _cost(info.get("cache_read_input_token_cost")),
                "cache_write_cost": _cost(info.get("cache_creation_input_token_cost")),
            },
            caps=caps,
            raw=dict(info),
        )


class OpenRouterSourceAdapter:
    """Adapter for the OpenRouter /api/v1/models listing."""

    name = "openrouter"

    def fetch(self) -> dict[str, Any]:
        return _fetch_with_retry(OPENROUTER_URL)

    def normalize(self, data: dict[str, Any]) -> list[NormalizedModel]:
        models = data.get("data")
        if not isinstance(models, list):
            return []
        out: list[NormalizedModel] = []
        for info in models:
            if not isinstance(info, dict):
                continue
            try:
                model = self._normalize_one(info)
            except Exception:
                logger.warning("openrouter: skipping unparseable entry %r", info.get("id"))
                continue
            if model is not None:
                out.append(model)
        return out

    def _normalize_one(self, info: dict[str, Any]) -> NormalizedModel | None:
        model_id = str(info.get("id", "")).strip()
        if not model_id:
            return None
        key, provider, provider_model_id = _split_key(model_id)
        arch = info.get("architecture") or {}
        in_modalities = [str(m).lower() for m in (arch.get("input_modalities") or [])]
        out_modalities = [str(m).lower() for m in (arch.get("output_modalities") or [])]
        params = [str(p) for p in (info.get("supported_parameters") or [])]
        pricing = info.get("pricing") or {}
        top = info.get("top_provider") or {}
        endpoints = derive_endpoints(
            supported=info.get("supported_endpoints"),
            in_modalities=in_modalities,
            out_modalities=out_modalities,
        )
        primary = endpoints[0] if endpoints else "chat_completions"
        caps = {
            "supports_text_input": "text" in in_modalities or not in_modalities,
            "supports_text_output": "text" in out_modalities or not out_modalities,
            "supports_chat": bool({"chat_completions", "responses"} & set(endpoints)),
            "supports_vision_input": "image" in in_modalities,
            "supports_image_output": "image" in out_modalities,
            "supports_audio_input": "audio" in in_modalities,
            "supports_audio_output": "audio" in out_modalities,
            "supports_video_input": "video" in in_modalities,
            "supports_video_output": "video" in out_modalities,
            "supports_reasoning": any("reasoning" in p for p in params),
            "supports_tool_calling": any(p in ("tools", "tool_choice") for p in params),
            "supports_structured_output": any(p in ("response_format", "structured_outputs") for p in params),
            "supports_streaming": True,
            "supports_embeddings": False,
            "supports_prompt_caching": _cost(pricing.get("discount")) is not None,
        }
        return NormalizedModel(
            source=self.name,
            model_key=key,
            canonical_name=model_id,
            display_name=str(info.get("name") or model_id),
            provider=provider,
            provider_model_id=provider_model_id,
            description=str(info.get("description") or "") or None,
            release_date=_date_from_ts(info.get("created")),
            endpoint_type="embeddings" if primary == "embeddings" else "chat_completions",
            primary_endpoint=primary,
            supported_endpoints=endpoints,
            context_window=_int(info.get("context_length")),
            max_input_tokens=_int(info.get("context_length")),
            max_output_tokens=_int(top.get("max_completion_tokens")),
            pricing={
                "input_cost": _cost(pricing.get("prompt")),
                "output_cost": _cost(pricing.get("completion")),
                "cache_read_cost": None,
                "cache_write_cost": None,
                "image_input_cost": _cost(pricing.get("image")),
                "audio_input_cost": _cost(pricing.get("audio")),
            },
            caps=caps,
            raw=dict(info),
        )
