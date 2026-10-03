"""Provider catalog schemas (read-only; rows are sync-owned)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ProviderCatalogRead(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    display_name: str | None
    logo_url: str | None
    doc_url: str | None
    api_base_url: str | None
    npm_package: str | None
    env_vars: list[str] = Field(default_factory=list)
    source: str
    gateway_family: str | None
    gateway_supported: bool
    capabilities: dict = Field(default_factory=dict)
    model_count: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ProviderCatalogPage(BaseModel):
    items: list[ProviderCatalogRead]
    total: int
    page: int
    page_size: int


class CatalogStatsRead(BaseModel):
    total_providers: int
    active_providers: int
    inactive_providers: int
    gateway_supported_providers: int
    catalog_only_providers: int
    total_models: int
    last_sync_at: datetime | None
    last_sync_status: str | None
    sources: list[str] = Field(default_factory=list)
