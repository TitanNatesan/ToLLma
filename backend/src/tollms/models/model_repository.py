"""Model Intelligence Repository tables.

Global, provider-agnostic source of truth for model metadata, pricing,
capabilities, and limits. Populated by ModelRepositorySyncService from
external sources (LiteLLM, OpenRouter); never edited by hand.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel

# Pricing is stored source-native (per-token) at high precision. Consumers
# (e.g. the gateway cost engine, which prices per-1M) must convert units.
PRICE = Numeric(20, 12)


class RepositoryModel(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "model_repository"
    __table_args__ = (
        UniqueConstraint("model_key", name="uq_model_repository_key"),
        Index("ix_model_repository_provider", "provider"),
        Index("ix_model_repository_active", "is_active"),
        Index("ix_model_repository_created", "created_at"),
    )

    model_key: Mapped[str] = mapped_column(String(255), nullable=False)  # e.g. anthropic/claude-sonnet-4
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    family: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    endpoint_type: Mapped[str] = mapped_column(String(64), default="chat_completions", nullable=False)
    # Endpoint-aware metadata (wire paths): the primary endpoint plus every
    # endpoint the model supports. JSONB so new endpoint kinds need no migration.
    primary_endpoint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supported_endpoints: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    documentation_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_deprecated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    supports_text_input: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_text_output: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_chat: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_vision_input: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_image_output: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_audio_input: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_audio_output: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_video_input: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_video_output: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_reasoning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_tool_calling: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_structured_output: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_embeddings: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_prompt_caching: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Capability view derived at sync time from supported_endpoints; stored so
    # clients (and the cost/caching engines) read one row without parsing JSON.
    supports_responses: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_image_generation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_image_editing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_video_generation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_images: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_audio_length: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    max_video_length: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds

    input_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    output_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    cache_read_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    cache_write_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    image_input_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    image_output_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    audio_input_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    audio_output_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    video_input_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    video_output_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    reasoning_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    # Media rate card (official OpenAI pricing, per image / per second of video).
    # Polled per quality so clients can estimate before a generation runs.
    image_low_price: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    image_medium_price: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    image_high_price: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    video_price_per_second: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)

    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    # Full per-source raw payloads, keyed by source name. New upstream fields
    # land here automatically — no migration needed when sources evolve.
    raw_source_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    sources_: Mapped[list["RepositorySource"]] = relationship(
        back_populates="repository_entry", cascade="all, delete-orphan"
    )


class RepositorySource(TimestampedModel):
    """Per-source attribution for a repository entry. Rebuilt on every sync."""

    __tablename__ = "model_repository_sources"
    __table_args__ = (
        UniqueConstraint("source_name", "source_model_id", name="uq_repo_sources_name_model"),
        Index("ix_repo_sources_repo", "model_repository_id"),
        Index("ix_repo_sources_created", "created_at"),
    )

    source_name: Mapped[str] = mapped_column(String(64), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    model_repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_repository.id", ondelete="CASCADE"), nullable=False
    )
    source_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    repository_entry: Mapped["RepositoryModel"] = relationship(back_populates="sources_")


class SyncRun(TimestampedModel):
    __tablename__ = "model_repository_sync_runs"
    __table_args__ = (
        Index("ix_sync_runs_status", "status"),
        Index("ix_sync_runs_created", "created_at"),
    )

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="running", nullable=False)  # running|done|error
    models_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    models_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    models_deactivated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    errors_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_details: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
