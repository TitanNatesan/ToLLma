"""PromptCachingService: provider-aware prompt cache planning.

Cache strategy per provider family:

* ``OPENAI`` — prefix caching is automatic; a stable ``prompt_cache_key``
  (derived from the conversation id) keeps a conversation's requests on the
  same cache route.
* ``CUSTOM`` (OpenAI-compatible gateways) — implicit only: unknown request
  fields can be rejected by strict servers, so the body is left untouched.
* ``ANTHROPIC_MESSAGES`` — explicit ephemeral cache breakpoint on the system
  prompt (the stable prefix before the conversation history).
* ``BEDROCK_CONVERSE`` — ``cachePoint`` block after the system prompt for
  Anthropic/Claude model ids; other families get an implicit (no-op) plan.
* ``GEMINI`` / ``VERTEX_AI`` — implicit prefix caching on current models; no
  request change.

A model that does not declare ``supports_prompt_caching`` gets a disabled plan:
requests stay byte-identical to today and nothing raises or warns. Callers
attach the plan to the adapter; adapters that see no plan send today's body.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Provider families with implicit prefix caching and no request surface.
_IMPLICIT_FAMILIES = frozenset({"GEMINI", "VERTEX_AI"})
# Families/servers that reject unknown body fields stay untouched.
_IMPLICIT_NOOP = frozenset({"CUSTOM"})


@dataclass(frozen=True)
class CachingPlan:
    """What the adapter should do about prompt caching for one request."""

    enabled: bool = False
    strategy: str = "none"  # openai | anthropic | bedrock | implicit | none
    cache_key: str | None = None
    reason: str = "model_unsupported"

    @property
    def request_change(self) -> bool:
        """True when the strategy needs request-body cooperation."""
        return self.enabled and self.strategy in ("openai", "anthropic", "bedrock")


def plan(
    provider_type: str | None,
    *,
    supported: bool,
    conversation_id: str | None = None,
    model_id: str | None = None,
) -> CachingPlan:
    """Select a caching strategy. Never raises; unsupported input disables it."""
    if not supported:
        return CachingPlan(enabled=False, strategy="none", reason="model_unsupported")
    family = (provider_type or "").upper()
    if family == "OPENAI":
        key = f"tollma:{conversation_id}" if conversation_id else None
        return CachingPlan(enabled=True, strategy="openai", cache_key=key, reason="native_prefix_cache")
    if family in _IMPLICIT_NOOP:
        return CachingPlan(enabled=True, strategy="implicit", reason="compatible_prefix_cache")
    if family in _IMPLICIT_FAMILIES:
        return CachingPlan(enabled=True, strategy="implicit", reason="implicit_prefix_cache")
    if family == "ANTHROPIC_MESSAGES":
        return CachingPlan(enabled=True, strategy="anthropic", reason="ephemeral_system_breakpoint")
    if family == "BEDROCK_CONVERSE":
        if "anthropic" in (model_id or "").lower():
            return CachingPlan(enabled=True, strategy="bedrock", reason="claude_cache_point")
        return CachingPlan(enabled=True, strategy="implicit", reason="implicit_body_cache")
    return CachingPlan(enabled=False, strategy="none", reason="unknown_provider")


def openai_params(plan_: CachingPlan | None) -> dict[str, str]:
    """Extra chat-completions body fields for the OpenAI strategy."""
    if plan_ is None or not plan_.enabled or plan_.strategy != "openai":
        return {}
    params: dict[str, str] = {}
    if plan_.cache_key:
        params["prompt_cache_key"] = plan_.cache_key
    return params


def anthropic_system(plan_: CachingPlan | None, system: str) -> str | list[dict]:
    """Anthropic ``system`` field: plain text, or a cached text block."""
    if not system:
        return system
    if plan_ is None or not plan_.enabled or plan_.strategy != "anthropic":
        return system
    return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]


def anthropic_messages(plan_: CachingPlan | None, messages: list[dict]) -> list[dict]:
    """Mark the final message with a cache breakpoint.

    Together with the system breakpoint this caches the whole stable prefix
    (system + conversation history) for the next turn. Anthropic ignores
    breakpoints below the model's minimum cacheable length, so this is always
    safe; non-Anthropic plans return the list untouched.
    """
    if plan_ is None or not plan_.enabled or plan_.strategy != "anthropic":
        return messages
    if not messages:
        return messages
    last = messages[-1]
    content = last.get("content")
    if isinstance(content, str):
        last["content"] = [{"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}]
    elif isinstance(content, list) and content and isinstance(content[-1], dict):
        content[-1] = {**content[-1], "cache_control": {"type": "ephemeral"}}
    return messages


def bedrock_system(plan_: CachingPlan | None, system_blocks: list[dict]) -> list[dict]:
    """Bedrock Converse system blocks; appends a cache point when planned."""
    if not system_blocks:
        return system_blocks
    if plan_ is None or not plan_.enabled or plan_.strategy != "bedrock":
        return system_blocks
    return [*system_blocks, {"cachePoint": {"type": "default"}}]


def supports_prompt_caching(model, repo_entry=None) -> bool:
    """Model metadata or repository capability; never inspects model names."""
    metadata = getattr(model, "metadata_", None)
    if isinstance(metadata, dict) and metadata.get("supports_prompt_caching"):
        return True
    return bool(getattr(repo_entry, "supports_prompt_caching", False))
