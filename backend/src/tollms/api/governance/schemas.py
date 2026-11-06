"""Governance DTOs: provider-policy registry + abuse reports. No ORM imports."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


TRAINING_VALUES = ("no", "opt-in", "opt-out", "yes", "unknown")
STATUS_VALUES = (
    "submitted", "under_review", "action_taken", "dismissed",
    "appeal_filed", "action_upheld", "action_reversed",
)
REASON_VALUES = (
    "harmful_content", "prompt_injection_attempt", "secret_or_pii_exposure",
    "policy_violation", "billing_or_quota_abuse", "account_compromise", "other",
)
SUBJECT_VALUES = ("generation", "trigger", "key", "provider", "other")


class ProviderPolicyCreate(BaseModel):
    provider_key: str = Field(min_length=1, max_length=64)
    scope: str = Field(default="global", description="global | organization")
    org_id: uuid.UUID | None = None
    display_name: str = Field(min_length=1, max_length=120)
    terms_url: str | None = None
    aup_url: str | None = None
    privacy_url: str | None = None
    dpa_url: str | None = None
    status_page_url: str | None = None
    commercial_use_allowed: bool | None = None
    training_on_inputs: str = "unknown"
    retention_summary: str | None = None
    retention_days: int | None = Field(default=None, ge=0, le=3650)
    dpa_available: bool = False
    region_pinning_available: bool = False
    last_reviewed_at: date | None = None
    review_cadence_days: int = Field(default=180, ge=1, le=730)
    source_notes: str | None = None
    is_active: bool = True


class ProviderPolicyUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    terms_url: str | None = None
    aup_url: str | None = None
    privacy_url: str | None = None
    dpa_url: str | None = None
    status_page_url: str | None = None
    commercial_use_allowed: bool | None = None
    training_on_inputs: str | None = None
    retention_summary: str | None = None
    retention_days: int | None = Field(default=None, ge=0, le=3650)
    dpa_available: bool | None = None
    region_pinning_available: bool | None = None
    last_reviewed_at: date | None = None
    review_cadence_days: int | None = Field(default=None, ge=1, le=730)
    source_notes: str | None = None
    is_active: bool | None = None


class ProviderPolicyRead(BaseModel):
    id: uuid.UUID
    provider_key: str
    scope: str
    org_id: uuid.UUID | None
    display_name: str
    terms_url: str | None
    aup_url: str | None
    privacy_url: str | None
    dpa_url: str | None
    status_page_url: str | None
    commercial_use_allowed: bool | None
    training_on_inputs: str
    retention_summary: str | None
    retention_days: int | None
    dpa_available: bool
    region_pinning_available: bool
    last_reviewed_at: date | None
    review_cadence_days: int
    source_notes: str | None
    is_active: bool
    stale: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AbuseReportCreate(BaseModel):
    org_id: uuid.UUID | None = None
    subject_type: str = Field(default="other", description="generation | trigger | key | provider | other")
    subject_id: str | None = Field(default=None, max_length=128)
    reason_code: str = Field(description="F7 reason code")
    details: str = Field(min_length=1, max_length=4000)


class AbuseAppeal(BaseModel):
    appeal_note: str = Field(min_length=1, max_length=2000)


class AbuseStatusPatch(BaseModel):
    status: str = Field(description="F7 status; transition-validated")
    resolution_note: str | None = Field(default=None, max_length=2000)
    assignee: uuid.UUID | None = None


class AbuseReportRead(BaseModel):
    id: uuid.UUID
    reporter_user_id: uuid.UUID
    org_id: uuid.UUID | None
    subject_type: str
    subject_id: str | None
    reason_code: str
    details: str
    scan_flags: list[str] = Field(default_factory=list)
    status: str
    assignee: uuid.UUID | None
    resolution_note: str | None
    appeal_note: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
