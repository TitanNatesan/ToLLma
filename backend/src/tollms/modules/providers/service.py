"""Provider registry: CRUD + credential encryption/masking + validation."""

import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.core.crypto import decrypt, encrypt, mask
from tollms.core.exceptions import NotFoundError
from tollms.modules.providers.models import Provider
from tollms.modules.providers.schemas import ProviderCreate, ProviderUpdate
from tollms.modules.providers.utils import validate_credentials

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


def validate_provider(db: Session, provider_id: uuid.UUID) -> tuple[bool, str, float]:
    provider = get_provider(db, provider_id)
    valid, message, latency = validate_credentials(provider.provider_type, decrypted_credentials(provider))
    logger.info("provider %s validation: valid=%s (%s)", provider.id, valid, message)
    return valid, message, latency
