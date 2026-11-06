"""Compliance operations tables (Agent F, MODULE 5).

Incidents, legal requests, vulnerability reports, complaints, subprocessor
registry. Every table: UUID PK + created_at/updated_at (TimestampedModel);
business tables carry SoftDeleteMixin. Status columns are TEXT+CHECK so the
state machine is enforced at the DB layer as well as app-side.

Deliberately absent: abuse reports. Intake + table + PATCH are owned by
Agent D (`models/governance.py`, F7 freeze); F reads D's table via the
governance review endpoint. No duplicate table here.

Legal-hold rule: `legal_requests` rows with `hold_active=true` (and
`vulnerability_reports` linked to an open incident) must never be
hard-purged. Enforced app-side via
`api.incidents.service.assert_no_active_hold` — the DSR/account-purge engine
must call it before any hard delete. No FK to users on reporter contact
strings: reporter PII is a free-text admin-only field, never a join key.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tollms.db.base import SoftDeleteMixin, TimestampedModel


class IncidentSeverity(str, enum.Enum):
    SEV1_CRITICAL = "sev1_critical"
    SEV2_HIGH = "sev2_high"
    SEV3_MEDIUM = "sev3_medium"
    SEV4_LOW = "sev4_low"


class IncidentStatus(str, enum.Enum):
    OPEN = "open"
    TRIAGED = "triaged"
    MITIGATING = "mitigating"
    RESOLVED = "resolved"
    CLOSED = "closed"
    DUPLICATE = "duplicate"


class IncidentKind(str, enum.Enum):
    SECURITY = "security"
    AVAILABILITY = "availability"
    PRIVACY = "privacy"
    ABUSE_ESCALATION = "abuse_escalation"
    COMPLIANCE = "compliance"
    OTHER = "other"


class LegalRequestType(str, enum.Enum):
    SUBPOENA = "subpoena"
    COURT_ORDER = "court_order"
    WARRANT = "warrant"
    REGULATORY = "regulatory"
    TAKEDOWN = "takedown"
    PRESERVATION = "preservation"
    OTHER = "other"


class LegalRequestStatus(str, enum.Enum):
    RECEIVED = "received"
    VERIFYING = "verifying"
    VALIDATED = "validated"
    IN_REVIEW = "in_review"
    FULFILLED = "fulfilled"
    REJECTED = "rejected"
    CLOSED = "closed"


class VulnReportStatus(str, enum.Enum):
    RECEIVED = "received"
    TRIAGED = "triaged"
    CONFIRMED = "confirmed"
    FIXED = "fixed"
    DISCLOSED = "disclosed"
    DISMISSED = "dismissed"
    CLOSED = "closed"


class VulnSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ComplaintStatus(str, enum.Enum):
    RECEIVED = "received"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"
    ESCALATED = "escalated"
    CLOSED = "closed"


class SubprocessorStatus(str, enum.Enum):
    ACTIVE = "active"
    PENDING = "pending"
    REMOVED = "removed"


def _check(name: str, column: str, values: list[str]) -> CheckConstraint:
    quoted = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{column} IN ({quoted})", name=name)


class Incident(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "incidents"
    __table_args__ = (
        _check("ck_incidents_severity", "severity", [s.value for s in IncidentSeverity]),
        _check("ck_incidents_status", "status", [s.value for s in IncidentStatus]),
        _check("ck_incidents_kind", "kind", [s.value for s in IncidentKind]),
        Index("ix_incidents_status", "status"),
        Index("ix_incidents_severity", "severity"),
        Index("ix_incidents_created", "created_at"),
        Index("ix_incidents_owner", "owner_admin_id"),
    )

    title: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default=IncidentKind.OTHER.value)
    severity: Mapped[str] = mapped_column(
        String(32), nullable=False, default=IncidentSeverity.SEV3_MEDIUM.value)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=IncidentStatus.OPEN.value)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Append-only transition history: [{at, actor, from, to, note}]. Never edited.
    timeline: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Cross-refs by id string (no FK: source rows may be purged independently).
    linked_guardrail_trigger_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    linked_request_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # F6 security-audit event ids (nullable until Agent C's table lands).
    security_audit_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    owner_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # One-sided: User collections live in models/user.py (orchestrator-owned).
    reporter = relationship("User", foreign_keys=[reporter_user_id])
    owner = relationship("User", foreign_keys=[owner_admin_id])
    legal_requests: Mapped[list["LegalRequest"]] = relationship(back_populates="incident")
    vuln_reports: Mapped[list["VulnerabilityReport"]] = relationship(back_populates="incident")
    complaints: Mapped[list["Complaint"]] = relationship(back_populates="incident")


class LegalRequest(SoftDeleteMixin, TimestampedModel):
    """Never hard-purge while hold_active (app-side guard)."""

    __tablename__ = "legal_requests"
    __table_args__ = (
        _check("ck_legal_requests_type", "request_type", [s.value for s in LegalRequestType]),
        _check("ck_legal_requests_status", "status", [s.value for s in LegalRequestStatus]),
        Index("ix_legal_requests_status", "status"),
        Index("ix_legal_requests_created", "created_at"),
        Index("ix_legal_requests_incident", "related_incident_id"),
    )

    request_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default=LegalRequestType.OTHER.value)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=LegalRequestStatus.RECEIVED.value)
    claimant: Mapped[str] = mapped_column(Text, nullable=False, default="")
    authority_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    reporter_contact: Mapped[str | None] = mapped_column(Text, nullable=True)  # admin-only PII
    # Verification trail: which admin validated, which (different) admin fulfilled.
    verify_notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # admin-only
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    fulfilled_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hold_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    related_incident_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    timeline: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    incident: Mapped["Incident | None"] = relationship(back_populates="legal_requests")
    verifier = relationship("User", foreign_keys=[verified_by])
    fulfiller = relationship("User", foreign_keys=[fulfilled_by])

    @property
    def title(self) -> str:  # read-only alias for admin case views
        return self.claimant


class VulnerabilityReport(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "vulnerability_reports"
    __table_args__ = (
        _check("ck_vuln_reports_status", "status", [s.value for s in VulnReportStatus]),
        _check("ck_vuln_reports_severity", "severity", [s.value for s in VulnSeverity]),
        Index("ix_vuln_reports_status", "status"),
        Index("ix_vuln_reports_severity", "severity"),
        Index("ix_vuln_reports_created", "created_at"),
        Index("ix_vuln_reports_incident", "related_incident_id"),
    )

    title: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default=VulnSeverity.MEDIUM.value)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=VulnReportStatus.RECEIVED.value)
    affected: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reporter_contact: Mapped[str | None] = mapped_column(Text, nullable=True)  # admin-only PII
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    coordinated_disclosure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    related_incident_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    timeline: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    incident: Mapped["Incident | None"] = relationship(back_populates="vuln_reports")
    reporter = relationship("User", foreign_keys=[reporter_user_id])


class Complaint(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "complaints"
    __table_args__ = (
        _check("ck_complaints_status", "status", [s.value for s in ComplaintStatus]),
        Index("ix_complaints_status", "status"),
        Index("ix_complaints_created", "created_at"),
        Index("ix_complaints_incident", "related_incident_id"),
    )

    subject: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="general")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ComplaintStatus.RECEIVED.value)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reporter_contact: Mapped[str | None] = mapped_column(Text, nullable=True)  # admin-only PII
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    related_incident_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    timeline: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    incident: Mapped["Incident | None"] = relationship(back_populates="complaints")
    reporter = relationship("User", foreign_keys=[reporter_user_id])

    @property
    def title(self) -> str:  # read-only alias for admin case views
        return self.subject


class Subprocessor(SoftDeleteMixin, TimestampedModel):
    __tablename__ = "subprocessors"
    __table_args__ = (
        _check("ck_subprocessors_status", "status", [s.value for s in SubprocessorStatus]),
        Index("uq_subprocessors_name_live", "name", unique=True,
              postgresql_where=text("is_deleted = false")),
        Index("ix_subprocessors_status", "status"),
        Index("ix_subprocessors_created", "created_at"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False, default="")
    location: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=SubprocessorStatus.ACTIVE.value)
    dpa_ref: Mapped[str | None] = mapped_column(Text, nullable=True)  # admin-only
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
