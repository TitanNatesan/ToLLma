"""Provider registry: CRUD + credential encryption/masking + validation + discovery."""

import json
import logging
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.crypto import decrypt, encrypt, mask
from tollms.core.exceptions import NotFoundError
from tollms.modules.gateway.factory import build_adapter
from tollms.modules.models.models import AIModel, EndpointType
from tollms.modules.providers.models import Provider
from tollms.modules.providers.schemas import DiscoveryResult, ProviderCreate, ProviderUpdate

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


def create_provider(db: Session, data: ProviderCreate) -> Provider:
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
    """Fetch models from the provider and store the ones we don't have yet."""
    from tollms.modules.models.service import list_models as _list  # avoid import cycle at module load

    provider = get_provider(db, provider_id)
    adapter = build_adapter(provider, None, decrypted_credentials(provider), transport)
    try:
        discovered = await adapter.discover_models()
    except Exception as e:
        logger.exception("provider %s discovery crashed", provider.id)
        return DiscoveryResult(provider_id=provider.id, discovered=[], created=0, message=f"discovery failed: {e}")
    existing = {m.model_id for m in _list(db, provider_id=provider.id)}
    created = 0
    for d in discovered:
        if d.model_id in existing:
            continue
        try:
            endpoint = EndpointType(d.endpoint_type)
        except ValueError:
            endpoint = EndpointType.CHAT_COMPLETIONS
        db.add(
            AIModel(
                provider_id=provider.id,
                model_id=d.model_id,
                name=d.name,
                endpoint_type=endpoint,
                context_window=d.context_window,
                max_output_tokens=d.max_output_tokens,
                metadata_={"discovered": True},
            )
        )
        created += 1
    db.commit()
    logger.info("provider %s discovery: %s found, %s created", provider.id, len(discovered), created)
    return DiscoveryResult(
        provider_id=provider.id,
        discovered=[d.model_id for d in discovered],
        created=created,
        message=f"{len(discovered)} found, {created} added",
    )
