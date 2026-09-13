"""Conversation table. Message table lives in message.py."""

import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel


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
