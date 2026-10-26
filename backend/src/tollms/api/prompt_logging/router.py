"""Prompt logging endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.prompt_logging import service
from tollms.api.prompt_logging.schemas import (
    KeyStateUpdate,
    LogDetail,
    LogList,
    PurgeRequest,
    PurgeResult,
    RetentionRead,
    SettingsRead,
    SettingsUpdate,
    TeamRef,
    TeamStateUpdate,
)
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/prompt-logs", tags=["prompt-logs"])


@router.get("/settings", response_model=SettingsRead)
def read_settings(org_id: uuid.UUID | None = None,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_active_user)) -> SettingsRead:
    return service.get_settings(db, user.id, org_id)


@router.put("/settings", response_model=SettingsRead)
def write_settings(data: SettingsUpdate,
                   db: Session = Depends(get_db),
                   user: User = Depends(require_active_user)) -> SettingsRead:
    return service.upsert_settings(db, user.id, data)


@router.put("/settings/teams/{team_id}", response_model=SettingsRead)
def write_team_state(team_id: uuid.UUID, data: TeamStateUpdate,
                     org_id: uuid.UUID | None = None,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_active_user)) -> SettingsRead:
    return service.set_team_state(db, user.id, org_id, team_id, data.enabled)


@router.put("/settings/keys/{key_id}", response_model=SettingsRead)
def write_key_state(key_id: uuid.UUID, data: KeyStateUpdate,
                    org_id: uuid.UUID | None = None,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_active_user)) -> SettingsRead:
    return service.set_key_state(db, user.id, org_id, key_id, data.enabled)


@router.get("/teams", response_model=list[TeamRef])
def team_list(org_id: uuid.UUID | None = None,
              db: Session = Depends(get_db),
              user: User = Depends(require_active_user)) -> list[TeamRef]:
    return service.list_teams(db, user.id, org_id)


@router.get("/logs", response_model=LogList)
def list_prompt_logs(
    response: Response,
    org_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    key_id: uuid.UUID | None = Query(default=None, alias="key_id"),
    team_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, max_length=32),
    date_from: str | None = Query(default=None, alias="from", max_length=64),
    date_to: str | None = Query(default=None, alias="to", max_length=64),
    q: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> LogList:
    rows, next_cursor = service.list_logs(
        db, user.id, org_id=org_id, user_id=user_id, key_id=key_id,
        team_id=team_id, provider_id=provider_id, model_id=model_id,
        status=status, date_from=date_from, date_to=date_to, q=q,
        limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return LogList(items=rows)


@router.get("/logs/{log_id}", response_model=LogDetail)
def log_detail(log_id: uuid.UUID, org_id: uuid.UUID | None = None,
               db: Session = Depends(get_db),
               user: User = Depends(require_active_user)) -> LogDetail:
    return service.get_log_detail(db, user.id, log_id, org_id)


@router.delete("/logs/{log_id}", status_code=204)
def delete_prompt_log(log_id: uuid.UUID, org_id: uuid.UUID | None = None,
                      db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)) -> None:
    service.delete_log(db, user.id, log_id, org_id)


@router.post("/logs/purge", response_model=PurgeResult)
def purge_prompt_logs(data: PurgeRequest | None = None,
                      org_id: uuid.UUID | None = None,
                      db: Session = Depends(get_db),
                      user: User = Depends(require_active_user)) -> PurgeResult:
    before = (data.before if data else None)
    return PurgeResult(expired_count=service.purge_logs(db, user.id, org_id, before))


@router.get("/retention", response_model=RetentionRead)
def retention(org_id: uuid.UUID | None = None,
              db: Session = Depends(get_db),
              user: User = Depends(require_active_user)) -> RetentionRead:
    return service.retention_info(db, user.id, org_id)
