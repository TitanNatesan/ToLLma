"""Model endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.modules.models import service
from tollms.modules.models.schemas import ModelCreate, ModelRead, ModelUpdate

router = APIRouter(prefix="/api/v1/models", tags=["models"])


def _read(m) -> ModelRead:
    return ModelRead(
        id=m.id,
        provider_id=m.provider_id,
        model_id=m.model_id,
        name=m.name,
        description=m.description,
        endpoint_type=m.endpoint_type,
        input_price=m.input_price,
        output_price=m.output_price,
        cache_read_price=m.cache_read_price,
        cache_write_price=m.cache_write_price,
        supports_text=m.supports_text,
        supports_vision=m.supports_vision,
        supports_audio_input=m.supports_audio_input,
        supports_audio_output=m.supports_audio_output,
        supports_image_generation=m.supports_image_generation,
        supports_tool_calling=m.supports_tool_calling,
        supports_reasoning=m.supports_reasoning,
        supports_streaming=m.supports_streaming,
        context_window=m.context_window,
        max_output_tokens=m.max_output_tokens,
        release_date=m.release_date,
        repository_model_key=m.repository_model_key,
        metadata=m.metadata_,
        is_active=m.is_active,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.post("", response_model=ModelRead, status_code=201)
def create(data: ModelCreate, db: Session = Depends(get_db)) -> ModelRead:
    return _read(service.create_model(db, data))


@router.get("", response_model=list[ModelRead])
def list_all(
    provider_id: uuid.UUID | None = None,
    search: str | None = None,
    capability: str | None = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
) -> list[ModelRead]:
    models = service.list_models(db, provider_id=provider_id, search=search, capability=capability, active_only=active_only)
    return [_read(m) for m in models]


@router.get("/{model_id}", response_model=ModelRead)
def get(model_id: uuid.UUID, db: Session = Depends(get_db)) -> ModelRead:
    return _read(service.get_model(db, model_id))


@router.patch("/{model_id}", response_model=ModelRead)
def update(model_id: uuid.UUID, data: ModelUpdate, db: Session = Depends(get_db)) -> ModelRead:
    return _read(service.update_model(db, model_id, data))


@router.delete("/{model_id}", status_code=204)
def delete(model_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    service.delete_model(db, model_id)
