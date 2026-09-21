"""Per-AI-request ledger: durable logging for reliability + analytics."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import TimestampedModel


class RequestStatus(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REGENERATED = "regenerated"


class RequestLog(TimestampedModel):
    """One row per AI request (streaming or not), success or failure."""

    __tablename__ = "request_logs"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True, index=True
    )
    request_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    output_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=RequestStatus.SUCCESS.value)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    is_regeneration: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_streaming: Mapped[bool] = mapped_column(default=False, nullable=False)

    provider = relationship("Provider", lazy="joined")
    model = relationship("AIModel", lazy="joined")

    __table_args__ = (
        Index("ix_request_logs_user_created", "user_id", "created_at"),
        Index("ix_request_logs_status", "status"),
        Index("ix_request_logs_conversation", "conversation_id", "created_at"),
    )


class ExportEvent(TimestampedModel):
    """Export audit trail (powers the export-count analytics widget)."""

    __tablename__ = "export_events"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    dataset: Mapped[str] = mapped_column(String(48), nullable=False)
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_export_events_user_created", "user_id", "created_at"),)
