"""Repository feature service: entry CRUD/query composed from services engines.

Router -> this module -> services.model_repository.* -> tollms.models.*.
"""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.canonical_model import CanonicalModel
from tollms.models.model_repository import RepositoryModel, SyncRun
from tollms.services.model_repository.canonical import canonicalize
from tollms.services.cache import constants as cache_ttl
from tollms.services.cache import keys as cache_keys
from tollms.services.cache.locks import locked_sync
from tollms.services.model_repository.lookup import find_for_model, lookup, stats, suggest_payload
from tollms.services.model_repository.sync import CAPABILITY_FIELDS
from tollms.services.model_repository.sync import run_sync as _engine_run_sync

__all__ = [
    "find_for_model",
    "lookup",
    "stats",
    "suggest_payload",
    "run_sync",
    "get_entry",
    "list_entries",
    "list_canonicals",
    "get_canonical",
    "get_canonical_offerings",
    "sync_history",
]

_MODALITY_CAPABILITY = {
    "text": "supports_text_input",
    "chat": "supports_chat",
    "vision": "supports_vision_input",
    "image": "supports_image_output",
    "audio": "supports_audio_input",
    "video": "supports_video_input",
    "reasoning": "supports_reasoning",
    "tool_call": "supports_tool_calling",
    "tool": "supports_tool_calling",
    "embeddings": "supports_embeddings",
    "streaming": "supports_streaming",
}


def run_sync(db: Session, **kwargs):
    """Manual sync trigger behind the repo-sync lock (busy -> 422, never stacked)."""
    with locked_sync(cache_keys.LOCK_REPO_SYNC, cache_ttl.LOCK_REPO_SYNC * 1000) as acquired:
        if not acquired:
            raise ValidationError("model repository sync already running")
        return _engine_run_sync(db, **kwargs)


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
    family: str | None = None,
    modality: str | None = None,
    tool_call: bool | None = None,
    reasoning: bool | None = None,
    open_weights: bool | None = None,
    min_context: int | None = None,
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
    if family:
        stmt = stmt.where(RepositoryModel.family == family.strip())
    if modality:
        column = _MODALITY_CAPABILITY.get(modality.strip().lower())
        if column is None:
            raise ValidationError(f"unknown modality filter: {modality}")
        stmt = stmt.where(getattr(RepositoryModel, column).is_(True))
    if tool_call is not None:
        stmt = stmt.where(RepositoryModel.supports_tool_calling.is_(bool(tool_call)))
    if reasoning is not None:
        stmt = stmt.where(RepositoryModel.supports_reasoning.is_(bool(reasoning)))
    if open_weights is not None:
        stmt = stmt.join(
            CanonicalModel,
            RepositoryModel.canonical_id == CanonicalModel.canonical_id,
        ).where(
            CanonicalModel.is_deleted.is_(False),
            CanonicalModel.open_weights.is_(bool(open_weights)),
        )
    if min_context is not None:
        stmt = stmt.where(RepositoryModel.context_window >= int(min_context))
    if active_only:
        stmt = stmt.where(RepositoryModel.is_active.is_(True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    rows = list(db.scalars(stmt.order_by(RepositoryModel.canonical_name).offset((page - 1) * page_size).limit(page_size)))
    return rows, total


def list_canonicals(
    db: Session,
    *,
    search: str | None = None,
    family: str | None = None,
    open_weights: bool | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[CanonicalModel], int]:
    stmt = select(CanonicalModel).where(CanonicalModel.is_deleted.is_(False))
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            CanonicalModel.canonical_id.ilike(like)
            | CanonicalModel.name.ilike(like)
            | CanonicalModel.family.ilike(like)
        )
    if family:
        stmt = stmt.where(CanonicalModel.family == family.strip())
    if open_weights is not None:
        stmt = stmt.where(CanonicalModel.open_weights.is_(bool(open_weights)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    rows = list(db.scalars(stmt.order_by(CanonicalModel.canonical_id).offset((page - 1) * page_size).limit(page_size)))
    return rows, total


def get_canonical(db: Session, canonical_id: str) -> CanonicalModel:
    key = (canonical_id or "").strip()
    if not key:
        raise NotFoundError("canonical model not found")
    row = db.scalar(
        select(CanonicalModel).where(
            CanonicalModel.canonical_id == key,
            CanonicalModel.is_deleted.is_(False),
        )
    )
    if row is None:
        # Separator/case variants group onto one record; match canonical form.
        wanted = canonicalize(key)
        for candidate in db.scalars(
            select(CanonicalModel).where(CanonicalModel.is_deleted.is_(False))
        ):
            if canonicalize(candidate.canonical_id) == wanted:
                return candidate
        raise NotFoundError(f"canonical model {canonical_id} not found")
    return row


def get_canonical_offerings(db: Session, canonical_id: str) -> list[RepositoryModel]:
    row = get_canonical(db, canonical_id)
    return list(
        db.scalars(
            select(RepositoryModel)
            .where(
                RepositoryModel.canonical_id == row.canonical_id,
                RepositoryModel.is_deleted.is_(False),
            )
            .order_by(RepositoryModel.model_key)
        )
    )


def sync_history(db: Session, limit: int = 20) -> list[SyncRun]:
    return list(db.scalars(select(SyncRun).order_by(SyncRun.created_at.desc()).limit(min(max(limit, 1), 100))))
