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


class CredentialField(BaseModel):
    """One credential input for the provider config UI. No secrets here —
    only the key name, display label, and whether a value is required."""

    key: str
    label: str
    required: bool = True
    secret: bool = True


class ConnectionTemplateRead(BaseModel):
    """Metadata-driven contract for the provider config UI: catalog identity
    plus suggested connection values. Credential-bearing creation still goes
    through the provider endpoints (secrets never flow through the catalog)."""

    slug: str
    name: str
    logo_url: str | None = None
    api_base_url: str | None = None
    doc_url: str | None = None
    npm_package: str | None = None
    env_vars: list[str] = Field(default_factory=list)
    gateway_family: str | None = None
    gateway_supported: bool = False
    suggested_provider_type: str | None = None
    suggested_base_url: str | None = None
    credential_fields: list[CredentialField] = Field(default_factory=list)
