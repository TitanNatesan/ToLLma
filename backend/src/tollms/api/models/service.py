"""Model registry: CRUD + search + filter."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.registered_model import AIModel
from tollms.models.provider import Provider
from tollms.api.models.schemas import CAPABILITY_FIELDS, ModelCreate, ModelUpdate
from tollms.api.providers.service import get_provider

logger = logging.getLogger(__name__)


def _owned_provider_ids(db: Session, user_id: uuid.UUID | None) -> set[uuid.UUID] | None:
    if user_id is None:
        return None
    return set(db.scalars(select(Provider.id).where(Provider.user_id == user_id)))


def get_model(db: Session, model_id: uuid.UUID, user_id: uuid.UUID | None = None) -> AIModel:
    model = db.get(AIModel, model_id)
    if model is None or model.is_deleted:
        raise NotFoundError(f"model {model_id} not found")
    if user_id is not None:
        owner = db.scalar(select(Provider.user_id).where(Provider.id == model.provider_id))
        if owner != user_id:
            raise NotFoundError(f"model {model_id} not found")
    return model


def list_models(
    db: Session,
    *,
    provider_id: uuid.UUID | None = None,
    search: str | None = None,
    capability: str | None = None,
    active_only: bool = False,
    user_id: uuid.UUID | None = None,
) -> list[AIModel]:
    stmt = select(AIModel).where(AIModel.is_deleted.is_(False))
    if user_id is not None:
        stmt = stmt.where(
            AIModel.provider_id.in_(select(Provider.id).where(Provider.user_id == user_id))
        )
    if provider_id is not None:
        stmt = stmt.where(AIModel.provider_id == provider_id)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(AIModel.name.ilike(like), AIModel.model_id.ilike(like), AIModel.description.ilike(like)))
    if capability:
        if capability not in CAPABILITY_FIELDS:
            raise ValidationError(f"unknown capability filter: {capability}")
        stmt = stmt.where(getattr(AIModel, capability).is_(True))
    if active_only:
        stmt = stmt.where(AIModel.is_active.is_(True))
    return list(db.scalars(stmt.order_by(AIModel.created_at)))


def create_model(
    db: Session,
    data: ModelCreate,
    *,
    repository_match: dict | None = None,
    commit: bool = True,
    user_id: uuid.UUID | None = None,
) -> AIModel:
    get_provider(db, data.provider_id, user_id)  # validates provider exists and is owned
    payload = data.model_dump()
    metadata = payload.pop("metadata")
    if data.repository_model_key:
        # Snapshot original repository values; current columns are user overrides.
        from tollms.services.model_repository.lookup import lookup as _lookup  # avoid cycle at load

        entry = _lookup(db, data.repository_model_key)
        if entry is not None and entry.model_key == data.repository_model_key:
            metadata["repository_snapshot"] = {
                "model_key": entry.model_key,
                "name": entry.display_name or entry.provider_model_id,
                "endpoint_type": entry.endpoint_type,
                "input_price": str(entry.input_cost or 0),
                "output_price": str(entry.output_cost or 0),
                "context_window": entry.context_window,
                "max_output_tokens": entry.max_output_tokens,
            }
    if repository_match:
        metadata["repository_match"] = repository_match
    payload["metadata_"] = metadata
    model = AIModel(**payload)
    db.add(model)
    if commit:
        db.commit()
        db.refresh(model)
    else:
        db.flush()
    logger.info("model created: %s (%s)", model.id, model.model_id)
    return model


def update_model(
    db: Session, model_id: uuid.UUID, data: ModelUpdate, user_id: uuid.UUID | None = None
) -> AIModel:
    model = get_model(db, model_id, user_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "metadata":
            model.metadata_ = value
        elif value is not None or field in ("description", "context_window", "max_output_tokens", "release_date"):
            setattr(model, field, value)
    db.commit()
    db.refresh(model)
    logger.info("model updated: %s", model.id)
    return model


def delete_model(db: Session, model_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
    model = get_model(db, model_id, user_id)
    model.is_deleted = True
    model.deleted_at = datetime.now(timezone.utc)
    model.is_active = False
    db.commit()
    logger.info("model soft-deleted: %s", model.id)


def bulk_update_models(
    db: Session, ids: list[uuid.UUID], data: ModelUpdate, user_id: uuid.UUID | None = None
) -> int:
    """Apply one patch to many models. Skips missing/deleted/unowned rows. Returns updated count."""
    patch = {k: v for k, v in data.model_dump(exclude_unset=True).items() if k != "metadata"}
    if "metadata" in data.model_dump(exclude_unset=True):
        patch["metadata_"] = data.metadata
    owned = _owned_provider_ids(db, user_id)
    updated = 0
    for model_id in ids:
        model = db.get(AIModel, model_id)
        if model is None or model.is_deleted:
            continue
        if owned is not None and model.provider_id not in owned:
            continue
        for field, value in patch.items():
            if value is not None or field in ("description", "context_window", "max_output_tokens", "release_date"):
                setattr(model, field, value)
        updated += 1
    db.commit()
    logger.info("models bulk-updated: %s", updated)
    return updated
