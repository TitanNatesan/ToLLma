"""Model repository endpoints only. No business logic."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.core.deps import get_db
from tollms.core import rate_limit
from tollms.core.security import get_current_user
from tollms.models.user import User
from tollms.core.exceptions import NotFoundError
from tollms.api.repository import service
from tollms.api.repository.schemas import (
    CanonicalDetailRead,
    CanonicalModelPage,
    CanonicalModelRead,
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


def _read_canonical(m) -> CanonicalModelRead:
    # Same `metadata` alias collision as repository rows.
    data = {c.name: getattr(m, c.name) for c in m.__table__.columns if c.name != "metadata"}
    data["metadata"] = m.metadata_
    return CanonicalModelRead(**data)


@router.get("/stats", response_model=RepositoryStatsRead)
def get_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> RepositoryStatsRead:
    return RepositoryStatsRead(**service.stats(db))


@router.get("/models", response_model=RepositoryModelPage)
def list_models(
    search: str | None = None,
    provider: str | None = None,
    capability: str | None = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 50,
    family: str | None = None,
    modality: str | None = None,
    tool_call: bool | None = None,
    reasoning: bool | None = None,
    open_weights: bool | None = None,
    min_context: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RepositoryModelPage:
    rows, total = service.list_entries(
        db, search=search, provider=provider, capability=capability,
        active_only=active_only, page=page, page_size=page_size,
        family=family, modality=modality, tool_call=tool_call,
        reasoning=reasoning, open_weights=open_weights, min_context=min_context,
    )
    page_size = min(max(page_size, 1), 200)
    return RepositoryModelPage(
        items=[_read(r) for r in rows],
        total=total, page=max(page, 1), page_size=page_size,
    )


@router.get("/canonical", response_model=CanonicalModelPage)
def list_canonical(
    search: str | None = None,
    family: str | None = None,
    open_weights: bool | None = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CanonicalModelPage:
    rows, total = service.list_canonicals(
        db, search=search, family=family, open_weights=open_weights,
        page=page, page_size=page_size,
    )
    page_size = min(max(page_size, 1), 200)
    return CanonicalModelPage(
        items=[_read_canonical(r) for r in rows],
        total=total, page=max(page, 1), page_size=page_size,
    )


@router.get("/canonical/{canonical_id:path}", response_model=CanonicalDetailRead)
def get_canonical(
    canonical_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CanonicalDetailRead:
    row = service.get_canonical(db, canonical_id)
    offerings = service.get_canonical_offerings(db, row.canonical_id)
    return CanonicalDetailRead(canonical=_read_canonical(row), offerings=[_read(r) for r in offerings])


@router.get("/models/{entry_id}", response_model=RepositoryModelRead)
def get_model(entry_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> RepositoryModelRead:
    return _read(service.get_entry(db, entry_id))


@router.get("/lookup", response_model=RepositoryLookupRead)
def lookup_model(
    query: str, provider_hint: str | None = None, db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rate_limit.limit("repository:lookup")),
) -> RepositoryLookupRead:
    entry = service.lookup(db, query, provider_hint)
    if entry is None:
        raise NotFoundError(f"no repository match for {query!r}")
    return RepositoryLookupRead(entry=_read(entry), suggested=service.suggest_payload(entry))


@router.post("/sync", response_model=SyncRunRead)
def trigger_sync(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> SyncRunRead:
    # Plain def: FastAPI runs it in a threadpool so the blocking fetch is safe.
    return SyncRunRead.model_validate(service.run_sync(db))


@router.post("/map", response_model=dict)
def map_models(body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Map discovered model ids to repository entries.

    Body: {provider_type?, base_url?, model_ids: [...]}.
    """
    from tollms.services.model_repository.mapping import map_models as _map

    return {
        "mapped": _map(
            db,
            [str(m) for m in body.get("model_ids", [])],
            provider_type=body.get("provider_type"),
            base_url=body.get("base_url"),
        )
    }


@router.get("/sync-history", response_model=list[SyncRunRead])
def get_sync_history(limit: int = 20, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[SyncRunRead]:
    return [SyncRunRead.model_validate(r) for r in service.sync_history(db, limit)]
