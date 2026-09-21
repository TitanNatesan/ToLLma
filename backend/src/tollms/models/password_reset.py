"""Single-use, hashed password reset tokens (never stored in plaintext)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import TimestampedModel


class PasswordResetToken(TimestampedModel):
    """sha256(raw token) only. Single-use (`used_at`) and time-boxed (`expires_at`)."""

    __tablename__ = "password_reset_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user = relationship("User", lazy="noload")

    __table_args__ = (Index("ix_password_reset_user_created", "user_id", "created_at"),)
