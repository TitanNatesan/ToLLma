"""Audit trail endpoints."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.audit import service
from tollms.api.orgs.schemas import AuditRead
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.get("/{org_id}/audit", response_model=list[AuditRead])
def get_audit(org_id: uuid.UUID, limit: int = 100, action: str | None = Query(default=None, max_length=64),
              actor: str | None = None, cursor: str | None = Query(default=None, max_length=64),
              from_: str | None = Query(default=None, alias="from", max_length=64),
              to_: str | None = Query(default=None, alias="to", max_length=64),
              db: Session = Depends(get_db),
              user: User = Depends(require_active_user)):
    return service.get_audit(db, user.id, org_id, limit, action=action, actor=actor,
                             from_=from_, to_=to_, cursor=cursor)

