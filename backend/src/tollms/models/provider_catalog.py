"""Provider catalog: global models.dev-sourced provider definitions.

Catalog rows describe EXTERNAL providers (discovery metadata only) and never
hold credentials. User connections (personal/org Provider rows with Fernet
credentials) reference the catalog by slug for display/discovery only.
"""

import uuid

from sqlalchemy import Boolean, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from tollms.db.base import SoftDeleteMixin, TimestampedModel


class ProviderCatalog(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "provider_catalog"
    __table_args__ = (
        Index("uq_provider_catalog_slug_live", "slug", unique=True,
              postgresql_where=text("is_deleted = false")),
        Index("uq_provider_catalog_source_id", "source", "source_id", unique=True),
        Index("ix_provider_catalog_gateway", "gateway_supported"),
        Index("ix_provider_catalog_active", "is_active"),
    )

    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    doc_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    npm_package: Mapped[str | None] = mapped_column(String(120), nullable=True)
    env_vars: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="modelsdev")
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    # ToLLma gateway family (ProviderType value) or NULL when catalog-only.
    gateway_family: Mapped[str | None] = mapped_column(String(32), nullable=True)
    gateway_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    capabilities: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    model_count: Mapped[int] = mapped_column(nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    extra: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
