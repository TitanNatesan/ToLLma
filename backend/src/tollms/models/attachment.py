"""Attachment table. Rows own the file bytes on disk via storage_path (never exposed)."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.conversation import Conversation
    from tollms.models.message import Message


class Attachment(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "attachments"
    __table_args__ = (
        Index("ix_attachments_user", "user_id"),
        Index("ix_attachments_conversation", "conversation_id"),
        Index("ix_attachments_message", "message_id"),
        Index("ix_attachments_created", "created_at"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Null until the attachment is sent inside a conversation.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True
    )
    # Null until the user message carrying it is persisted.
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(127), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="document")
    file_size: Mapped[int] = mapped_column(nullable=False, default=0)
    # Relative to storage_dir, e.g. <user>/<conv>/uuid_name.png. Never serialized.
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    # Document text extracted at upload; injected into prompt context at send.
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    message: Mapped["Message | None"] = relationship(back_populates="attachments")
    conversation: Mapped["Conversation | None"] = relationship(back_populates="attachments")
