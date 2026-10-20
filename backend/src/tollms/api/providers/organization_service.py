"""Org-scoped providers: create, wizard registration, list, models, update, delete.

Canonical owner of ALL org-scoped provider operations (membership +
permission gates, org_id match, 404-oracle). ``api/orgs/providers/service.py``
is a thin delegating wrapper so org URLs stay unchanged.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from tollms.api.orgs.common.audit import _audit
from tollms.api.orgs.common.guards import _member_org, _require_perm
from tollms.core.crypto import encrypt
from tollms.core.exceptions import NotFoundError, ValidationError
from tollms.models.provider import Provider, ProviderType

logger = logging.getLogger(__name__)


def create_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                        data) -> object:
    """Create an org-scoped provider (org_id=org, user_id=caller for audit)."""
    from tollms.api.providers import service as provider_service
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Create")
    provider = provider_service.create_provider(db, data, caller_id, org_id=org_id)
    _audit(db, org_id, caller_id, "provider.created", provider_id=str(provider.id),
           provider_name=provider.name)
    emit("provider.created", provider_id=str(provider.id), org_id=str(org_id),
         user_id=str(caller_id))
    return provider



def register_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                           data) -> Provider:
    """Atomic org wizard registration: provider + selected models, one commit.

    Careful duplication of providers.register_provider (personal-only, which
    this package may not change): same validation stamp, same models loop,
    same single-commit shape — plus org scope (org_id from the URL path
    only), catalog_slug prefill (as in providers.create_provider), and the
    org audit row riding the same commit. Nothing persists on failure.
    """
    from tollms.api.models.schemas import ModelCreate
    from tollms.api.models.service import create_model as _create_model
    from tollms.api.providers import service as provider_service
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Create")
    credentials = dict(data.credentials)
    metadata = dict(data.metadata or {})
    if getattr(data, "catalog_slug", None):
        from tollms.api.catalog import service as catalog_service

        row = catalog_service.get_catalog_row(db, data.catalog_slug)
        metadata["catalog"] = {"slug": row.slug, "gateway_family": row.gateway_family}
        if (
            data.provider_type == ProviderType.CUSTOM
            and "base_url" not in credentials
            and row.api_base_url
        ):
            credentials["base_url"] = row.api_base_url
    provider_service.ensure_unique_name(db, data.name, user_id=caller_id, org_id=org_id)
    provider = Provider(
        user_id=caller_id,
        org_id=org_id,
        name=data.name.strip(),
        provider_type=data.provider_type,
        credentials_encrypted=encrypt(json.dumps(credentials)),
        metadata_={**metadata, **({"description": data.description} if data.description else {})},
        validation_status=data.validation_status or "unknown",
        validation_message=data.validation_message,
        last_validated_at=datetime.now(timezone.utc) if data.validation_status else None,
    )
    db.add(provider)
    db.flush()  # id for models; commit once at the end
    for m in data.models:
        payload = m.model_dump(exclude={"repository_match"})
        payload["provider_id"] = provider.id
        _create_model(
            db,
            ModelCreate(**payload),
            repository_match=(m.repository_match or None),
            commit=False,
            user_id=caller_id,
        )
    _audit(db, org_id, caller_id, "provider.created", provider_id=str(provider.id),
           provider_name=provider.name, models_created=len(data.models))
    db.commit()
    db.refresh(provider)
    emit("provider.created", provider_id=str(provider.id), org_id=str(org_id),
         user_id=str(caller_id))
    logger.info("org provider registered: %s org=%s with %s models",
                provider.id, org_id, len(data.models))
    return provider



def list_org_providers(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> list:
    """Providers scoped to one org (config visible; secrets stay masked)."""
    from tollms.models.provider import Provider

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Read")
    stmt = (
        select(Provider)
        .where(Provider.org_id == org_id, Provider.is_deleted.is_(False))
        .order_by(Provider.created_at)
    )
    return list(db.scalars(stmt))


def list_org_provider_models(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                             provider_id: uuid.UUID) -> list:
    """Live models of one org-owned provider. Same ModelRead shape as the
    personal registry so the unified providers page renders org data."""
    from tollms.api.models.schemas import read_model
    from tollms.api.providers import service as provider_service

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Read")
    provider = provider_service.get_provider(db, provider_id, caller_id)
    if provider.org_id != org_id:
        raise NotFoundError("provider not found")
    from tollms.models.registered_model import AIModel
    rows = db.scalars(
        select(AIModel).where(
            AIModel.provider_id == provider_id,
            AIModel.is_deleted.is_(False),
        ).order_by(AIModel.created_at)
    )
    return [read_model(m) for m in rows]



def list_org_models(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID) -> list:
    """All active models across the org's live providers (picker support).

    Same ModelRead shape as the personal registry. Gated on org membership
    + ``Keys.Create`` (the caller is assembling a new key).
    """
    from tollms.api.models.schemas import read_model
    from tollms.models.provider import Provider
    from tollms.models.registered_model import AIModel

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Keys.Create")
    rows = db.scalars(
        select(AIModel)
        .join(Provider, Provider.id == AIModel.provider_id)
        .where(
            Provider.org_id == org_id,
            Provider.is_deleted.is_(False),
            Provider.is_active.is_(True),
            AIModel.is_deleted.is_(False),
            AIModel.is_active.is_(True),
        )
        .order_by(Provider.name, AIModel.model_id)
    )
    return [read_model(m) for m in rows]



def update_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                        provider_id: uuid.UUID, data) -> object:
    """Update an org provider: Providers.Update + same-org membership."""
    from tollms.api.providers import service as provider_service

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Update")
    provider = provider_service.get_provider(db, provider_id, caller_id)
    if provider.org_id != org_id:
        raise NotFoundError("provider not found")
    updated = provider_service.update_provider(db, provider_id, data, caller_id)
    _audit(db, org_id, caller_id, "provider.updated", provider_id=str(provider_id))
    db.commit()
    return updated



def delete_org_provider(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                        provider_id: uuid.UUID) -> None:
    """Delete an org provider: Providers.Delete + same-org membership."""
    from tollms.api.providers import service as provider_service
    from tollms.services.observability.events import emit

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Delete")
    provider = provider_service.get_provider(db, provider_id, caller_id)
    if provider.org_id != org_id:
        raise NotFoundError("provider not found")
    provider_service.delete_provider(db, provider_id, caller_id)
    _audit(db, org_id, caller_id, "provider.deleted", provider_id=str(provider_id))
    emit("provider.deleted", provider_id=str(provider_id), org_id=str(org_id),
         user_id=str(caller_id))


def create_org_model(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                     provider_id: uuid.UUID, data) -> object:
    """Register one model on an org-owned provider. Same ModelCreate shape
    as the personal registry; provider_id comes from the path (a body value
    must match it or may be omitted). Guards mirror register_org_provider:
    live membership + Providers.Create, same-org provider, 404 oracle."""
    from tollms.api.models.schemas import ModelCreate
    from tollms.api.models.service import create_model as _create_model
    from tollms.api.providers import service as provider_service

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Create")
    provider = provider_service.get_provider(db, provider_id, caller_id)
    if provider.org_id != org_id:
        raise NotFoundError("provider not found")
    body_pid = getattr(data, "provider_id", None)
    if body_pid is not None and body_pid != provider_id:
        raise ValidationError("provider_id in body must match the path provider")
    payload = data.model_dump()
    payload["provider_id"] = provider_id
    # Personal-only sync_primary_model guard stays inside create_model: org
    # providers (org_id set) never touch the personal primary allow-list.
    # The model.created org audit rides the same commit (see _audit_org_model).
    return _create_model(db, ModelCreate(**payload), user_id=caller_id)


def update_org_model(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                     model_id: uuid.UUID, data) -> object:
    """Partial update of an org-owned model (incl. is_active toggles).
    Providers.Update + same-org membership; 404 oracle for anyone else."""
    from tollms.api.models.service import get_model as _get_model
    from tollms.api.models.service import update_model as _update_model
    from tollms.models.provider import Provider

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Update")
    model = _get_model(db, model_id, caller_id)
    provider = db.get(Provider, model.provider_id)
    if provider is None or provider.org_id != org_id:
        raise NotFoundError(f"model {model_id} not found")
    updated = _update_model(db, model_id, data, caller_id)
    _audit(db, org_id, caller_id, "model.updated", provider_id=str(provider.id),
           model_id=str(model_id))
    db.commit()
    return updated


def delete_org_model(db: Session, caller_id: uuid.UUID, org_id: uuid.UUID,
                     model_id: uuid.UUID) -> None:
    """Soft-delete an org-owned model (mirrors personal delete_model).
    Providers.Delete (the org equivalent of the personal ownership gate) +
    same-org membership; 404 oracle for anyone else."""
    from tollms.api.models.service import delete_model as _delete_model
    from tollms.api.models.service import get_model as _get_model
    from tollms.models.provider import Provider

    org, mem = _member_org(db, org_id, caller_id)
    _require_perm(db, org, mem, caller_id, "Providers.Delete")
    model = _get_model(db, model_id, caller_id)
    provider = db.get(Provider, model.provider_id)
    if provider is None or provider.org_id != org_id:
        raise NotFoundError(f"model {model_id} not found")
    _delete_model(db, model_id, caller_id)
    _audit(db, org_id, caller_id, "model.deleted", provider_id=str(provider.id),
           model_id=str(model_id))
