"""Purge audit log. One row per hard-purged account (success or failure).

No FK to users: the user row is gone by the time this row is written.
deleted_user_id is retained for operator forensics; counts carries the
per-resource purge totals, result is "ok" or "failed".
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from tollms.db.base import TimestampedModel


class PurgeAuditLog(TimestampedModel):
    __tablename__ = "purge_audit_log"
    __table_args__ = (
        Index("ix_purge_audit_log_deleted_user", "deleted_user_id"),
    )

    deleted_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    purged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    counts: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    result: Mapped[str] = mapped_column(Text, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
