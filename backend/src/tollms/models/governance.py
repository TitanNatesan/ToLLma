"""AI governance tables: provider-policy registry + abuse reports.

ProviderPolicy is the advisory registry of upstream provider legal posture
(terms/AUP/privacy/DPA URLs, commercial-use and training signals, review
dates). Wave 2 is advisory-only: no gateway block reads this table.
AbuseReport is the user-facing intake whose status enum (F7) the Agent F
review queue consumes.
"""

import enum
import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel

if TYPE_CHECKING:
    from tollms.models.organization import Organization
    from tollms.models.user import User


class PolicyScope(str, enum.Enum):
    GLOBAL = "global"
    ORGANIZATION = "organization"


class TrainingOnInputs(str, enum.Enum):
    NO = "no"
    OPT_IN = "opt-in"
    OPT_OUT = "opt-out"
    YES = "yes"
    UNKNOWN = "unknown"


class AbuseReportStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    ACTION_TAKEN = "action_taken"
    DISMISSED = "dismissed"
    APPEAL_FILED = "appeal_filed"
    ACTION_UPHELD = "action_upheld"
    ACTION_REVERSED = "action_reversed"


class AbuseReasonCode(str, enum.Enum):
    HARMFUL_CONTENT = "harmful_content"
    PROMPT_INJECTION_ATTEMPT = "prompt_injection_attempt"
    SECRET_OR_PII_EXPOSURE = "secret_or_pii_exposure"
    POLICY_VIOLATION = "policy_violation"
    BILLING_OR_QUOTA_ABUSE = "billing_or_quota_abuse"
    ACCOUNT_COMPROMISE = "account_compromise"
    OTHER = "other"


_STATUS_VALUES = ", ".join(f"'{s.value}'" for s in AbuseReportStatus)
_REASON_VALUES = ", ".join(f"'{r.value}'" for r in AbuseReasonCode)


class ProviderPolicy(SoftDeleteMixin, TimestampedModel):
    """One row per provider legal posture; global (curated) or per-org override."""

    __tablename__ = "provider_policies"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('global', 'organization')",
            name="ck_provider_policies_scope",
        ),
        CheckConstraint(
            "training_on_inputs IN ('no', 'opt-in', 'opt-out', 'yes', 'unknown')",
            name="ck_provider_policies_training",
        ),
        Index("ix_provider_policies_key", "provider_key"),
        Index("ix_provider_policies_org", "org_id"),
        Index("ix_provider_policies_reviewed", "last_reviewed_at"),
        Index("ix_provider_policies_created", "created_at"),
        Index(
            "uq_provider_policies_global_key_live",
            "provider_key",
            unique=True,
            postgresql_where=text("scope = 'global' AND is_deleted = false"),
        ),
        Index(
            "uq_provider_policies_org_key_live",
            "provider_key",
            "org_id",
            unique=True,
            postgresql_where=text("scope = 'organization' AND is_deleted = false"),
        ),
    )

    provider_key: Mapped[str] = mapped_column(String(64), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default=PolicyScope.GLOBAL.value)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    terms_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    aup_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    privacy_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    dpa_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_page_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    commercial_use_allowed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    training_on_inputs: Mapped[str] = mapped_column(
        String(16), nullable=False, default=TrainingOnInputs.UNKNOWN.value
    )
    retention_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dpa_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    region_pinning_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_reviewed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    review_cadence_days: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    source_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # One-directional: reverse sides live in orchestrator-owned models;
    # Wave 3 may add back_populates there.
    organization: Mapped["Organization | None"] = relationship()


class AbuseReport(SoftDeleteMixin, TimestampedModel):
    """User abuse-report intake. Evidence by ID reference only — details holds
    the reporter's words, never prompt/output bodies."""

    __tablename__ = "abuse_reports"
    __table_args__ = (
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="ck_abuse_reports_status"),
        CheckConstraint(f"reason_code IN ({_REASON_VALUES})", name="ck_abuse_reports_reason"),
        CheckConstraint(
            "subject_type IN ('generation', 'trigger', 'key', 'provider', 'other')",
            name="ck_abuse_reports_subject",
        ),
        Index("ix_abuse_reports_status_created", "status", "created_at"),
        Index("ix_abuse_reports_org", "org_id"),
        Index("ix_abuse_reports_reporter", "reporter_user_id"),
        Index("ix_abuse_reports_created", "created_at"),
    )

    reporter_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    subject_type: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    subject_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason_code: Mapped[str] = mapped_column(String(32), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    # Deterministic-scan finding categories for the details text (kind labels
    # only, never excerpts). ["scan_unavailable"] when the engine failed open.
    scan_flags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=AbuseReportStatus.SUBMITTED.value
    )
    assignee: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    appeal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # One-directional (see ProviderPolicy note).
    reporter: Mapped["User"] = relationship(foreign_keys=[reporter_user_id])
    organization: Mapped["Organization | None"] = relationship()
