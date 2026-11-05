"""Model endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User
from tollms.api.models import service
from tollms.api.models.schemas import ModelCreate, ModelRead, ModelUpdate, read_model

router = APIRouter(prefix="/api/v1/models", tags=["models"])


def _read(m) -> ModelRead:
    return read_model(m)


@router.post("", response_model=ModelRead, status_code=201)
def create(data: ModelCreate, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ModelRead:
    return _read(service.create_model(db, data, user_id=user.id, personal_only=True))


@router.get("", response_model=list[ModelRead])
def list_all(
    provider_id: uuid.UUID | None = None,
    search: str | None = None,
    capability: str | None = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ModelRead]:
    models = service.list_models(db, provider_id=provider_id, search=search, capability=capability, active_only=active_only, user_id=user.id, personal_only=True)
    return [_read(m) for m in models]


@router.get("/{model_id}", response_model=ModelRead)
def get(model_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ModelRead:
    return _read(service.get_model(db, model_id, user.id, personal_only=True))



@router.patch("/{model_id}", response_model=ModelRead)
def update(model_id: uuid.UUID, data: ModelUpdate, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> ModelRead:
    return _read(service.update_model(db, model_id, data, user.id, personal_only=True))


@router.delete("/{model_id}", status_code=204)
def delete(model_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)) -> None:
    service.delete_model(db, model_id, user.id, personal_only=True)
