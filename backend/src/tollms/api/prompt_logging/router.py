"""Prompt logging endpoints only. No business logic."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

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


@router.put("/settings/keys/{key_id}", response_model=SettingsRead)
def write_key_state(key_id: uuid.UUID, data: KeyStateUpdate,
                    org_id: uuid.UUID | None = None,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_active_user)) -> SettingsRead:
    return service.set_key_state(db, user.id, org_id, key_id, data.enabled)


@router.get("/logs", response_model=LogList)
def list_prompt_logs(
    response: Response,
    org_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    key_id: uuid.UUID | None = Query(default=None, alias="key_id"),
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, max_length=32),
    date_from: str | None = Query(default=None, alias="from", max_length=64),
    date_to: str | None = Query(default=None, alias="to", max_length=64),
    q: str | None = Query(default=None, max_length=128),
    trace_id: str | None = Query(default=None, max_length=128),
    session_key: str | None = Query(default=None, max_length=128),
    level: str | None = Query(default=None, max_length=16),
    min_cost: float | None = Query(default=None, ge=0),
    max_cost: float | None = Query(default=None, ge=0),
    min_tokens: int | None = Query(default=None, ge=0),
    max_tokens: int | None = Query(default=None, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> LogList:
    rows, next_cursor = service.list_logs(
        db, user.id, org_id=org_id, user_id=user_id, key_id=key_id,
        provider_id=provider_id, model_id=model_id,
        status=status, date_from=date_from, date_to=date_to, q=q,
        trace_id=trace_id, session_key=session_key, level=level,
        min_cost=(Decimal(str(min_cost)) if min_cost is not None else None),
        max_cost=(Decimal(str(max_cost)) if max_cost is not None else None),
        min_tokens=min_tokens, max_tokens=max_tokens,
        limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return LogList(items=rows)


@router.get("/logs/export")
def export_prompt_logs(
    response: Response,
    org_id: uuid.UUID | None = None,
    format: str = Query(default="csv", max_length=8),
    trace_id: str | None = Query(default=None, max_length=128),
    session_key: str | None = Query(default=None, max_length=128),
    status: str | None = Query(default=None, max_length=32),
    level: str | None = Query(default=None, max_length=16),
    min_cost: float | None = Query(default=None, ge=0),
    max_cost: float | None = Query(default=None, ge=0),
    min_tokens: int | None = Query(default=None, ge=0),
    max_tokens: int | None = Query(default=None, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
):
    from fastapi.responses import Response as RawResponse

    content, media_type, next_cursor, count = service.export_logs(
        db, user.id, org_id=org_id, format=format,
        trace_id=trace_id, session_key=session_key, status=status,
        level=level,
        min_cost=(Decimal(str(min_cost)) if min_cost is not None else None),
        max_cost=(Decimal(str(max_cost)) if max_cost is not None else None),
        min_tokens=min_tokens, max_tokens=max_tokens,
        limit=limit, cursor=cursor)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ext = "csv" if format == "csv" else "jsonl"
    headers = {
        "Content-Disposition": f"attachment; filename=tollma-prompt-logs-{stamp}.{ext}",
    }
    if next_cursor is not None:
        headers["X-Next-Cursor"] = next_cursor
    return RawResponse(content=content, media_type=media_type, headers=headers)


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
