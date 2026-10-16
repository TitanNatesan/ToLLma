"""Team endpoints."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.orgs.teams import service
from tollms.api.orgs.schemas import (
    AssignSets,
    TeamCreate,
    TeamDetail,
    TeamMemberAdd,
    TeamRead,
    TeamUpdate,
)
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter()


@router.post("/{org_id}/teams", response_model=TeamDetail, status_code=201)
def create_team(org_id: uuid.UUID, data: TeamCreate, db: Session = Depends(get_db),
                user: User = Depends(require_active_user)):
    return service.create_team(db, user.id, org_id, name=data.name,
                               description=data.description, set_ids=data.set_ids)



@router.get("/{org_id}/teams", response_model=list[TeamRead], response_model_exclude_unset=True)
def list_teams(org_id: uuid.UUID, include: str | None = Query(default=None, max_length=64),
               search: str | None = Query(default=None, max_length=120),
               limit: int | None = None, offset: int = 0,
               db: Session = Depends(get_db),
               user: User = Depends(require_active_user)):
    return service.list_teams(db, user.id, org_id, include=include, search=search,
                              limit=limit, offset=offset)



@router.get("/{org_id}/teams/{team_id}", response_model=TeamDetail)
def get_team(org_id: uuid.UUID, team_id: uuid.UUID, db: Session = Depends(get_db),
             user: User = Depends(require_active_user)):
    return service.get_team(db, user.id, org_id, team_id)



@router.patch("/{org_id}/teams/{team_id}", response_model=TeamDetail)
def update_team(org_id: uuid.UUID, team_id: uuid.UUID, data: TeamUpdate,
                db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.update_team(db, user.id, org_id, team_id, **data.model_dump(exclude_unset=True))



@router.delete("/{org_id}/teams/{team_id}", status_code=204)
def delete_team(org_id: uuid.UUID, team_id: uuid.UUID, db: Session = Depends(get_db),
                user: User = Depends(require_active_user)):
    service.delete_team(db, user.id, org_id, team_id)



@router.post("/{org_id}/teams/{team_id}/members", response_model=TeamDetail)
def add_team_member(org_id: uuid.UUID, team_id: uuid.UUID, data: TeamMemberAdd,
                    db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.add_team_member(db, user.id, org_id, team_id, data.user_id)



@router.delete("/{org_id}/teams/{team_id}/members/{target_user_id}", status_code=204)
def remove_team_member(org_id: uuid.UUID, team_id: uuid.UUID, target_user_id: uuid.UUID,
                       db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    service.remove_team_member(db, user.id, org_id, team_id, target_user_id)



@router.put("/{org_id}/teams/{team_id}/sets", response_model=TeamDetail)
def set_team_sets(org_id: uuid.UUID, team_id: uuid.UUID, data: AssignSets,
                  db: Session = Depends(get_db), user: User = Depends(require_active_user)):
    return service.set_team_sets(db, user.id, org_id, team_id, data.set_ids)

