"""Model registry: CRUD + search + filter."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.registered_model import AIModel, normalize_endpoints
from tollms.models.provider import Provider
from tollms.api.models.schemas import CAPABILITY_FIELDS, ModelCreate, ModelUpdate
from tollms.api.providers.service import get_provider
from tollms.services.observability.events import emit

logger = logging.getLogger(__name__)


def _require_org_perm(db: Session, provider: Provider, user_id: uuid.UUID | None, code: str) -> None:
    """Org-provider write gate for the generic model endpoints (404 oracle).

    Same gate as providers.service._require_org_provider_perm (lazy import:
    orgs/service.py composes providers/service.py, so a top-level import
    would cycle). Personal providers (org_id NULL) and unscoped internal
    calls (user_id None) pass through unchanged.
    """
    if provider is None or provider.org_id is None or user_id is None:
        return
    from tollms.api.orgs import service as org_service

    org, mem = org_service._member_org(db, provider.org_id, user_id)
    org_service._require_perm(db, org, mem, user_id, code)


def _audit_org_model(db: Session, provider: Provider, user_id: uuid.UUID | None,
                     model_id: uuid.UUID) -> bool:
    """Provider-scoped model.created org audit. Returns True when a row was
    staged (the caller commits it: same commit for commit=True, outer commit
    for commit=False register loops)."""
    if provider.org_id is None or user_id is None:
        return False
    from tollms.api.orgs import service as org_service

    org_service._audit(db, provider.org_id, user_id, "model.created",
                       provider_id=str(provider.id), model_id=str(model_id))
    return True


def _visible_provider_ids(db: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Providers visible to `user_id`: personal owned rows (org_id NULL) plus
    org providers of the caller's ACTIVE orgs. Scope is decided by `org_id`
    alone — `user_id` on org rows is audit, never scope."""
    from tollms.models.organization import Membership, MembershipState

    org_ids = set(
        db.scalars(
            select(Membership.org_id).where(
                Membership.user_id == user_id,
                Membership.is_deleted.is_(False),
                Membership.state == MembershipState.ACTIVE.value,
            )
        )
    )
    from sqlalchemy import or_

    personal = (Provider.org_id.is_(None)) & (Provider.user_id == user_id)
    if org_ids:
        stmt = select(Provider.id).where(
            or_(personal, Provider.org_id.in_(list(org_ids)))
        )
    else:
        stmt = select(Provider.id).where(personal)
    return set(db.scalars(stmt))


def get_model(
    db: Session, model_id: uuid.UUID, user_id: uuid.UUID | None = None,
    *, personal_only: bool = False,
) -> AIModel:
    """Fetch one model or raise a 404 oracle.

    `personal_only` (personal registry endpoint): models on org-owned
    providers 404 — org models are managed via the org flow. Gateway and
    internal callers keep dual visibility via `_visible_provider_ids`.
    """
    model = db.get(AIModel, model_id)
    if model is None or model.is_deleted:
        raise NotFoundError(f"model {model_id} not found")
    owner = db.scalar(
        select(Provider).where(Provider.id == model.provider_id)
    )
    if owner is None or owner.is_deleted or not owner.is_active:
        raise NotFoundError(f"model {model_id} not found")
    if personal_only and owner.org_id is not None:
        raise NotFoundError(f"model {model_id} not found")
    if user_id is not None and owner.id not in _visible_provider_ids(db, user_id):
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
    personal_only: bool = False,
) -> list[AIModel]:
    # Operational scope: only models whose provider connection is live.
    # The global repository catalog (model_repository) intentionally retains
    # metadata; this query serves usable connections, so deleted/inactive
    # providers contribute nothing here (mirrors list_public_models).
    stmt = (
        select(AIModel)
        .join(Provider, AIModel.provider_id == Provider.id)
        .where(AIModel.is_deleted.is_(False))
        .where(Provider.is_deleted.is_(False), Provider.is_active.is_(True))
    )
    if user_id is not None:
        if personal_only:
            stmt = stmt.where(
                Provider.org_id.is_(None), Provider.user_id == user_id
            )
        else:
            visible = _visible_provider_ids(db, user_id)
            if not visible:
                return []
            stmt = stmt.where(AIModel.provider_id.in_(list(visible)))
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
    personal_only: bool = False,
) -> AIModel:
    provider = get_provider(db, data.provider_id, user_id, personal_only=personal_only)  # validates provider exists and is owned
    _require_org_perm(db, provider, user_id, "Providers.Create")
    payload = data.model_dump()
    metadata = payload.pop("metadata")
    # Endpoint-aware: primary_endpoint/supported_endpoints are the truth;
    # endpoint_type is mirrored for older readers.
    enum, primary, endpoints = normalize_endpoints(
        payload.pop("primary_endpoint", None),
        payload.pop("supported_endpoints", None),
        payload.get("endpoint_type"),
    )
    payload["endpoint_type"] = enum
    payload["primary_endpoint"] = primary
    payload["supported_endpoints"] = endpoints
    if data.repository_model_key:
        # Snapshot original repository values; current columns are user overrides.
        from tollms.services.model_repository.lookup import lookup as _lookup  # avoid cycle at load

        entry = _lookup(db, data.repository_model_key)
        if entry is not None and entry.model_key == data.repository_model_key:
            metadata["repository_snapshot"] = {
                "model_key": entry.model_key,
                "name": entry.display_name or entry.provider_model_id,
                "endpoint_type": entry.endpoint_type,
                "primary_endpoint": entry.primary_endpoint or entry.endpoint_type,
                "supported_endpoints": list(entry.supported_endpoints or []),
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
    if _audit_org_model(db, provider, user_id, model.id) and commit:
        db.commit()
        db.refresh(model)
    if (
        user_id is not None
        and provider.org_id is None
        and model.is_active
        and not model.is_deleted
    ):
        # Personal model: extend the owner's primary-key allow-list.
        # Idempotent (check-exists-first + UQ race handling); skips
        # disabled/revoked primaries without auto-enabling; policy/IP
        # restrictions untouched. Also covers register-with-models: that
        # path calls create_model(commit=False) per model and commits once
        # in register_provider, so this flushes and the outer commit persists.
        # Lazy import: keeps keys below the feature-service cycle.
        from tollms.api.keys import service as _key_service

        _key_service.sync_primary_model(
            db, user_id=user_id, provider_id=provider.id, model_id=model.id,
            commit=commit,
        )
        if commit:
            db.refresh(model)
    logger.info("model created: %s (%s)", model.id, model.model_id)
    return model


def update_model(
    db: Session, model_id: uuid.UUID, data: ModelUpdate, user_id: uuid.UUID | None = None,
    *, personal_only: bool = False,
) -> AIModel:
    model = get_model(db, model_id, user_id, personal_only=personal_only)
    owner_provider = db.get(Provider, model.provider_id)
    _require_org_perm(db, owner_provider, user_id, "Providers.Update")
    changes = data.model_dump(exclude_unset=True)
    if changes.keys() & {"endpoint_type", "primary_endpoint", "supported_endpoints"}:
        enum, primary, endpoints = normalize_endpoints(
            changes.get("primary_endpoint", model.primary_endpoint),
            changes.get("supported_endpoints", model.supported_endpoints),
            changes.get("endpoint_type", model.endpoint_type),
        )
        changes["endpoint_type"] = enum
        changes["primary_endpoint"] = primary
        changes["supported_endpoints"] = endpoints
    for field, value in changes.items():
        if field == "metadata":
            model.metadata_ = value
        elif value is not None or field in ("description", "context_window", "max_output_tokens", "release_date"):
            setattr(model, field, value)
    db.commit()
    db.refresh(model)
    if (
        "is_active" in changes
        and owner_provider is not None
        and owner_provider.org_id is None
    ):
        # Personal model toggles move its primary-key allow-list row:
        # disable prunes, re-enable re-syncs. Best-effort — the update
        # already committed. Org models never touch the personal primary.
        try:
            from tollms.api.keys import service as _key_service

            owner = user_id if user_id is not None else owner_provider.user_id
            if owner is not None:
                if changes["is_active"]:
                    _key_service.sync_primary_model(
                        db, user_id=owner, provider_id=model.provider_id,
                        model_id=model.id,
                    )
                else:
                    _key_service.prune_primary_model(
                        db, user_id=owner, model_id=model.id
                    )
        except Exception:
            logger.exception("primary key sync failed for model %s", model.id)
    logger.info("model updated: %s", model.id)
    return model


def delete_model(
    db: Session, model_id: uuid.UUID, user_id: uuid.UUID | None = None,
    *, personal_only: bool = False,
) -> None:
    model = get_model(db, model_id, user_id, personal_only=personal_only)
    owner_provider = db.get(Provider, model.provider_id)
    _require_org_perm(db, owner_provider, user_id, "Providers.Delete")
    model.is_deleted = True
    model.deleted_at = datetime.now(timezone.utc)
    model.is_active = False
    db.commit()
    if owner_provider is not None and owner_provider.org_id is None:
        # Personal model: drop its primary-key allow-list row. Best-effort —
        # the delete already committed. Org models never touch it.
        try:
            from tollms.api.keys import service as _key_service

            owner = user_id if user_id is not None else owner_provider.user_id
            if owner is not None:
                _key_service.prune_primary_model(db, user_id=owner, model_id=model.id)
        except Exception:
            logger.exception("primary key prune failed for model %s", model.id)
    logger.info("model soft-deleted: %s", model.id)
    emit("model.deleted", model_id=str(model_id), user_id=str(user_id))
