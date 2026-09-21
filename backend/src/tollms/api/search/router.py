"""Global conversation search endpoints."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from tollms.api.search import service
from tollms.api.search.schemas import SearchResponse, SearchStatusRead
from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("", response_model=SearchResponse)
def search(
    q: str = Query(min_length=1, max_length=500),
    provider_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SearchResponse:
    return service.search_conversations(
        db,
        user.id,
        q,
        provider_id=provider_id,
        model_id=model_id,
        start=start,
        end=end,
        limit=limit,
        offset=offset,
    )


@router.get("/status", response_model=SearchStatusRead)
def status(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> SearchStatusRead:
    return service.index_status(db, user.id)
