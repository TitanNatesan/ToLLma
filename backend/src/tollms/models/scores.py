"""Trace/observation quality scores (Langfuse-subset, minimal).

No score_configs table, no datasets/experiments (P3, gated). Corrections are
new rows, except the same-(name, subject, day) rewrite which replaces.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import TimestampedModel

DATA_TYPES = ("numeric", "categorical", "boolean")
SOURCES = ("human", "api", "judge", "system")


class Score(TimestampedModel):
    """Append-only quality judgment. No soft-delete (immutable like PromptLog)."""

    __tablename__ = "scores"
    __table_args__ = (
        # Exactly one workspace: personal (user_id) or org (org_id).
        CheckConstraint(
            "(user_id IS NULL) != (org_id IS NULL)",
            name="ck_scores_owner_scope",
        ),
        # Rewrite-rule guard (H3): same scope+name+day+subject collapses to
        # one row; concurrent INSERTs raise IntegrityError → service updates.
        Index(
            "uq_scores_rewrite",
            text("COALESCE(user_id::text, '')"),
            text("COALESCE(org_id::text, '')"),
            text("name"),
            text("subject_day"),
            text("COALESCE(trace_id, '')"),
            text("COALESCE(prompt_log_id::text, '')"),
            unique=True,
        ),
        Index("ix_scores_user", "user_id"),
        Index("ix_scores_org", "org_id"),
        Index("ix_scores_org_created", "org_id", "created_at"),
        Index("ix_scores_user_created", "user_id", "created_at"),
        Index("ix_scores_name_created", "name", "created_at"),
        Index("ix_scores_trace", "trace_id"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # UTC day of creation: rewrite rule key (same subject+day replaces).
    # A plain DATE column (not an expression index on created_at) because
    # timestamptz→date casts are STABLE and unusable in index expressions.
    subject_day: Mapped[date] = mapped_column(Date, nullable=False)
    data_type: Mapped[str] = mapped_column(String(16), nullable=False, default="numeric")
    value_num: Mapped[Decimal | None] = mapped_column(Numeric(12, 8), nullable=True)
    value_text: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Subject: at least one of trace_id / prompt_log_id. 404-oracle enforced
    # in service (subject must resolve inside the caller's workspace).
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_logs.id", ondelete="SET NULL"), nullable=True
    )
    session_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # No FK: a future eval harness may reference runs that don't exist here.
    experiment_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="human")
    config_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    environment: Mapped[str | None] = mapped_column(String(64), nullable=True)

    prompt_log: Mapped["PromptLog | None"] = relationship(back_populates="scores")
