"""Provider catalog reads over sync-owned rows.

Global scope (like the model repository): any authenticated user may browse.
Credential data never lives here — joins to user Provider connections happen
in the callers that need them, never in this module.
"""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from tollms.api.catalog.schemas import (
    CatalogStatsRead,
    ConnectionTemplateRead,
    CredentialField,
    ProviderCatalogPage,
    ProviderCatalogRead,
)
from tollms.api.orgs.common.guards import _escape_like
from tollms.core.exceptions import NotFoundError
from tollms.models.model_repository import SyncRun
from tollms.models.provider_catalog import ProviderCatalog


def _read(row: ProviderCatalog) -> ProviderCatalogRead:
    return ProviderCatalogRead(
        id=row.id, slug=row.slug, name=row.name, display_name=row.display_name,
        logo_url=row.logo_url, doc_url=row.doc_url, api_base_url=row.api_base_url,
        npm_package=row.npm_package, env_vars=list(row.env_vars or []), source=row.source,
        gateway_family=row.gateway_family, gateway_supported=row.gateway_supported,
        capabilities=dict(row.capabilities or {}), model_count=row.model_count,
        is_active=row.is_active, created_at=row.created_at, updated_at=row.updated_at,
    )


def list_providers(
    db: Session,
    *,
    search: str | None = None,
    gateway_supported: bool | None = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 50,
) -> ProviderCatalogPage:
    stmt = select(ProviderCatalog).where(ProviderCatalog.is_deleted.is_(False))
    if active_only:
        stmt = stmt.where(ProviderCatalog.is_active.is_(True))
    if gateway_supported is True:
        stmt = stmt.where(ProviderCatalog.gateway_supported.is_(True))
    elif gateway_supported is False:
        stmt = stmt.where(ProviderCatalog.gateway_supported.is_(False))
    if search and search.strip():
        # LIKE wildcards (%, _, \) match literally — user input is escaped.
        q = f"%{_escape_like(search.strip().lower())}%"
        stmt = stmt.where(
            or_(
                func.lower(ProviderCatalog.name).like(q, escape="\\"),
                func.lower(ProviderCatalog.slug).like(q, escape="\\"),
            )
        )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    rows = db.execute(
        stmt.order_by(ProviderCatalog.name).offset(min((page - 1) * page_size, 5000)).limit(page_size)
    ).scalars().all()
    return ProviderCatalogPage(items=[_read(r) for r in rows], total=total, page=page, page_size=page_size)


def get_provider(db: Session, slug: str) -> ProviderCatalogRead:
    return _read(_get_row(db, slug))


def get_catalog_row(db: Session, slug: str) -> ProviderCatalog:
    """The ORM row for creation-from-slug flows (providers service)."""
    return _get_row(db, slug)


def _get_row(db: Session, slug: str) -> ProviderCatalog:
    row = db.execute(
        select(ProviderCatalog).where(
            ProviderCatalog.slug == slug.strip().lower(), ProviderCatalog.is_deleted.is_(False)
        )
    ).scalars().first()
    if row is None:
        raise NotFoundError("catalog provider not found")
    return row


def connection_template(db: Session, slug: str) -> ConnectionTemplateRead:
    """Build the config-UI template from a catalog row. No secrets: env var
    names and the public base URL only."""
    row = _get_row(db, slug)
    env_vars = list(row.env_vars or [])
    fields = [
        CredentialField(
            key=name, label=name.replace("_", " ").strip().title() or name,
            required=True, secret=True,
        )
        for name in env_vars
    ]
    if row.api_base_url:
        fields.append(
            CredentialField(key="base_url", label="Base URL", required=False, secret=False)
        )
    return ConnectionTemplateRead(
        slug=row.slug, name=row.name, logo_url=row.logo_url,
        api_base_url=row.api_base_url, doc_url=row.doc_url,
        npm_package=row.npm_package, env_vars=env_vars,
        gateway_family=row.gateway_family, gateway_supported=row.gateway_supported,
        suggested_provider_type=row.gateway_family if row.gateway_supported else None,
        suggested_base_url=row.api_base_url,
        credential_fields=fields,
    )


def stats(db: Session) -> CatalogStatsRead:
    base = [ProviderCatalog.is_deleted.is_(False)]
    total = db.execute(select(func.count()).select_from(ProviderCatalog).where(*base)).scalar_one() or 0
    active = db.execute(
        select(func.count()).select_from(ProviderCatalog).where(*base, ProviderCatalog.is_active.is_(True))
    ).scalar_one() or 0
    supported = db.execute(
        select(func.count()).select_from(ProviderCatalog).where(
            *base, ProviderCatalog.is_active.is_(True), ProviderCatalog.gateway_supported.is_(True))
    ).scalar_one() or 0
    models = db.execute(
        select(func.coalesce(func.sum(ProviderCatalog.model_count), 0)).select_from(ProviderCatalog).where(*base)
    ).scalar_one() or 0
    last = db.execute(select(SyncRun).order_by(SyncRun.created_at.desc()).limit(1)).scalars().first()
    return CatalogStatsRead(
        total_providers=total, active_providers=active, inactive_providers=total - active,
        gateway_supported_providers=supported, catalog_only_providers=active - supported,
        total_models=int(models),
        last_sync_at=last.finished_at if last else None,
        last_sync_status=last.status if last else None,
        sources=["modelsdev"],
    )
