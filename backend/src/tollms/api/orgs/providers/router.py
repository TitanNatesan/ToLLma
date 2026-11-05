"""Org provider endpoints."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.models.schemas import ModelRead, ModelUpdate, read_model
from tollms.api.orgs.providers import service
from tollms.api.orgs.providers.schemas import OrgModelCreate
from tollms.api.orgs.schemas import OrgProviderRegister
from tollms.api.providers.router import _read as _read_provider
from tollms.api.providers.schemas import ProviderCreate, ProviderRead, ProviderUpdate
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.post("/{org_id}/providers", response_model=ProviderRead, status_code=201)
def create_org_provider(org_id: uuid.UUID, data: ProviderCreate,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_active_user)):
    return _read_provider(service.create_org_provider(db, user.id, org_id, data))



@router.post("/{org_id}/providers/register", response_model=ProviderRead, status_code=201)
def register_org_provider(org_id: uuid.UUID, data: OrgProviderRegister,
                          db: Session = Depends(get_db),
                          user: User = Depends(require_active_user)):
    return _read_provider(service.register_org_provider(db, user.id, org_id, data))



@router.get("/{org_id}/providers", response_model=list[ProviderRead])
def list_org_providers(org_id: uuid.UUID, db: Session = Depends(get_db),
                       user: User = Depends(require_active_user)):
    return [_read_provider(p) for p in service.list_org_providers(db, user.id, org_id)]


@router.get("/{org_id}/providers/{provider_id}/models", response_model=list[ModelRead])
def list_org_provider_models(org_id: uuid.UUID, provider_id: uuid.UUID,
                             db: Session = Depends(get_db),
                             user: User = Depends(require_active_user)):
    """Live models of one org-owned provider (same ModelRead shape as the
    personal registry, so the unified providers page renders org data)."""
    return service.list_org_provider_models(db, user.id, org_id, provider_id)


@router.get("/{org_id}/models", response_model=list[ModelRead])
def list_org_models(org_id: uuid.UUID, db: Session = Depends(get_db),
                    user: User = Depends(require_active_user)):
    """All active models across the org's live providers (key-picker support)."""
    return service.list_org_models(db, user.id, org_id)



@router.patch("/{org_id}/providers/{provider_id}", response_model=ProviderRead)
def update_org_provider(org_id: uuid.UUID, provider_id: uuid.UUID, data: ProviderUpdate,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_active_user)):
    return _read_provider(service.update_org_provider(db, user.id, org_id, provider_id, data))



@router.delete("/{org_id}/providers/{provider_id}", status_code=204)
def delete_org_provider(org_id: uuid.UUID, provider_id: uuid.UUID,
                        db: Session = Depends(get_db),
                        user: User = Depends(require_active_user)):
    service.delete_org_provider(db, user.id, org_id, provider_id)

@router.post("/{org_id}/providers/{provider_id}/models", response_model=ModelRead, status_code=201)
def create_org_provider_model(org_id: uuid.UUID, provider_id: uuid.UUID, data: OrgModelCreate,
                              db: Session = Depends(get_db),
                              user: User = Depends(require_active_user)):
    """Register one model on an org-owned provider (201 ModelRead). Body is
    the personal ModelCreate shape; provider_id must match the path or be
    omitted. Perm: Providers.Create + live membership."""
    return read_model(service.create_org_model(db, user.id, org_id, provider_id, data))


@router.patch("/{org_id}/models/{model_id}", response_model=ModelRead)
def update_org_model(org_id: uuid.UUID, model_id: uuid.UUID, data: ModelUpdate,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)):
    """Partial update of an org-owned model (incl. is_active). Perm:
    Providers.Update + live membership; 404 oracle otherwise."""
    return read_model(service.update_org_model(db, user.id, org_id, model_id, data))


@router.delete("/{org_id}/models/{model_id}", status_code=204)
def delete_org_model(org_id: uuid.UUID, model_id: uuid.UUID,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)):
    """Soft-delete an org-owned model (mirrors personal delete). Perm:
    Providers.Delete + live membership; 404 oracle otherwise."""
    service.delete_org_model(db, user.id, org_id, model_id)
