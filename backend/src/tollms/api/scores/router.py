"""Score endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.scores import service
from tollms.api.scores.schemas import ScoreCreate, ScoreList, ScoreRead
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/scores", tags=["scores"])


@router.post("", response_model=ScoreRead)
def create_score(
    data: ScoreCreate,
    org_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ScoreRead:
    return service.create_score(db, user.id, data, org_id)


@router.get("", response_model=ScoreList)
def list_scores(
    response: Response,
    org_id: uuid.UUID | None = None,
    trace_id: str | None = Query(default=None, max_length=128),
    prompt_log_id: uuid.UUID | None = None,
    session_key: str | None = Query(default=None, max_length=128),
    name: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ScoreList:
    rows, next_cursor = service.list_scores(
        db, user.id, org_id=org_id, trace_id=trace_id,
        prompt_log_id=prompt_log_id, session_key=session_key, name=name,
        limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return ScoreList(items=rows)


@router.delete("/{score_id}", status_code=204)
def delete_score(
    score_id: uuid.UUID,
    org_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> None:
    service.delete_score(db, user.id, score_id, org_id)
