"""Model identifier resolution for the public API gateway.

Maps the model string a client sent onto the requesting user's registered
provider + model rows:

- ``provider/model``: the tail matches ``AIModel.model_id``; the hint matches
  the provider's repository family name (``PROVIDER_HINTS``), the provider's
  display name (case-insensitive) or its ``provider_type`` prefix.
- a bare model id: the whole string must match exactly one active model.

Only rows owned by ``user_id`` are visible. A short 30s Valkey cache stores
the resolved row ids (never ORM objects or prices), so reruns are cheap while
capability/price edits still propagate almost immediately.
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.provider import Provider
from tollms.models.registered_model import AIModel
from tollms.services.cache.manager import cache_get_sync, cache_set_sync
from tollms.services.model_repository.lookup import PROVIDER_HINTS

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 30
_CACHE_PREFIX = "tollma:modelres"


@dataclass(frozen=True)
class ResolvedModel:
    """The provider + model a public request routes to."""

    provider: Provider
    model: AIModel


def _cache_key(user_id: uuid.UUID, identifier: str) -> str:
    return f"{_CACHE_PREFIX}:{user_id}:{identifier}"


def provider_aliases(provider: Provider) -> set[str]:
    """Hint strings that address this provider: family name, type prefix, name."""
    provider_type = provider.provider_type.value.lower()
    aliases = {provider_type, provider_type.split("_", 1)[0]}
    aliases.update(hint.lower() for hint in PROVIDER_HINTS.get(provider.provider_type.value, ()))
    name = (provider.name or "").strip().lower()
    if name:
        aliases.add(name)
    return aliases


def _split_hint(identifier: str) -> tuple[str | None, str]:
    """Split ``hint/model_id`` on the first slash; None when there is none."""
    if "/" not in identifier:
        return None, identifier
    hint, _, tail = identifier.partition("/")
    hint, tail = hint.strip(), tail.strip()
    if hint and tail:
        return hint.lower(), tail
    return None, identifier


def _base_query(user_id: uuid.UUID, model_id: str):
    """Active, owned models matching one exact ``model_id``."""
    return (
        select(Provider, AIModel)
        .join(AIModel, AIModel.provider_id == Provider.id)
        .where(
            Provider.user_id == user_id,
            Provider.is_deleted.is_(False),
            Provider.is_active.is_(True),
            AIModel.is_deleted.is_(False),
            AIModel.is_active.is_(True),
            AIModel.model_id == model_id,
        )
        .order_by(Provider.name, AIModel.id)
    )


def _candidates_with_hint(
    db: Session, user_id: uuid.UUID, hint: str, tail: str
) -> tuple[list[tuple[Provider, AIModel]], bool]:
    """(matching rows, whether the hint addressed any provider at all)."""
    rows = [(provider, model) for provider, model in db.execute(_base_query(user_id, tail))]
    hint_matched = any(hint in provider_aliases(provider) for provider, _ in rows)
    if not hint_matched:
        return [], False
    return [(provider, model) for provider, model in rows if hint in provider_aliases(provider)], True


def _candidates_bare(db: Session, user_id: uuid.UUID, model_id: str) -> list[tuple[Provider, AIModel]]:
    return [(provider, model) for provider, model in db.execute(_base_query(user_id, model_id))]


def _one(identifier: str, matches: list[tuple[Provider, AIModel]]) -> ResolvedModel:
    if not matches:
        raise NotFoundError(f"model not found: {identifier}")
    if len(matches) > 1:
        raise ValidationError(
            f"ambiguous_model: '{identifier}' matches {len(matches)} providers; use provider/model"
        )
    provider, model = matches[0]
    return ResolvedModel(provider=provider, model=model)


def _resolve_uncached(db: Session, user_id: uuid.UUID, identifier: str) -> ResolvedModel:
    hint, tail = _split_hint(identifier)
    if hint is not None:
        matches, hint_matched = _candidates_with_hint(db, user_id, hint, tail)
        if hint_matched:
            resolved = _one(identifier, matches)
            logger.info("public gateway: resolved %r via provider hint", identifier)
            return resolved
        # The "hint" is really part of a slashed model id (e.g. meta-llama/…).
    return _one(identifier, _candidates_bare(db, user_id, identifier))


def _read_cache(db: Session, user_id: uuid.UUID, identifier: str) -> ResolvedModel | None:
    data = cache_get_sync(_cache_key(user_id, identifier))
    if not isinstance(data, dict) or not data.get("provider_id") or not data.get("model_id"):
        return None
    try:
        provider = db.get(Provider, uuid.UUID(str(data["provider_id"])))
        model = db.get(AIModel, uuid.UUID(str(data["model_id"])))
    except (ValueError, TypeError):
        return None
    if provider is None or model is None:
        return None
    if provider.is_deleted or model.is_deleted or not provider.is_active or not model.is_active:
        return None
    if provider.user_id != user_id or model.provider_id != provider.id:
        return None
    return ResolvedModel(provider=provider, model=model)


def _write_cache(user_id: uuid.UUID, identifier: str, resolved: ResolvedModel) -> None:
    cache_set_sync(
        _cache_key(user_id, identifier),
        {"provider_id": str(resolved.provider.id), "model_id": str(resolved.model.id)},
        ttl=CACHE_TTL_SECONDS,
    )


def resolve_model(db: Session, identifier: str, user_id: uuid.UUID) -> ResolvedModel:
    """Resolve ``identifier`` for ``user_id`` or raise NotFound/Validation."""
    text = (identifier or "").strip()
    if not text:
        raise ValidationError("model is required")
    cached = _read_cache(db, user_id, text)
    if cached is not None:
        return cached
    resolved = _resolve_uncached(db, user_id, text)
    _write_cache(user_id, text, resolved)
    return resolved
