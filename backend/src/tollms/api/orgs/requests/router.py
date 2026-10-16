"""Join-request queue endpoints."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.requests import service
from tollms.api.orgs.schemas import AssignSets, InvitationRead, MemberRead
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.post("/{org_id}/requests", response_model=InvitationRead, status_code=201)
def request_join(org_id: uuid.UUID, db: Session = Depends(get_db),
                 user: User = Depends(require_active_user)):
    return service.request_join(db, user.id, org_id)



@router.get("/{org_id}/requests", response_model=list[InvitationRead])
def list_requests(org_id: uuid.UUID, status: str | None = None,
                  search: str | None = Query(default=None, max_length=320),
                  limit: int | None = None, offset: int = 0,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.list_requests(db, user.id, org_id, status=status, search=search,
                                 limit=limit, offset=offset)



@router.post("/{org_id}/requests/{invitation_id}/approve", response_model=MemberRead)
def approve_request(org_id: uuid.UUID, invitation_id: uuid.UUID, data: AssignSets,
                    db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.approve_request(db, user.id, org_id, invitation_id, data.set_ids)



@router.post("/{org_id}/requests/{invitation_id}/reject", status_code=204)
def reject_request(org_id: uuid.UUID, invitation_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    service.reject_request(db, user.id, org_id, invitation_id)

