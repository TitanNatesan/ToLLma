"""Repository feature service: entry CRUD/query composed from services engines.

Router -> this module -> services.model_repository.* -> tollms.models.*.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.model_repository import RepositoryModel, SyncRun
from tollms.services.model_repository.lookup import find_for_model, lookup, stats, suggest_payload
from tollms.services.model_repository.sync import CAPABILITY_FIELDS, run_sync

__all__ = [
    "find_for_model",
    "lookup",
    "stats",
    "suggest_payload",
    "run_sync",
    "get_entry",
    "list_entries",
    "sync_history",
]


def get_entry(db: Session, entry_id: object) -> RepositoryModel:
    model = db.get(RepositoryModel, entry_id)
    if model is None or model.is_deleted:
        raise NotFoundError(f"repository model {entry_id} not found")
    return model


def list_entries(
    db: Session,
    *,
    search: str | None = None,
    provider: str | None = None,
    capability: str | None = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[RepositoryModel], int]:
    if capability and capability not in CAPABILITY_FIELDS:
        raise ValidationError(f"unknown capability filter: {capability}")
    stmt = select(RepositoryModel).where(RepositoryModel.is_deleted.is_(False))
    if provider:
        stmt = stmt.where(RepositoryModel.provider == provider.strip().lower())
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            RepositoryModel.canonical_name.ilike(like)
            | RepositoryModel.display_name.ilike(like)
            | RepositoryModel.provider_model_id.ilike(like)
        )
    if capability:
        stmt = stmt.where(getattr(RepositoryModel, capability).is_(True))
    if active_only:
        stmt = stmt.where(RepositoryModel.is_active.is_(True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    rows = list(db.scalars(stmt.order_by(RepositoryModel.canonical_name).offset((page - 1) * page_size).limit(page_size)))
    return rows, total


def sync_history(db: Session, limit: int = 20) -> list[SyncRun]:
    return list(db.scalars(select(SyncRun).order_by(SyncRun.created_at.desc()).limit(min(max(limit, 1), 100))))
