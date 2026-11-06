"""Legal document registry + acceptance ledger (ToLLma Trust, F1/F2).

Documents are versioned-immutable: publishing a new MAJOR version archives
the predecessor, never deletes. Acceptances pin the exact text via
{slug, version, content_hash} and are append-only (no UPDATE/DELETE path).
"""

import hashlib
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey

from tollms.db.base import SoftDeleteMixin, TimestampedModel
from tollms.models.user import User


def content_hash_for(body: str) -> str:
    """sha256 pin over canonical markdown (LF, no front-matter)."""
    canonical = body.replace("\r\n", "\n").strip() + "\n"
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class LegalDocument(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "legal_documents"
    __table_args__ = (
        Index("ix_legal_documents_slug", "slug"),
        Index("ix_legal_documents_status", "status"),
    )

    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    locale: Mapped[str] = mapped_column(String(12), nullable=False, default="en-IN")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    requires_reaccept: Mapped[bool] = mapped_column(nullable=False, default=False)
    effective_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LegalAcceptance(TimestampedModel):
    """Append-only evidence ledger. No soft-delete: history is immutable."""

    __tablename__ = "legal_acceptances"
    __table_args__ = (
        Index("ix_legal_acceptances_user", "user_id"),
        Index("ix_legal_acceptances_slug", "document_slug"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    user: Mapped[User] = relationship(back_populates="legal_acceptances")
    document_slug: Mapped[str] = mapped_column(String(120), nullable=False)
    document_version: Mapped[str] = mapped_column(String(32), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    method: Mapped[str] = mapped_column(String(32), nullable=False)
    locale: Mapped[str] = mapped_column(String(12), nullable=False, default="en-IN")
    ui_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_trunc: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent_snippet: Mapped[str | None] = mapped_column(String(200), nullable=True)
