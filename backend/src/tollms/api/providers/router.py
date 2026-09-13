"""Provider endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.api.providers import service
from tollms.api.providers.schemas import (
    DiscoveryResult,
    DraftDiscoveredModel,
    DraftValidate,
    DraftValidationResult,
    ProviderCreate,
    ProviderRead,
    ProviderRegister,
    ProviderUpdate,
    RegisterResult,
    ValidationResult,
)

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])


def _read(p) -> ProviderRead:
    return ProviderRead(
        id=p.id,
        name=p.name,
        provider_type=p.provider_type,
        credentials_masked=service.masked_credentials(p),
        metadata_=p.metadata_,
        is_active=p.is_active,
        validation_status=p.validation_status,
        validation_message=p.validation_message,
        last_validated_at=p.last_validated_at,
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


@router.post("/draft-validate", response_model=DraftValidationResult)
async def draft_validate(data: DraftValidate) -> DraftValidationResult:
    """Validate credentials without persisting anything (wizard step 3)."""
    valid, message, latency, discovered = await service.draft_validate(data.provider_type, data.credentials)
    return DraftValidationResult(
        valid=valid,
        message=message,
        latency_ms=latency,
        discovered=[
            DraftDiscoveredModel(
                model_id=d.model_id,
                name=d.name,
                endpoint_type=d.endpoint_type,
                context_window=d.context_window,
                max_output_tokens=d.max_output_tokens,
            )
            for d in discovered
        ],
    )


@router.post("/register", response_model=RegisterResult, status_code=201)
def register(data: ProviderRegister, db: Session = Depends(get_db)) -> RegisterResult:
    """Atomic wizard registration (step 5): provider + selected models or nothing."""
    provider, models, match_stats = service.register_provider(db, data)
    return RegisterResult(
        provider=_read(provider), models_created=len(models), match_stats=match_stats
    )


@router.post("/{provider_id}/validate", response_model=ValidationResult)
async def validate(provider_id: uuid.UUID, db: Session = Depends(get_db)) -> ValidationResult:
    valid, message, latency = await service.validate_provider(db, provider_id)
    return ValidationResult(valid=valid, message=message, latency_ms=latency)


@router.post("/{provider_id}/discover", response_model=DiscoveryResult)
async def discover(provider_id: uuid.UUID, db: Session = Depends(get_db)) -> DiscoveryResult:
    return await service.discover_provider_models(db, provider_id)
