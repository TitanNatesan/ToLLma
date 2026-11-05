"""Organizations endpoints: composition of per-domain routers (no logic here).

The two root routes (``POST``/``GET /api/v1/orgs``) are registered directly
rather than via ``include_router``: FastAPI 0.141 rejects nested includes of
empty-path routes even when the parent carries the prefix. Their logic stays
in ``overview/service.py`` — the defs below are pure wiring, like the includes.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.orgs.analytics.router import router as analytics_router
from tollms.api.orgs.audit.router import router as audit_router
from tollms.api.orgs.budgets.router import router as budgets_router
from tollms.api.orgs.invitations.router import router as invitations_router
from tollms.api.orgs.keys.router import router as keys_router
from tollms.api.orgs.members.router import router as members_router
from tollms.api.orgs.overview import service
from tollms.api.orgs.overview.router import router as overview_router
from tollms.api.orgs.permissions.router import router as permissions_router
from tollms.api.orgs.providers.router import router as providers_router
from tollms.api.orgs.requests.router import router as requests_router
from tollms.api.orgs.schemas import OrgCreate, OrgRead
from tollms.api.orgs.teams.router import router as teams_router
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/orgs", tags=["organizations"])


@router.post("", response_model=OrgRead, status_code=201)
def create_org(data: OrgCreate, db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.create_organization(
        db, user.id, name=data.name, description=data.description, website=data.website,
        industry=data.industry, location=data.location, size=data.size,
    )


@router.get("", response_model=list[OrgRead])
def my_orgs(db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.list_my_organizations(db, user.id)


router.include_router(overview_router)
router.include_router(members_router)
router.include_router(permissions_router)
router.include_router(teams_router)
router.include_router(invitations_router)
router.include_router(requests_router)
router.include_router(audit_router)
router.include_router(keys_router)
router.include_router(providers_router)
router.include_router(budgets_router)
router.include_router(analytics_router)
