"""Model registry: CRUD + search + filter."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.registered_model import AIModel, EndpointType
from tollms.api.models.schemas import CAPABILITY_FIELDS, ModelCreate, ModelUpdate
from tollms.api.providers.service import get_provider

logger = logging.getLogger(__name__)


def get_model(db: Session, model_id: uuid.UUID) -> AIModel:
    model = db.get(AIModel, model_id)
    if model is None or model.is_deleted:
        raise NotFoundError(f"model {model_id} not found")
    return model


def list_models(
    db: Session,
    *,
    provider_id: uuid.UUID | None = None,
    search: str | None = None,
    capability: str | None = None,
    active_only: bool = False,
) -> list[AIModel]:
    stmt = select(AIModel).where(AIModel.is_deleted.is_(False))
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
) -> AIModel:
    get_provider(db, data.provider_id)  # validates provider exists
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


def update_model(db: Session, model_id: uuid.UUID, data: ModelUpdate) -> AIModel:
    model = get_model(db, model_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "metadata":
            model.metadata_ = value
        elif value is not None or field in ("description", "context_window", "max_output_tokens", "release_date"):
            setattr(model, field, value)
    db.commit()
    db.refresh(model)
    logger.info("model updated: %s", model.id)
    return model


def delete_model(db: Session, model_id: uuid.UUID) -> None:
    model = get_model(db, model_id)
    model.is_deleted = True
    model.deleted_at = datetime.now(timezone.utc)
    model.is_active = False
    db.commit()
    logger.info("model soft-deleted: %s", model.id)


RESYNC_FIELDS = (
    "description",
    "endpoint_type",
    "supports_text",
    "supports_vision",
    "supports_audio_input",
    "supports_audio_output",
    "supports_image_generation",
    "supports_tool_calling",
    "supports_reasoning",
    "supports_streaming",
    "context_window",
    "max_output_tokens",
    "release_date",
)
RESYNC_PRICE_FIELDS = ("input_price", "output_price", "cache_read_price", "cache_write_price")


def _repo_prices_per_1m(entry) -> dict[str, Decimal]:
    from decimal import Decimal as _Decimal

    out = {}
    for model_field, repo_field in (
        ("input_price", "input_cost"),
        ("output_price", "output_cost"),
        ("cache_read_price", "cache_read_cost"),
        ("cache_write_price", "cache_write_cost"),
    ):
        per_token = getattr(entry, repo_field)
        out[model_field] = _Decimal(per_token) * 1_000_000 if per_token is not None else _Decimal(0)
    return out


def resync_model(db: Session, model_id: uuid.UUID, *, include_pricing: bool = False) -> dict:
    """Refresh a linked model from its repository entry.

    Never touches name/model_id/user pricing unless include_pricing=True.
    Returns {applied, pricing_changed, pricing_applied}.
    """
    from tollms.services.model_repository.lookup import lookup as _lookup  # avoid cycle at load

    model = get_model(db, model_id)
    if not model.repository_model_key:
        raise ValidationError("model is not linked to the repository")
    entry = _lookup(db, model.repository_model_key)
    if entry is None or entry.model_key != model.repository_model_key:
        raise ValidationError("linked repository entry no longer exists")
    suggested = {
        "description": entry.description,
        "endpoint_type": entry.endpoint_type,
        "supports_text": entry.supports_text_input and entry.supports_text_output,
        "supports_vision": entry.supports_vision_input,
        "supports_audio_input": entry.supports_audio_input,
        "supports_audio_output": entry.supports_audio_output,
        "supports_image_generation": entry.supports_image_output,
        "supports_tool_calling": entry.supports_tool_calling,
        "supports_reasoning": entry.supports_reasoning,
        "supports_streaming": entry.supports_streaming,
        "context_window": entry.context_window,
        "max_output_tokens": entry.max_output_tokens,
        "release_date": entry.release_date,
    }
    applied: dict[str, object] = {}
    for field in RESYNC_FIELDS:
        try:
            value = suggested[field] if field != "endpoint_type" else EndpointType(suggested[field])
        except (ValueError, KeyError):
            continue
        if getattr(model, field) != value:
            setattr(model, field, value)
            applied[field] = value
    repo_prices = _repo_prices_per_1m(entry)
    pricing_changed = any(model.__dict__.get(f) != v for f, v in repo_prices.items())
    if include_pricing:
        for field, value in repo_prices.items():
            if getattr(model, field) != value:
                setattr(model, field, value)
                applied[field] = value
    match = dict(model.metadata_.get("repository_match") or {})
    match["last_synced_at"] = datetime.now(timezone.utc).isoformat()
    model.metadata_ = {**model.metadata_, "repository_match": match}
    db.commit()
    db.refresh(model)
    logger.info("model resynced: %s (pricing=%s)", model.id, include_pricing)
    return {"applied": applied, "pricing_changed": pricing_changed, "pricing_applied": include_pricing}


def bulk_update_models(db: Session, ids: list[uuid.UUID], data: ModelUpdate) -> int:
    """Apply one patch to many models. Skips missing/deleted rows. Returns updated count."""
    patch = {k: v for k, v in data.model_dump(exclude_unset=True).items() if k != "metadata"}
    if "metadata" in data.model_dump(exclude_unset=True):
        patch["metadata_"] = data.metadata
    updated = 0
    for model_id in ids:
        model = db.get(AIModel, model_id)
        if model is None or model.is_deleted:
            continue
        for field, value in patch.items():
            if value is not None or field in ("description", "context_window", "max_output_tokens", "release_date"):
                setattr(model, field, value)
        updated += 1
    db.commit()
    logger.info("models bulk-updated: %s", updated)
    return updated
