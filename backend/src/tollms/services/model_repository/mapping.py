"""Repository mapping engine: discovered model -> repository entry + match type.

Resolution order per spec:
  1. provider_specific — {provider}/{model} with the provider from the
     provider type hint or detected from a CUSTOM base URL.
  2. URL mapping feeds priority 1 (api.groq.com -> groq, ...).
  3. global — model-id-only match across providers.
  4. fallback — zero-price defaults, user-editable.
"""

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from tollms.services.model_repository.canonical import canonicalize
from tollms.models.model_repository import RepositoryModel
from tollms.services.model_repository.lookup import PROVIDER_HINTS, lookup, stats, suggest_payload

logger = logging.getLogger(__name__)

# Ordered substrings: first match wins. Localhost entries double as Ollama detection.
PROVIDER_URL_HINTS: tuple[tuple[str, str], ...] = (
    ("openrouter.ai", "openrouter"),
    ("api.groq.com", "groq"),
    ("api.deepseek.com", "deepseek"),
    ("api.mistral.ai", "mistral"),
    ("api.together.xyz", "together"),
    ("api.fireworks.ai", "fireworks_ai"),
    ("localhost", "ollama"),
    ("127.0.0.1", "ollama"),
    (":11434", "ollama"),
    ("ollama", "ollama"),
    ("litellm", "litellm"),
    ("openai.azure.com", "azure"),
)

FALLBACK_SUGGESTED: dict[str, Any] = {
    "input_price": "0",
    "output_price": "0",
    "cache_read_price": "0",
    "cache_write_price": "0",
    "supports_text": True,
    "supports_vision": False,
    "supports_audio_input": False,
    "supports_audio_output": False,
    "supports_image_generation": False,
    "supports_video_generation": False,
    "supports_tool_calling": False,
    "supports_reasoning": False,
    "supports_streaming": True,
    "endpoint_type": "chat_completions",
}


def detect_providers_from_url(base_url: str | None) -> tuple[str, ...]:
    """Detect repository provider names from a CUSTOM base URL. Never raises."""
    try:
        if not base_url:
            return ()
        host = urlparse(base_url if "://" in base_url else f"http://{base_url}").netloc.lower()
        haystack = f"{host} {base_url.lower()}"
        found = [provider for substr, provider in PROVIDER_URL_HINTS if substr in haystack]
        return tuple(dict.fromkeys(found))
    except Exception:
        logger.exception("provider URL detection failed")
        return ()


def _repository_version(db: Session) -> str | None:
    try:
        last = stats(db)["last_sync"]
        return str(last["id"]) if last else None
    except Exception:
        logger.exception("repository version lookup failed")
        return None


PROVIDER_DEFAULT_ENDPOINTS: dict[str, str] = {
    "BEDROCK_CONVERSE": "converse",
    "ANTHROPIC_MESSAGES": "messages",
    "OPENAI": "chat_completions",
    "GEMINI": "chat_completions",
    "VERTEX_AI": "chat_completions",
    "CUSTOM": "chat_completions",
}

# Families whose wire shape is tied to one endpoint: repository chat entries
# are re-pointed at the family endpoint (e.g. Anthropic messages).
FIXED_ENDPOINT_PROVIDERS = frozenset({"ANTHROPIC_MESSAGES", "GEMINI", "VERTEX_AI", "BEDROCK_CONVERSE"})


def _fallback_suggested(model_id: str, provider_type: str | None) -> dict[str, Any]:
    endpoint = PROVIDER_DEFAULT_ENDPOINTS.get((provider_type or "").upper()) or "chat_completions"
    return {
        **FALLBACK_SUGGESTED,
        "model_id": model_id,
        "name": model_id,
        "endpoint_type": {
            "responses": "responses",
            "chat_completions": "chat_completions",
            "messages": "messages",
            "converse": "converse",
        }.get(endpoint, "chat_completions"),
        "primary_endpoint": endpoint,
        "supported_endpoints": [endpoint],
    }


def map_one(
    db: Session,
    model_id: str,
    *,
    provider_type: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Map one discovered model id. Returns match_type + suggested payload."""
    default_endpoint = PROVIDER_DEFAULT_ENDPOINTS.get((provider_type or "").upper())
    lock_endpoint = (provider_type or "").upper() in FIXED_ENDPOINT_PROVIDERS
    tail = canonicalize(model_id).split("/")[-1]
    hints = (*PROVIDER_HINTS.get((provider_type or "").upper(), ()), *detect_providers_from_url(base_url))
    for hint in hints:
        entry = lookup(db, f"{hint}/{model_id}")
        if entry is not None and entry.provider == hint:
            return _mapped(
                entry, db, model_id, "provider_specific", base_url,
                default_endpoint=default_endpoint, lock_endpoint=lock_endpoint,
            )
    entry = lookup(db, model_id)
    if entry is not None:
        return _mapped(
            entry, db, model_id, "global", base_url,
            default_endpoint=default_endpoint, lock_endpoint=lock_endpoint,
        )
    return {
        "model_id": model_id,
        "match_type": "fallback",
        "repository_model_key": None,
        "suggested": _fallback_suggested(model_id, provider_type),
        "repository_match": _match_meta(db, "fallback", base_url, tail),
    }


def _mapped(
    entry: RepositoryModel,
    db: Session,
    model_id: str,
    match_type: str,
    base_url: str | None,
    default_endpoint: str | None = None,
    lock_endpoint: bool = False,
) -> dict[str, Any]:
    suggested = suggest_payload(entry)
    suggested["model_id"] = model_id  # discovered id wins; repo id stays in the key
    # Fixed-endpoint families re-point chat models at their wire endpoint;
    # OpenAI-compatible families keep the repository's endpoint truth.
    if lock_endpoint and default_endpoint and suggested.get("primary_endpoint") in {
        "responses", "chat_completions", "messages", "converse"
    }:
        suggested["endpoint_type"] = default_endpoint
        suggested["primary_endpoint"] = default_endpoint
        suggested["supported_endpoints"] = [default_endpoint]
    return {
        "model_id": model_id,
        "match_type": match_type,
        "repository_model_key": entry.model_key,
        "suggested": suggested,
        "repository_match": _match_meta(db, match_type, base_url, entry.model_key),
    }


def _match_meta(db: Session, match_type: str, base_url: str | None, key: str) -> dict[str, Any]:
    return {
        "match_type": match_type,
        "source_url": base_url,
        "repository_model_key": key,
        "repository_version": _repository_version(db),
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }


def map_models(
    db: Session,
    model_ids: list[str],
    *,
    provider_type: str | None = None,
    base_url: str | None = None,
) -> list[dict[str, Any]]:
    """Map many ids. Never raises per-item: failures degrade to fallback."""
    out = []
    for model_id in model_ids:
        try:
            out.append(map_one(db, model_id, provider_type=provider_type, base_url=base_url))
        except Exception:
            logger.exception("mapping failed for %s", model_id)
            out.append(
                {
                    "model_id": model_id,
                    "match_type": "fallback",
                    "repository_model_key": None,
                    "suggested": _fallback_suggested(model_id, provider_type),
                    "repository_match": _match_meta(db, "fallback", base_url, model_id),
                }
            )
    return out
