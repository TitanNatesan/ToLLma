"""Message edit history + response regeneration history."""

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import TimestampedModel


class MessageVersion(TimestampedModel):
    """Immutable snapshot of a message's content at a point in time."""

    __tablename__ = "message_versions"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    edited_by: Mapped[str] = mapped_column(String(16), nullable=False, default="user")

    message = relationship("Message", lazy="noload")

    __table_args__ = (
        UniqueConstraint("message_id", "version_number", name="uq_message_versions_message_number"),
    )


class GenerationRun(TimestampedModel):
    """One generation attempt for an assistant message (initial or regenerated)."""

    __tablename__ = "generation_runs"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    generation_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Attributing key for the generation (NULL = legacy/keyless).
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    provider_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="SET NULL"), nullable=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    is_active: Mapped[bool] = mapped_column(default=False, nullable=False)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Numeric(12, 3), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    message = relationship("Message", lazy="noload")
    provider = relationship("Provider", lazy="joined")
    model = relationship("AIModel", lazy="joined")

    __table_args__ = (
        UniqueConstraint("message_id", "generation_number", name="uq_generation_runs_message_number"),
        Index("ix_generation_runs_message_active", "message_id", "is_active"),
        Index("ix_generation_runs_api_key", "api_key_id"),
    )
