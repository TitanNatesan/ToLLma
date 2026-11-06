"""Privacy domain: consent records, retention policies, DSR workflow.

Wave 2 (Agent B). Conventions follow models/guardrail.py: str-enums with
plain String columns, UUID PKs via TimestampedModel, SoftDeleteMixin on
business tables. No back_populates into User/Organization (shared files owned
by the orchestrator — unidirectional relationships like MessageVersion).

Interface freeze refs: F4 (consent enum), F5 (DSR state machine), F9
(retention precedence).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel


class ConsentCategory(str, enum.Enum):
    """F4 frozen enum. Lowercase strings — the B -> E interface."""

    FUNCTIONAL = "functional"  # required, non-withdrawable
    ANALYTICS = "analytics"
    PROMPT_LOGGING = "prompt_logging"
    MARKETING = "marketing"  # reserved, no writers in Wave 2
    THIRD_PARTY_SHARING = "third_party_sharing"  # reserved, needs DPA text


class ConsentStatus(str, enum.Enum):
    GRANTED = "granted"
    WITHDRAWN = "withdrawn"


class ConsentRecord(SoftDeleteMixin, TimestampedModel):
    """One row per (user, category) choice. In-place upsert: withdrawing or
    re-granting updates the live row (no history table in Wave 2)."""

    __tablename__ = "consent_records"
    __table_args__ = (
        Index("ix_consent_records_user", "user_id"),
        Index("ix_consent_records_user_category", "user_id", "category"),
        Index(
            "uq_consent_records_user_category_live",
            "user_id",
            "category",
            unique=True,
            postgresql_where=text("is_deleted = false"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=ConsentStatus.GRANTED.value
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="settings_ui")
    policy_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    owner = relationship("User", lazy="noload")


# Data categories a retention policy can govern.
RETENTION_CATEGORIES = (
    "conversations",
    "messages",
    "attachments",
    "prompt_logs",
    "request_logs",
    "guardrail_triggers",
    "api_request_logs",
)


class RetentionPolicy(SoftDeleteMixin, TimestampedModel):
    """Retention TTL per data category, personal or org scope (exactly one).
    Scope rule mirrors prompt_logging_settings: XOR ownership check."""

    __tablename__ = "retention_policies"
    __table_args__ = (
        CheckConstraint(
            "(user_id IS NULL) != (org_id IS NULL)",
            name="ck_retention_policies_owner_scope",
        ),
        Index("ix_retention_policies_user", "user_id"),
        Index("ix_retention_policies_org", "org_id"),
        Index(
            "uq_retention_policies_personal_live",
            "user_id",
            "data_category",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NULL"),
        ),
        Index(
            "uq_retention_policies_org_live",
            "org_id",
            "data_category",
            unique=True,
            postgresql_where=text("is_deleted = false AND org_id IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    data_category: Mapped[str] = mapped_column(String(32), nullable=False)
    # NULL = keep forever (explicit). Otherwise days, >= 1.
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # When true at any applicable scope: skip capture entirely (F9).
    zero_retention: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    owner = relationship("User", lazy="noload")
    organization = relationship("Organization", lazy="noload")


class DSRType(str, enum.Enum):
    """F5 frozen request types."""

    ACCESS = "access"
    CORRECTION = "correction"
    ERASURE = "erasure"
    PORTABILITY = "portability"
    GRIEVANCE = "grievance"


class DSRStatus(str, enum.Enum):
    """F5 frozen states. Terminal: fulfilled | partially_fulfilled | rejected."""

    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    IN_PROGRESS = "in_progress"
    FULFILLED = "fulfilled"
    PARTIALLY_FULFILLED = "partially_fulfilled"
    REJECTED = "rejected"


DSR_TERMINAL = frozenset(
    {DSRStatus.FULFILLED.value, DSRStatus.PARTIALLY_FULFILLED.value, DSRStatus.REJECTED.value}
)

# Legal transitions (F5). Terminal states accept no outgoing edge.
DSR_TRANSITIONS: dict[str, frozenset[str]] = {
    DSRStatus.SUBMITTED.value: frozenset({DSRStatus.UNDER_REVIEW.value, DSRStatus.REJECTED.value}),
    DSRStatus.UNDER_REVIEW.value: frozenset({DSRStatus.IN_PROGRESS.value, DSRStatus.REJECTED.value}),
    DSRStatus.IN_PROGRESS.value: frozenset(
        {
            DSRStatus.FULFILLED.value,
            DSRStatus.PARTIALLY_FULFILLED.value,
            DSRStatus.REJECTED.value,
        }
    ),
}

DSR_SLA_DAYS = 30


class DSRRequest(SoftDeleteMixin, TimestampedModel):
    """One data-subject request. Status moves only via transition_dsr."""

    __tablename__ = "dsr_requests"
    __table_args__ = (
        Index("ix_dsr_requests_user", "user_id"),
        Index("ix_dsr_requests_status_created", "status", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=DSRStatus.SUBMITTED.value
    )
    reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    owner = relationship("User", lazy="noload")
    events: Mapped[list["DSREvent"]] = relationship(
        back_populates="request", cascade="all, delete-orphan", order_by="DSREvent.created_at"
    )


class DSREvent(TimestampedModel):
    """Append-only transition log. No soft-delete, no UPDATE path."""

    __tablename__ = "dsr_events"
    __table_args__ = (Index("ix_dsr_events_request_created", "dsr_id", "created_at"),)

    dsr_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dsr_requests.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str] = mapped_column(String(24), nullable=False)
    actor: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    request: Mapped["DSRRequest"] = relationship(back_populates="events")
