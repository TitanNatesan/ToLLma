"""Request-log endpoints: per-request observability and log-based aggregates."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.request_logs import service
from tollms.api.request_logs.schemas import RequestLogPage, RequestLogSummary
from tollms.core.deps import get_db
from tollms.core.security import require_verified_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/request-logs", tags=["request-logs"])


@router.get("", response_model=RequestLogPage)
def list_logs(
    conversation_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, pattern="^(success|failed|cancelled|regenerated)$"),
    error_code: str | None = Query(default=None, max_length=48),
    regenerations_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> RequestLogPage:
    return service.list_logs(
        db,
        user.id,
        conversation_id=conversation_id,
        status=status,
        error_code=error_code,
        regenerations_only=regenerations_only,
        limit=limit,
        offset=offset,
    )


@router.get("/summary", response_model=RequestLogSummary)
def summary(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(require_verified_user),
) -> RequestLogSummary:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return service.summary(db, user.id, start, end)
