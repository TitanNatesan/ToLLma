"""ModelCanonicalizationService: map variant spellings to one canonical key.

Sources disagree on separators and prefixes (anthropic/claude-sonnet-4 vs
anthropic.claude-sonnet-4 vs openai-style bare ids). Canonicalization unifies
separators so variants group into a single record; the stored model_key keeps
the first-seen original spelling (stable, no churn).
"""

import re

_SEPARATORS = re.compile(r"[._:\s/]+")


def canonicalize(raw: str) -> str:
    """Normalize a model key or id to its canonical grouping form."""
    key = raw.strip().lower()
    key = _SEPARATORS.sub("/", key)
    key = re.sub(r"/+", "/", key).strip("/")
    return key


def split_canonical(raw: str, fallback_provider: str = "unknown") -> tuple[str, str, str]:
    """Return (model_key, provider, provider_model_id) in canonical form."""
    key = canonicalize(raw)
    if "/" in key:
        provider, _, rest = key.partition("/")
        provider = provider or fallback_provider
    else:
        provider, rest = fallback_provider, key
    if provider == "openrouter" and "/" in rest:
        # Routing prefix: openrouter/anthropic/x is anthropic/x.
        return split_canonical(rest, fallback_provider)
    if not rest:
        return key or fallback_provider, fallback_provider, key
    return f"{provider}/{rest}", provider, rest
