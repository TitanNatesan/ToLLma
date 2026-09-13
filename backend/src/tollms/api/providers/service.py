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


def get_provider(db: Session, provider_id: uuid.UUID) -> Provider:
    provider = db.get(Provider, provider_id)
    if provider is None or provider.is_deleted:
        raise NotFoundError(f"provider {provider_id} not found")
    return provider


def list_providers(db: Session, *, active_only: bool = False) -> list[Provider]:
    stmt = select(Provider).where(Provider.is_deleted.is_(False)).order_by(Provider.created_at)
    if active_only:
        stmt = stmt.where(Provider.is_active.is_(True))
    return list(db.scalars(stmt))


def ensure_unique_name(db: Session, name: str, exclude_id: uuid.UUID | None = None) -> None:
    stmt = select(Provider).where(Provider.is_deleted.is_(False), Provider.name.ilike(name.strip()))
    if exclude_id is not None:
        stmt = stmt.where(Provider.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ValidationError(f"provider name {name.strip()!r} is already taken")


def create_provider(db: Session, data: ProviderCreate) -> Provider:
    ensure_unique_name(db, data.name)
    provider = Provider(
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


def update_provider(db: Session, provider_id: uuid.UUID, data: ProviderUpdate) -> Provider:
    provider = get_provider(db, provider_id)
    if data.name is not None:
        ensure_unique_name(db, data.name, exclude_id=provider.id)
        provider.name = data.name
    if data.credentials is not None:
        provider.credentials_encrypted = encrypt(json.dumps(data.credentials))
    if data.metadata is not None:
        provider.metadata_ = data.metadata
    if data.is_active is not None:
        provider.is_active = data.is_active
    db.commit()
    db.refresh(provider)
    logger.info("provider updated: %s", provider.id)
    return provider


def delete_provider(db: Session, provider_id: uuid.UUID) -> None:
    provider = get_provider(db, provider_id)
    provider.is_deleted = True
    provider.deleted_at = datetime.now(timezone.utc)
    provider.is_active = False
    db.commit()
    logger.info("provider soft-deleted: %s", provider.id)


async def validate_provider(
    db: Session, provider_id: uuid.UUID, transport: httpx.AsyncBaseTransport | None = None
) -> tuple[bool, str, float]:
    """Validate via the adapter and persist the result on the provider."""
    provider = get_provider(db, provider_id)
    adapter = build_adapter(provider, None, decrypted_credentials(provider), transport)
    try:
        valid, message, latency = await adapter.validate_credentials()
    except Exception as e:
        logger.exception("provider %s validation crashed", provider.id)
        valid, message, latency = False, f"validation failed: {e}", 0
    provider.validation_status = "valid" if valid else "invalid"
    provider.validation_message = message
    provider.last_validated_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("provider %s validation: valid=%s (%s)", provider.id, valid, message)
    return valid, message, latency


async def discover_provider_models(
    db: Session, provider_id: uuid.UUID, transport: httpx.AsyncBaseTransport | None = None
) -> DiscoveryResult:
    """Refresh the provider's discovery cache. Never registers or modifies models.

    Fetches the current model list from the provider, enriches each entry with
    repository intelligence (pricing/capabilities/match type), and stores the
    result on provider metadata for the Available/Registered panels.
    """
    from tollms.api.models.service import list_models as _list  # avoid import cycle at module load
    from tollms.services.model_repository.mapping import map_models as _map

    provider = get_provider(db, provider_id)
    registered = {m.model_id for m in _list(db, provider_id=provider.id)}
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
        infos.append(
            {
                "model_id": d.model_id,
                "name": d.name or d.model_id,
                "endpoint_type": d.endpoint_type,
                "context_window": d.context_window,
                "max_output_tokens": d.max_output_tokens,
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


def register_provider(db: Session, data) -> tuple[Provider, list[AIModel], dict[str, int]]:
    """Atomic wizard registration: provider + selected models. Nothing persists on failure."""
    from tollms.api.models.service import create_model as _create_model

    ensure_unique_name(db, data.name)
    provider = Provider(
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
