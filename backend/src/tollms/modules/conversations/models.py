"""Conversation + message tables. Usage/cost stored per assistant message."""

import enum
import uuid
from decimal import Decimal

from sqlalchemy import Enum, Float, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import Base, SoftDeleteMixin, TimestampedModel


class Role(str, enum.Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class Conversation(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "conversations"
    __table_args__ = (
        Index("ix_conversations_updated", "updated_at"),
        Index("ix_conversations_created", "created_at"),
        Index("ix_conversations_pinned", "is_pinned"),
    )

    title: Mapped[str] = mapped_column(String(255), default="New conversation", nullable=False)
    is_pinned: Mapped[bool] = mapped_column(default=False, nullable=False, server_default="false")
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("providers.id"), nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("models.id"), nullable=True)

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )


class Message(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation", "conversation_id"),
        Index("ix_messages_created", "created_at"),
        Index("ix_messages_role", "role"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[Role] = mapped_column(Enum(Role, name="message_role"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("providers.id"), nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("models.id"), nullable=True)

    prompt_tokens: Mapped[int | None] = mapped_column(nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(nullable=True)
    input_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    output_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
