"""Compliance operations request/response models.

Reporter-PII rule: intake responses echo only id + status + received_at.
Contact/details/verify_notes appear only on admin detail reads, never on
lists. Public subprocessor shape is exactly F10
{name, purpose, location, status}.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from tollms.models.incidents import (
    ComplaintStatus,
    IncidentKind,
    IncidentSeverity,
    IncidentStatus,
    LegalRequestStatus,
    LegalRequestType,
    SubprocessorStatus,
    VulnReportStatus,
    VulnSeverity,
)

# --- intake (public, rate-limited) -------------------------------------------
# No abuse intake here: F7 freeze — intake + table are owned by Agent D.


class VulnIntake(BaseModel):
    title: str = Field(min_length=4, max_length=300)
    details: str = Field(min_length=10, max_length=20000)
    affected: str | None = Field(default=None, max_length=1000)
    reporter_contact: str | None = Field(default=None, max_length=320)


class ComplaintIntake(BaseModel):
    subject: str = Field(min_length=4, max_length=300)
    category: str = Field(default="general", max_length=64)
    details: str = Field(min_length=10, max_length=20000)
    reporter_contact: str | None = Field(default=None, max_length=320)


class LegalContactIntake(BaseModel):
    claimant: str = Field(min_length=2, max_length=500)
    authority_ref: str | None = Field(default=None, max_length=500)
    reporter_contact: str | None = Field(default=None, max_length=320)
    details: str = Field(default="", max_length=20000)


class IntakeAccepted(BaseModel):
    id: uuid.UUID
    status: str
    received_at: datetime


# --- admin case views (PII-free lists) ---------------------------------------


class CaseListItem(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    severity: str | None = None
    created_at: datetime
    updated_at: datetime


class TimelineEntry(BaseModel):
    at: datetime
    actor: str
    from_status: str = Field(alias="from")
    to: str
    note: str | None = None


class IncidentDetail(CaseListItem):
    kind: str
    summary: str | None = None
    timeline: list[dict] = Field(default_factory=list)
    linked_guardrail_trigger_ids: list[str] = Field(default_factory=list)
    linked_request_ids: list[str] = Field(default_factory=list)
    security_audit_ids: list[str] = Field(default_factory=list)
    owner_admin_id: uuid.UUID | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None


class LegalDetail(CaseListItem):
    request_type: str
    claimant: str
    authority_ref: str | None = None
    reporter_contact: str | None = None  # admin-only
    verify_notes: str | None = None  # admin-only
    verified_by: uuid.UUID | None = None
    fulfilled_by: uuid.UUID | None = None
    due_at: datetime | None = None
    hold_active: bool = True
    related_incident_id: uuid.UUID | None = None
    timeline: list[dict] = Field(default_factory=list)


class VulnDetail(CaseListItem):
    affected: str | None = None
    details: str = ""  # admin-only read
    reporter_contact: str | None = None  # admin-only
    coordinated_disclosure_at: datetime | None = None
    fixed_at: datetime | None = None
    related_incident_id: uuid.UUID | None = None
    timeline: list[dict] = Field(default_factory=list)


class ComplaintDetail(CaseListItem):
    category: str
    details: str = ""  # admin-only read
    reporter_contact: str | None = None  # admin-only
    sla_due_at: datetime | None = None
    related_incident_id: uuid.UUID | None = None
    timeline: list[dict] = Field(default_factory=list)


class CaseListPage(BaseModel):
    items: list[CaseListItem]
    next_cursor: str | None = None


# --- admin writes --------------------------------------------------------------


class StatusPatch(BaseModel):
    to: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=2000)
    link_incident_id: uuid.UUID | None = None
    owner_admin_id: uuid.UUID | None = None


class IncidentCreate(BaseModel):
    title: str = Field(min_length=4, max_length=300)
    kind: str = Field(default=IncidentKind.OTHER.value, max_length=32)
    severity: str = Field(default=IncidentSeverity.SEV3_MEDIUM.value, max_length=32)
    summary: str | None = Field(default=None, max_length=20000)


# --- subprocessors -------------------------------------------------------------


class SubprocessorPublic(BaseModel):
    """Exact F10 shape for the Trust Center. No admin fields, ever."""

    name: str
    purpose: str
    location: str
    status: str


class SubprocessorAdminRead(SubprocessorPublic):
    id: uuid.UUID
    dpa_ref: str | None = None
    added_at: datetime
    removed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SubprocessorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    purpose: str = Field(default="", max_length=5000)
    location: str = Field(default="", max_length=120)
    status: str = Field(default=SubprocessorStatus.ACTIVE.value, max_length=16)
    dpa_ref: str | None = Field(default=None, max_length=2000)


class SubprocessorUpdate(BaseModel):
    purpose: str | None = Field(default=None, max_length=5000)
    location: str | None = Field(default=None, max_length=120)
    status: str | None = Field(default=None, max_length=16)
    dpa_ref: str | None = Field(default=None, max_length=2000)
