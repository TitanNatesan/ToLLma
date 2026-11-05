"""Membership roster endpoints."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.members import service
from tollms.api.orgs.schemas import MemberRead
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.get("/{org_id}/members", response_model=list[MemberRead])
def list_members(org_id: uuid.UUID, search: str | None = Query(default=None, max_length=120),
                 state: str | None = None, limit: int | None = None, offset: int = 0,
                 db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_members(db, user.id, org_id, search=search, state=state,
                                limit=limit, offset=offset)



@router.post("/{org_id}/members/{target_user_id}/suspend", response_model=MemberRead)
def suspend_member(org_id: uuid.UUID, target_user_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    return service.suspend_member(db, user.id, org_id, target_user_id)



@router.post("/{org_id}/members/{target_user_id}/resume", response_model=MemberRead)
def resume_member(org_id: uuid.UUID, target_user_id: uuid.UUID, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.resume_member(db, user.id, org_id, target_user_id)



@router.delete("/{org_id}/members/{target_user_id}", status_code=204)
def remove_member(org_id: uuid.UUID, target_user_id: uuid.UUID, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    service.remove_member(db, user.id, org_id, target_user_id)



@router.post("/{org_id}/leave", status_code=204)
def leave(org_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    service.leave_organization(db, user.id, org_id)

