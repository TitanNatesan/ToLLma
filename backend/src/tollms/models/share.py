"""Public conversation sharing + read-only lookup tokens."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import TimestampedModel


class ConversationShare(TimestampedModel):
    """A revocable public link for one conversation. Never exposes credentials."""

    __tablename__ = "conversation_shares"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    share_token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    is_public: Mapped[bool] = mapped_column(default=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    conversation = relationship("Conversation", lazy="noload")

    __table_args__ = (
        Index("ix_conversation_shares_conversation_public", "conversation_id", "is_public"),
    )
