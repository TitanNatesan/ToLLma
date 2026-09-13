"""Model Intelligence Repository tables.

Global, provider-agnostic source of truth for model metadata, pricing,
capabilities, and limits. Populated by ModelRepositorySyncService from
external sources (LiteLLM, OpenRouter); never edited by hand.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

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
    endpoint_type: Mapped[str] = mapped_column(String(64), default="chat_completions", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_deprecated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    supports_text_input: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    supports_text_output: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
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
    audio_input_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    audio_output_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    video_input_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)
    reasoning_cost: Mapped[Decimal | None] = mapped_column(PRICE, nullable=True)

    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    # Full per-source raw payloads, keyed by source name. New upstream fields
    # land here automatically — no migration needed when sources evolve.
    raw_source_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)


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
