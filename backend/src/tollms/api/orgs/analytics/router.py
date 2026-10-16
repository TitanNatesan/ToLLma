"""Org analytics endpoints."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.analytics import service
from tollms.api.orgs.schemas import AnalyticsOverview
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.get("/{org_id}/analytics/overview", response_model=AnalyticsOverview)
def analytics_overview(org_id: uuid.UUID,
                       from_: str | None = Query(default=None, alias="from", max_length=64),
                       to_: str | None = Query(default=None, alias="to", max_length=64),
                       team_id: str | None = None, key_id: str | None = None,
                       db: Session = Depends(get_db),
                       user: User = Depends(require_active_user)):
    return service.org_analytics_overview(db, user.id, org_id, from_=from_, to_=to_,
                                          team_id=team_id, key_id=key_id)

