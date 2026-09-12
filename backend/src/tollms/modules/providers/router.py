"""Provider endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.modules.providers import service
from tollms.modules.providers.schemas import ProviderCreate, ProviderRead, ProviderUpdate, ValidationResult

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])


def _read(p) -> ProviderRead:
    return ProviderRead(
        id=p.id,
        name=p.name,
        provider_type=p.provider_type,
        credentials_masked=service.masked_credentials(p),
        metadata_=p.metadata_,
        is_active=p.is_active,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.post("", response_model=ProviderRead, status_code=201)
def create(data: ProviderCreate, db: Session = Depends(get_db)) -> ProviderRead:
    return _read(service.create_provider(db, data))


@router.get("", response_model=list[ProviderRead])
def list_all(active_only: bool = False, db: Session = Depends(get_db)) -> list[ProviderRead]:
    return [_read(p) for p in service.list_providers(db, active_only=active_only)]


@router.get("/{provider_id}", response_model=ProviderRead)
def get(provider_id: uuid.UUID, db: Session = Depends(get_db)) -> ProviderRead:
    return _read(service.get_provider(db, provider_id))


@router.patch("/{provider_id}", response_model=ProviderRead)
def update(provider_id: uuid.UUID, data: ProviderUpdate, db: Session = Depends(get_db)) -> ProviderRead:
    return _read(service.update_provider(db, provider_id, data))


@router.delete("/{provider_id}", status_code=204)
def delete(provider_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    service.delete_provider(db, provider_id)


@router.post("/{provider_id}/validate", response_model=ValidationResult)
def validate(provider_id: uuid.UUID, db: Session = Depends(get_db)) -> ValidationResult:
    valid, message, latency = service.validate_provider(db, provider_id)
    return ValidationResult(valid=valid, message=message, latency_ms=latency)
