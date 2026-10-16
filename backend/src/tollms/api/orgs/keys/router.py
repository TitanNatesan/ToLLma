"""Org key endpoints (metadata only — raw key shown once at issuance)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.keys import service
from tollms.api.orgs.schemas import OrgKeyCreate, OrgKeyCreated, OrgKeyRead
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.post("/{org_id}/keys", response_model=OrgKeyCreated, status_code=201)
def issue_org_key(org_id: uuid.UUID, data: OrgKeyCreate, db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    """Issue an org-scoped key to an ACTIVE member. `raw_key` shown once."""
    key, raw_key = service.create_org_key(
        db, user.id, org_id, assignee_user_id=data.assignee_user_id, name=data.name,
        description=data.description, max_budget_usd=data.max_budget_usd,
        model_permissions=data.model_permissions,
    )
    return OrgKeyCreated(key=key, raw_key=raw_key)



@router.get("/{org_id}/keys", response_model=list[OrgKeyRead])
def list_org_keys(org_id: uuid.UUID, search: str | None = Query(default=None, max_length=120),
                  limit: int | None = None, offset: int = 0,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)):
    return service.list_org_keys(db, user.id, org_id, search=search, limit=limit, offset=offset)



@router.delete("/{org_id}/keys/{key_id}", status_code=204)
def revoke_org_key(org_id: uuid.UUID, key_id: uuid.UUID, db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)):
    service.revoke_org_key(db, user.id, org_id, key_id)

