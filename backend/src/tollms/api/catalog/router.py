"""Provider catalog endpoints only. No business logic."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from tollms.api.catalog import service
from tollms.api.catalog.schemas import (
    CatalogStatsRead,
    ConnectionTemplateRead,
    ProviderCatalogPage,
    ProviderCatalogRead,
)
from tollms.core.deps import get_db
from tollms.core.security import get_current_user
from tollms.models.user import User

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])


@router.get("/providers", response_model=ProviderCatalogPage)
def list_providers(
    search: str | None = None,
    gateway_supported: bool | None = None,
    active_only: bool = True,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProviderCatalogPage:
    return service.list_providers(
        db, search=search, gateway_supported=gateway_supported,
        active_only=active_only, page=page, page_size=page_size,
    )


@router.get("/providers/{slug}", response_model=ProviderCatalogRead)
def get_provider(slug: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ProviderCatalogRead:
    return service.get_provider(db, slug)


@router.post("/providers/{slug}/connection-template", response_model=ConnectionTemplateRead)
def connection_template(
    slug: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> ConnectionTemplateRead:
    """Metadata for the provider config UI. No secrets — env var names and
    the public base URL only."""
    return service.connection_template(db, slug)


@router.get("/stats", response_model=CatalogStatsRead)
def get_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> CatalogStatsRead:
    return service.stats(db)
