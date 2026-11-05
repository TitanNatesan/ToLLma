"""Benchmark run endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from tollms.api.benchmarks import service
from tollms.api.benchmarks.schemas import (
    BenchmarkRunCreate,
    BenchmarkRunList,
    BenchmarkRunRead,
)
from tollms.core.deps import get_db
from tollms.core.security import require_active_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/benchmarks", tags=["benchmarks"])


@router.post("/runs", response_model=BenchmarkRunRead, status_code=201)
def create_run(
    data: BenchmarkRunCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> BenchmarkRunRead:
    return service.create_run(db, user.id, data)


@router.get("/runs", response_model=BenchmarkRunList)
def list_runs(
    response: Response,
    org_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> BenchmarkRunList:
    rows, next_cursor = service.list_runs(
        db, user.id, org_id=org_id, limit=limit, cursor=cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return BenchmarkRunList(items=rows)


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(
    run_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> None:
    service.delete_run(db, user.id, run_id)
