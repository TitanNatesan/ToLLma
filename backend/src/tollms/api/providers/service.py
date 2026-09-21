"""Provider registry: CRUD + credential encryption/masking + validation + discovery."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.crypto import decrypt, encrypt, mask
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.locks import locked
from tollms.services.cache.manager import cache_invalidate_sync, get_manager
from tollms.services.gateway.factory import build_adapter
from tollms.models.registered_model import AIModel
from tollms.models.provider import Provider, ProviderType
from tollms.api.providers.schemas import DiscoveredModelInfo, DiscoveryResult, ProviderCreate, ProviderUpdate

logger = logging.getLogger(__name__)


def masked_credentials(provider: Provider) -> dict[str, str]:
    try:
        creds = json.loads(decrypt(provider.credentials_encrypted))
    except ValueError:
        logger.exception("stored credentials undecryptable for provider %s", provider.id)
        return {}
    return {k: (mask(str(v)) if k != "base_url" and "url" not in k else str(v)) for k, v in creds.items()}


def decrypted_credentials(provider: Provider) -> dict:
    return json.loads(decrypt(provider.credentials_encrypted))


def _invalidate_provider_cache(provider_id: uuid.UUID) -> None:
    """Drop cached validation/discovery/model state. Secrets are never cached."""
    cache_invalidate_sync(
        cache_keys.provider(provider_id),
        cache_keys.provider_models(provider_id),
        cache_keys.provider_validation(provider_id),
    )


def get_provider(db: Session, provider_id: uuid.UUID, user_id: uuid.UUID | None = None) -> Provider:
    provider = db.get(Provider, provider_id)
    if provider is None or provider.is_deleted:
        raise NotFoundError(f"provider {provider_id} not found")
    if user_id is not None and provider.user_id != user_id:
        raise NotFoundError(f"provider {provider_id} not found")
    return provider


def list_providers(
    db: Session, *, active_only: bool = False, user_id: uuid.UUID | None = None
) -> list[Provider]:
    stmt = select(Provider).where(Provider.is_deleted.is_(False)).order_by(Provider.created_at)
    if user_id is not None:
        stmt = stmt.where(Provider.user_id == user_id)
    if active_only:
        stmt = stmt.where(Provider.is_active.is_(True))
    return list(db.scalars(stmt))


def ensure_unique_name(
    db: Session, name: str, exclude_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None
) -> None:
    stmt = select(Provider).where(Provider.is_deleted.is_(False), Provider.name.ilike(name.strip()))
    if user_id is not None:
        stmt = stmt.where(Provider.user_id == user_id)
    if exclude_id is not None:
        stmt = stmt.where(Provider.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ValidationError(f"provider name {name.strip()!r} is already taken")


def create_provider(db: Session, data: ProviderCreate, user_id: uuid.UUID | None = None) -> Provider:
    ensure_unique_name(db, data.name, user_id=user_id)
    provider = Provider(
        user_id=user_id,
        name=data.name,
        provider_type=data.provider_type,
        credentials_encrypted=encrypt(json.dumps(data.credentials)),
        metadata_=data.metadata,
        is_active=data.is_active,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    logger.info("provider created: %s (%s)", provider.id, provider.provider_type)
    return provider


def update_provider(
    db: Session, provider_id: uuid.UUID, data: ProviderUpdate, user_id: uuid.UUID | None = None
) -> Provider:
    provider = get_provider(db, provider_id, user_id)
    if data.name is not None:
        ensure_unique_name(db, data.name, exclude_id=provider.id, user_id=user_id)
        provider.name = data.name
    if data.credentials is not None:
        provider.credentials_encrypted = encrypt(json.dumps(data.credentials))
    if data.metadata is not None:
        provider.metadata_ = data.metadata
    if data.is_active is not None:
        provider.is_active = data.is_active
    db.commit()
    db.refresh(provider)
    _invalidate_provider_cache(provider.id)
    logger.info("provider updated: %s", provider.id)
    return provider


def delete_provider(db: Session, provider_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
    provider = get_provider(db, provider_id, user_id)
    provider.is_deleted = True
    provider.deleted_at = datetime.now(timezone.utc)
    provider.is_active = False
    db.commit()
    _invalidate_provider_cache(provider.id)
    logger.info("provider soft-deleted: %s", provider.id)


async def validate_provider(
    db: Session,
    provider_id: uuid.UUID,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
) -> tuple[bool, str, float]:
    """Validate via the adapter and persist the result on the provider.

    Fresh validations are cached for cache_ttl.VALIDATION seconds; cache
    hits return the last result without re-probing or rewriting the DB.
    Calls with an explicit transport (tests) always probe live.
    """
    provider = get_provider(db, provider_id, user_id)
    manager = get_manager()
    if transport is None:
        hit = await manager.get(cache_keys.provider_validation(provider.id))
        if isinstance(hit, dict) and "valid" in hit:
            logger.info("provider %s validation: cache hit", provider.id)
            return bool(hit["valid"]), str(hit.get("message", "")), float(hit.get("latency_ms", 0))
    adapter = build_adapter(provider, None, decrypted_credentials(provider), transport)
    try:
        valid, message, latency = await adapter.validate_credentials()
    except Exception as e:
        logger.exception("provider %s validation crashed", provider.id)
        valid, message, latency = False, f"validation failed: {e}", 0
    checked_at = datetime.now(timezone.utc)
    provider.validation_status = "valid" if valid else "invalid"
    provider.validation_message = message
    provider.last_validated_at = checked_at
    db.commit()
    if transport is None:
        await manager.set(
            cache_keys.provider_validation(provider.id),
            {"valid": valid, "message": message, "latency_ms": latency, "checked_at": checked_at.isoformat()},
            ttl=cache_ttl.VALIDATION,
        )
    logger.info("provider %s validation: valid=%s (%s)", provider.id, valid, message)
    return valid, message, latency


async def discover_provider_models(
    db: Session,
    provider_id: uuid.UUID,
    transport: httpx.AsyncBaseTransport | None = None,
    user_id: uuid.UUID | None = None,
) -> DiscoveryResult:
    """Refresh the provider's discovery cache. Never registers or modifies models.

    Fetches the current model list from the provider, enriches each entry with
    repository intelligence (pricing/capabilities/match type), and stores the
    result on provider metadata for the Available/Registered panels.

    Fresh results are cached for cache_ttl.DISCOVERY seconds behind a
    provider_refresh lock; cache hits recompute registration live from the
    DB. Calls with an explicit transport (tests) always fetch live.
    """
    from tollms.api.models.service import list_models as _list  # avoid import cycle at module load
    from tollms.services.model_repository.mapping import map_models as _map

    provider = get_provider(db, provider_id, user_id)
    registered = {m.model_id for m in _list(db, provider_id=provider.id, user_id=user_id)}
    manager = get_manager()
    cache_key = cache_keys.provider_models(provider.id)
    if transport is None:
        hit = await manager.get(cache_key)
        if isinstance(hit, dict) and isinstance(hit.get("models"), list):
            logger.info("provider %s discovery: cache hit (%s models)", provider.id, hit.get("total", 0))
            return _discovery_from_cache(provider, hit, registered)
    lock_key = cache_keys.provider_refresh_lock(provider.id)
    async with locked(lock_key, cache_ttl.LOCK_PROVIDER_REFRESH * 1000) as acquired:
        if not acquired:
            # Another worker is refreshing; serve cache if it landed meanwhile.
            hit = await manager.get(cache_key)
            if isinstance(hit, dict) and isinstance(hit.get("models"), list):
                return _discovery_from_cache(provider, hit, registered)
            logger.warning("provider %s discovery: refresh busy, fetching live", provider.id)
        try:
            creds = decrypted_credentials(provider)
            adapter = build_adapter(provider, None, creds, transport)
            discovered = await adapter.discover_models()
        except Exception as e:
            logger.exception("provider %s discovery crashed", provider.id)
            return DiscoveryResult(provider_id=provider.id, message=f"discovery failed: {e}")
    mapped = {
        m["model_id"]: m
        for m in _map(
            db,
            [d.model_id for d in discovered],
            provider_type=provider.provider_type.value,
            base_url=(creds.get("base_url") if isinstance(creds, dict) else None),
        )
    }
    infos = []
    for d in discovered:
        match = mapped.get(d.model_id, {})
        suggested = _json_safe(match.get("suggested") or {})
        # Provider identity wins; repository match supplies pricing/capabilities.
        suggested["model_id"] = d.model_id
        suggested["name"] = d.name or d.model_id
        if d.endpoint_type:
            suggested["endpoint_type"] = d.endpoint_type
        ctx = d.context_window if d.context_window is not None else suggested.get("context_window")
        max_out = d.max_output_tokens if d.max_output_tokens is not None else suggested.get("max_output_tokens")
        for price_key in ("input_price", "output_price", "cache_read_price", "cache_write_price"):
            val = suggested.get(price_key)
            if val is not None:
                s_val = str(val)
                if "." in s_val:
                    suggested[price_key] = s_val.rstrip("0").rstrip(".") or "0"
        if ctx is not None:
            suggested["context_window"] = ctx
        if max_out is not None:
            suggested["max_output_tokens"] = max_out
        infos.append(
            {
                "model_id": d.model_id,
                "name": d.name or d.model_id,
                "endpoint_type": d.endpoint_type,
                "context_window": ctx,
                "max_output_tokens": max_out,
                "repository_model_key": match.get("repository_model_key"),
                "match_type": match.get("match_type", "fallback"),
                "suggested": suggested,
                "repository_match": _json_safe(match.get("repository_match") or {}),
            }
        )
    now = datetime.now(timezone.utc)
    provider.metadata_ = {
        **(provider.metadata_ or {}),
        "discovery": {"models": infos, "total": len(infos), "last_discovery_at": now.isoformat()},
    }
    db.commit()
    if transport is None:
        await manager.set(
            cache_key,
            {"models": infos, "total": len(infos), "last_discovery_at": now.isoformat()},
            ttl=cache_ttl.DISCOVERY,
        )
    new_count = sum(1 for i in infos if i["model_id"] not in registered)
    logger.info("provider %s discovery: %s found, %s new", provider.id, len(infos), new_count)
    return DiscoveryResult(
        provider_id=provider.id,
        discovered=[DiscoveredModelInfo(**i) for i in infos],
        total=len(infos),
        new_count=new_count,
        registered_count=len(registered),
        last_discovery_at=now,
        message=f"{len(infos)} found, {new_count} available",
    )


def _discovery_from_cache(provider: Provider, hit: dict, registered: set[str]) -> DiscoveryResult:
    """Rebuild a DiscoveryResult from the Valkey payload with live registration."""
    try:
        discovered = [DiscoveredModelInfo(**i) for i in hit.get("models", [])]
    except Exception:
        logger.warning("provider %s discovery: corrupt cache entry", provider.id, exc_info=True)
        return DiscoveryResult(provider_id=provider.id, message="discovery cache unreadable")
    try:
        last = datetime.fromisoformat(str(hit.get("last_discovery_at", "")))
    except ValueError:
        last = None
    total = int(hit.get("total", len(discovered)))
    new_count = sum(1 for d in discovered if d.model_id not in registered)
    return DiscoveryResult(
        provider_id=provider.id,
        discovered=discovered,
        total=total,
        new_count=new_count,
        registered_count=len(registered),
        last_discovery_at=last,
        message=f"{total} found, {new_count} available",
    )


def _json_safe(value: Any) -> Any:
    """Recursively convert dates/decimals to JSON-safe scalars for metadata storage."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


async def draft_validate(
    provider_type: ProviderType,
    credentials: dict,
    transport: httpx.AsyncBaseTransport | None = None,
):
    """Validate credentials without persisting anything. Returns (valid, message, latency, discovered)."""
    from tollms.services.gateway.adapters.base import DiscoveredModel

    probe = Provider(name="draft", provider_type=provider_type, credentials_encrypted="")
    adapter = build_adapter(probe, None, credentials, transport)
    try:
        valid, message, latency = await adapter.validate_credentials()
    except Exception as e:
        logger.exception("draft validation crashed")
        return False, f"validation failed: {e}", 0, []
    discovered: list[DiscoveredModel] = []
    if valid:
        try:
            discovered = await adapter.discover_models()
        except Exception as e:
            logger.exception("draft discovery crashed")
            message = f"{message} (model listing failed: {e})"
    return valid, message, latency, discovered


def register_provider(
    db: Session, data, user_id: uuid.UUID | None = None
) -> tuple[Provider, list[AIModel], dict[str, int]]:
    """Atomic wizard registration: provider + selected models. Nothing persists on failure."""
    from tollms.api.models.service import create_model as _create_model

    ensure_unique_name(db, data.name, user_id=user_id)
    provider = Provider(
        user_id=user_id,
        name=data.name.strip(),
        provider_type=data.provider_type,
        credentials_encrypted=encrypt(json.dumps(data.credentials)),
        metadata_={**(data.metadata or {}), **({"description": data.description} if data.description else {})},
        validation_status=data.validation_status or "unknown",
        validation_message=data.validation_message,
        last_validated_at=datetime.now(timezone.utc) if data.validation_status else None,
    )
    db.add(provider)
    db.flush()  # id for models; commit once at the end
    models: list[AIModel] = []
    match_stats = {"provider_specific": 0, "global": 0, "fallback": 0}
    for m in data.models:
        payload = m.model_dump(exclude={"repository_match"})
        payload["provider_id"] = provider.id
        model = _create_model(
            db,
            _model_create(**payload),
            repository_match=(m.repository_match or None),
            commit=False,
            user_id=user_id,
        )
        models.append(model)
        match_type = (m.repository_match or {}).get("match_type", "fallback")
        match_stats[match_type if match_type in match_stats else "fallback"] += 1
    db.commit()
    db.refresh(provider)
    logger.info("provider registered: %s (%s) with %s models", provider.id, provider.provider_type, len(models))
    return provider, models, match_stats


def _model_create(**kwargs):
    from tollms.api.models.schemas import ModelCreate

    return ModelCreate(**kwargs)


def credential_security(provider: Provider) -> dict:
    """Validate at-rest encryption: ciphertext present, decryptable, masked."""
    from tollms.core.crypto import ALGORITHM, decrypt

    keys: list[str] = []
    masked = False
    encrypted = False
    raw = provider.credentials_encrypted or ""
    if raw:
        try:
            payload = decrypt(raw)
            keys = sorted(payload.keys())
            encrypted = True
            masked = bool(masked_credentials(provider))
        except Exception:
            logger.warning("provider %s: credentials are not decryptable", provider.id, exc_info=True)
    return {
        "encrypted": encrypted,
        "masked": masked,
        "algorithm": ALGORITHM,
        "credential_keys": keys,
        "validation_status": provider.validation_status or "unknown",
        "last_validated_at": provider.last_validated_at,
    }
