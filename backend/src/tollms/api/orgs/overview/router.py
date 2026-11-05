"""Organization CRUD, search, and permission-catalog endpoints."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.common.guards import _member_org
from tollms.api.orgs.overview import service
from tollms.api.orgs.schemas import OrgCard, OrgRead, OrgUpdate
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

# NOTE: no settings/ package — PATCH /{org_id} (update_organization:
# description / website / industry / location / size) is the whole
# org-settings surface (no other settings functions exist).
router = APIRouter()



@router.get("/permissions/catalog")
def permission_catalog(user: User = Depends(require_active_user)) -> list[dict]:
    return service.permission_catalog()



@router.get("/search", response_model=list[OrgCard])
def search_orgs(q: str = Query(min_length=1, max_length=120), limit: int = 20,
                db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.search_organizations(db, q, limit)



@router.get("/{org_id}", response_model=OrgRead)
def get_org(org_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service._read_org(db, _member_org(db, org_id, user.id)[0], user.id)



@router.patch("/{org_id}", response_model=OrgRead)
def update_org(org_id: uuid.UUID, data: OrgUpdate, db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.update_organization(db, user.id, org_id, **data.model_dump(exclude_unset=True))

