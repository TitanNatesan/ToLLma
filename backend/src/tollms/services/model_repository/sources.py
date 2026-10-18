"""External source adapters: fetch + normalize to canonical model records.

Each adapter returns a list of NormalizedModel. Normalization is defensive:
unknown shapes are skipped (never crash a sync), full raw payloads are kept
so new upstream fields survive without schema changes.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from tollms.services.model_repository.canonical import split_canonical

logger = logging.getLogger(__name__)

MODELS_DEV_URL = "https://models.dev/api.json?type=all"
MODELS_DEV_MODELS_URL = "https://models.dev/models.json?type=all"
MODELS_DEV_CATALOG_URL = "https://models.dev/catalog.json?type=all"
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


@dataclass
class NormalizedModel:
    """One source's view of a canonical model. Merge happens in service.py."""

    source: str
    model_key: str  # canonical: {provider}/{model}, lowercase
    canonical_name: str
    display_name: str | None = None
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
    # Normalized Models.dev catalog (models.json-linked) fields. models.dev
    # path only: other sources never set these.
    canonical_id: str | None = None
    reasoning_options: list[dict[str, Any]] | None = None
    extra_cost: dict[str, Any] | None = None
    # Overflow for upstream scalar caps with no dedicated column
    # (attachment, temperature). Never dropped.
    metadata_: dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedCanonical:
    """One models.json entry: canonical record, no cost. Merge happens in sync."""

    canonical_id: str  # full id, e.g. anthropic/claude-haiku-4-5
    name: str
    description: str | None = None
    family: str | None = None
    release_date: date | None = None
    last_updated: date | None = None
    open_weights: bool | None = None
    knowledge: str | None = None
    metadata_: dict[str, Any] = field(default_factory=dict)


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
    "images/edits": "images/edits",
    "image_edit": "images/edits",
    "image_editing": "images/edits",
    "audio/transcriptions": "audio/transcriptions",
    "audio_transcription": "audio/transcriptions",
    "audio/speech": "audio/speech",
    "audio_speech": "audio/speech",
    "video/generations": "video/generations",
    "video_generation": "video/generations",
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
    *, supported: Any = None, in_modalities=(), out_modalities=()
) -> list[str]:
    """Endpoint set for a model: explicit upstream list first, else modalities."""
    endpoints: list[str] = []
    if isinstance(supported, (list, tuple)):
        for raw in supported:
            normalized = normalize_endpoint(raw)
            if normalized and normalized not in endpoints:
                endpoints.append(normalized)
    if endpoints:
        return endpoints
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
    if "video" in outputs and "video/generations" not in endpoints:
        endpoints.append("video/generations")
    return endpoints


def endpoint_capabilities(
    endpoints: list[str], *, image_output: bool = False, video_output: bool = False
) -> dict[str, bool]:
    """Capability view derived from the endpoint set (repository read model).

    Image/video generation accept either an explicit generation endpoint or the
    modality flag (the upstream reports modalities, not endpoints).
    """
    return {
        "supports_responses": "responses" in endpoints,
        "supports_image_generation": "images/generations" in endpoints or image_output,
        "supports_image_editing": "images/edits" in endpoints,
        "supports_video_generation": "video/generations" in endpoints or video_output,
    }


class ModelsDevSourceAdapter:
    """Adapter for the models.dev community catalog (api.json).

    Shape: {provider_id: {name, models: {model_id: {...}}}}. Costs are USD
    per 1M tokens and are converted to per-token for storage.
    Provider/model ids use the shared ``{provider}/{model}`` key space.
    """

    name = "modelsdev"

    def fetch(self) -> dict[str, Any]:
        return _fetch_with_retry(MODELS_DEV_URL)

    def normalize(self, data: dict[str, Any]) -> list[NormalizedModel]:
        out: list[NormalizedModel] = []
        if not isinstance(data, dict):
            return out
        for provider_id, provider in data.items():
            if not isinstance(provider, dict):
                continue
            models = provider.get("models")
            if not isinstance(models, dict):
                continue
            for model_id, info in models.items():
                if not isinstance(info, dict):
                    continue
                try:
                    model = self._normalize_one(str(provider_id), str(model_id), info)
                except Exception:
                    logger.warning("modelsdev: skipping unparseable entry %r/%r", provider_id, model_id)
                    continue
                if model is not None:
                    out.append(model)
        return out

    def _normalize_one(self, provider_id: str, model_id: str, info: dict[str, Any]) -> NormalizedModel | None:
        model_id = model_id.strip()
        if not model_id:
            return None
        # Alias-resolved canonical slug keeps vertex/bedrock twins unified.
        slug = normalize_modelsdev_slug(provider_id)
        key, _, provider_model_id = _split_key(f"{slug}/{model_id}", slug or "unknown")
        provider = slug
        # Full provider/model identity: bare model ids collide across
        # providers in source attribution.
        full_id = f"{provider_id.strip()}/{model_id}"
        modalities = info.get("modalities") or {}
        in_modalities = [str(m).lower() for m in (modalities.get("input") or []) if isinstance(m, str)]
        out_modalities = [str(m).lower() for m in (modalities.get("output") or []) if isinstance(m, str)]
        endpoints = derive_endpoints(supported=None, in_modalities=in_modalities, out_modalities=out_modalities)
        primary = endpoints[0] if endpoints else "chat_completions"
        cost = info.get("cost") or {}

        def per_token(value: Any) -> Decimal | None:
            amount = _cost(value)
            return amount / Decimal(1_000_000) if amount is not None else None

        limit = info.get("limit") or {}
        if not isinstance(limit, dict):
            limit = {}
        if not isinstance(cost, dict):
            cost = {}
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
            "supports_reasoning": bool(info.get("reasoning")),
            "supports_tool_calling": bool(info.get("tool_call")),
            "supports_structured_output": bool(info.get("structured_output")),
            "supports_streaming": True,
            "supports_embeddings": primary == "embeddings",
            "supports_prompt_caching": per_token(cost.get("cache_read")) is not None,
            **endpoint_capabilities(
                endpoints,
                image_output="image" in out_modalities,
                video_output="video" in out_modalities,
            ),
        }
        # Upstream cost overflow with no dedicated column (tiers,
        # context_over_200k). NULL when empty — never fabricated.
        extra_cost: dict[str, Any] | None = None
        if isinstance(cost, dict):
            overflow = {}
            if cost.get("tiers") is not None:
                overflow["tiers"] = cost.get("tiers")
            if cost.get("context_over_200k") is not None:
                overflow["context_over_200k"] = cost.get("context_over_200k")
            extra_cost = overflow or None
        # Polymorphic upstream reasoning options, passthrough (None when absent).
        raw_options = info.get("reasoning_options")
        reasoning_options: list[dict[str, Any]] | None = None
        if isinstance(raw_options, list) and raw_options:
            reasoning_options = [dict(o) for o in raw_options if isinstance(o, dict)] or None
        # Overflow scalar caps with no dedicated column. Never dropped.
        metadata_: dict[str, Any] = {}
        if "attachment" in info:
            metadata_["attachment"] = info.get("attachment")
        if "temperature" in info:
            metadata_["temperature"] = info.get("temperature")
        raw_canonical = info.get("canonical_model_id")
        canonical_id = (
            str(raw_canonical).strip()
            if isinstance(raw_canonical, str) and str(raw_canonical).strip()
            else None
        )
        max_input = _int(limit.get("input"))
        if max_input is None:
            max_input = _int(limit.get("context"))
        raw_fam = info.get("family")
        return NormalizedModel(
            source=self.name,
            model_key=key,
            canonical_name=full_id,
            display_name=str(info.get("name") or model_id),
            family=str(raw_fam)[:128] if isinstance(raw_fam, str) and raw_fam.strip() else None,
            provider=provider,
            provider_model_id=provider_model_id,
            description=None,
            release_date=_parse_date(info.get("release_date")),
            endpoint_type="embeddings" if primary == "embeddings" else "chat_completions",
            primary_endpoint=primary,
            supported_endpoints=endpoints,
            context_window=_int(limit.get("context")),
            max_input_tokens=max_input,
            max_output_tokens=_int(limit.get("output")),
            pricing={
                "input_cost": per_token(cost.get("input")),
                "output_cost": per_token(cost.get("output")),
                "cache_read_cost": per_token(cost.get("cache_read")),
                "cache_write_cost": per_token(cost.get("cache_write")),
                "image_input_cost": None,
                "audio_input_cost": per_token(cost.get("input_audio")),
                "audio_output_cost": per_token(cost.get("output_audio")),
                "reasoning_cost": per_token(cost.get("reasoning")),
            },
            caps=caps,
            raw=dict(info),
            canonical_id=canonical_id,
            reasoning_options=reasoning_options,
            extra_cost=extra_cost,
            metadata_=metadata_,
        )

    def fetch_models(self) -> dict[str, Any]:
        return _fetch_with_retry(MODELS_DEV_MODELS_URL)

    def fetch_catalog(self) -> dict[str, Any]:
        return _fetch_with_retry(MODELS_DEV_CATALOG_URL)

    def normalize_canonical(self, data: dict[str, Any]) -> list[NormalizedCanonical]:
        """Parse models.json entries into canonical records (no cost)."""
        out: list[NormalizedCanonical] = []
        if not isinstance(data, dict):
            return out
        for entry_id, info in data.items():
            if not isinstance(info, dict):
                continue
            try:
                record = self._normalize_canonical_one(str(entry_id), info)
            except Exception:
                logger.warning("modelsdev: skipping unparseable canonical entry %r", entry_id)
                continue
            if record is not None:
                out.append(record)
        return out

    def _normalize_canonical_one(self, entry_id: str, info: dict[str, Any]) -> NormalizedCanonical | None:
        key = entry_id.strip()
        if not key:
            return None
        name = info.get("name")
        name_str = str(name).strip() if isinstance(name, (str, int, float)) and str(name).strip() else key
        description = info.get("description")
        family = info.get("family")
        knowledge = info.get("knowledge")
        open_weights = info.get("open_weights")
        return NormalizedCanonical(
            canonical_id=key,
            name=name_str[:255],
            description=str(description) if isinstance(description, str) and description else None,
            family=str(family)[:128] if isinstance(family, str) and family.strip() else None,
            release_date=_parse_date(info.get("release_date")),
            last_updated=_parse_date(info.get("last_updated")),
            open_weights=bool(open_weights) if isinstance(open_weights, bool) else None,
            knowledge=str(knowledge) if isinstance(knowledge, str) and knowledge else None,
            metadata_={
                k: v
                for k, v in info.items()
                if k not in {
                    "id", "name", "description", "family", "release_date",
                    "last_updated", "open_weights", "knowledge",
                }
            },
        )


def _parse_date(value: Any) -> date | None:
    if isinstance(value, str) and value.strip():
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None
    return None


# models.dev provider ids that alias a canonical entry (same upstream data).
MODELSDEV_PROVIDER_ALIASES = {
    "bedrock": "amazon-bedrock",
}

# models.dev logo convention: https://models.dev/logos/<slug>.svg
MODELSDEV_LOGO_URL = "https://models.dev/logos/{slug}.svg"


def normalize_modelsdev_slug(raw: Any) -> str:
    """Stable canonical slug: lowercase, separator-unified, alias-resolved."""
    slug = re.sub(r"[^a-z0-9]+", "-", str(raw or "").strip().lower()).strip("-")
    return MODELSDEV_PROVIDER_ALIASES.get(slug, slug) or "unknown"


def normalize_modelsdev_providers(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Provider-level catalog entries from a models.dev payload. Never raises
    on malformed entries; duplicates collapse onto the canonical slug."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(data, dict):
        return []
    for provider_id, provider in data.items():
        if not isinstance(provider, dict):
            continue
        slug = normalize_modelsdev_slug(provider.get("id") or provider_id)
        if slug in ("unknown", ""):
            continue
        models = provider.get("models")
        entry = out.setdefault(slug, {
            "slug": slug,
            "name": str(provider.get("name") or slug),
            "api_base_url": provider.get("api") if isinstance(provider.get("api"), str) else None,
            "doc_url": provider.get("doc") if isinstance(provider.get("doc"), str) else None,
            "npm_package": provider.get("npm") if isinstance(provider.get("npm"), str) else None,
            "env_vars": [e for e in (provider.get("env") or []) if isinstance(e, str)][:12],
            "model_count": 0,
        })
        if isinstance(models, dict):
            entry["model_count"] += sum(1 for m in models.values() if isinstance(m, dict))
        # Prefer the longest display name (most descriptive) across aliases.
        name = str(provider.get("name") or "")
        if len(name) > len(entry["name"]):
            entry["name"] = name
    return list(out.values())
