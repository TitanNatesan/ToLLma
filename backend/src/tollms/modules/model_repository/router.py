"""Model repository endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core.exceptions import NotFoundError
from tollms.modules.model_repository import service
from tollms.modules.model_repository.schemas import (
    RepositoryLookupRead,
    RepositoryModelPage,
    RepositoryModelRead,
    RepositoryStatsRead,
    SyncRunRead,
)

router = APIRouter(prefix="/api/v1/model-repository", tags=["model-repository"])


def _read(m) -> RepositoryModelRead:
    # Manual mapping: `metadata` is reserved on SQLAlchemy models (column attr is `metadata_`).
    data = {c.name: getattr(m, c.name) for c in m.__table__.columns if c.name != "metadata"}
    data["metadata"] = m.metadata_
    return RepositoryModelRead(**data)


@router.get("/stats", response_model=RepositoryStatsRead)
def get_stats(db: Session = Depends(get_db)) -> RepositoryStatsRead:
    return RepositoryStatsRead(**service.stats(db))


@router.get("/models", response_model=RepositoryModelPage)
def list_models(
    search: str | None = None,
    provider: str | None = None,
    capability: str | None = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
) -> RepositoryModelPage:
    rows, total = service.list_entries(
        db, search=search, provider=provider, capability=capability,
        active_only=active_only, page=page, page_size=page_size,
    )
    page_size = min(max(page_size, 1), 200)
    return RepositoryModelPage(
        items=[_read(r) for r in rows],
        total=total, page=max(page, 1), page_size=page_size,
    )


@router.get("/models/{entry_id}", response_model=RepositoryModelRead)
def get_model(entry_id: uuid.UUID, db: Session = Depends(get_db)) -> RepositoryModelRead:
    return _read(service.get_entry(db, entry_id))


@router.get("/lookup", response_model=RepositoryLookupRead)
def lookup_model(
    query: str, provider_hint: str | None = None, db: Session = Depends(get_db)
) -> RepositoryLookupRead:
    entry = service.lookup(db, query, provider_hint)
    if entry is None:
        raise NotFoundError(f"no repository match for {query!r}")
    return RepositoryLookupRead(entry=_read(entry), suggested=service.suggest_payload(entry))


@router.post("/sync", response_model=SyncRunRead)
def trigger_sync(db: Session = Depends(get_db)) -> SyncRunRead:
    # Plain def: FastAPI runs it in a threadpool so the blocking fetch is safe.
    return SyncRunRead.model_validate(service.run_sync(db))


@router.get("/sync-history", response_model=list[SyncRunRead])
def get_sync_history(limit: int = 20, db: Session = Depends(get_db)) -> list[SyncRunRead]:
    return [SyncRunRead.model_validate(r) for r in service.sync_history(db, limit)]
