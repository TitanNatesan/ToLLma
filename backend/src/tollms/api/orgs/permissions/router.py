"""Permission-set endpoints (CRUD, clone, member assignment)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.permissions import service
from tollms.api.orgs.schemas import (
    AssignSets,
    MemberRead,
    PermissionSetCreate,
    PermissionSetRead,
    PermissionSetUpdate,
)
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.get("/{org_id}/sets", response_model=list[PermissionSetRead])
def list_sets(org_id: uuid.UUID, search: str | None = Query(default=None, max_length=120),
              limit: int | None = None, offset: int = 0,
              db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_sets(db, user.id, org_id, search=search, limit=limit, offset=offset)



@router.post("/{org_id}/sets", response_model=PermissionSetRead, status_code=201)
def create_set(org_id: uuid.UUID, data: PermissionSetCreate, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.create_set(db, user.id, org_id, name=data.name, description=data.description,
                              permissions=data.permissions)



@router.patch("/{org_id}/sets/{set_id}", response_model=PermissionSetRead)
def update_set(org_id: uuid.UUID, set_id: uuid.UUID, data: PermissionSetUpdate,
               db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.update_set(db, user.id, org_id, set_id, name=data.name,
                              description=data.description, permissions=data.permissions)



@router.delete("/{org_id}/sets/{set_id}", status_code=204)
def delete_set(org_id: uuid.UUID, set_id: uuid.UUID, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    service.delete_set(db, user.id, org_id, set_id)



@router.post("/{org_id}/sets/{set_id}/clone", response_model=PermissionSetRead, status_code=201)
def clone_set(org_id: uuid.UUID, set_id: uuid.UUID, data: PermissionSetCreate,
              db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.clone_set(db, user.id, org_id, set_id, name=data.name)



@router.post("/{org_id}/members/{target_user_id}/sets", response_model=MemberRead)
def assign_sets(org_id: uuid.UUID, target_user_id: uuid.UUID, data: AssignSets,
                db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.assign_sets(db, user.id, org_id, target_user_id, data.set_ids)

