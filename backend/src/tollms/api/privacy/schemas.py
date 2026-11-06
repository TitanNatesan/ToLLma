"""Privacy request/response models. Enums imported from models, never ORM classes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from tollms.models.privacy import ConsentCategory, DSRStatus, DSRType

ConsentCategoryLiteral = Literal[
    "functional", "analytics", "prompt_logging", "marketing", "third_party_sharing"
]
RetentionCategoryLiteral = Literal[
    "conversations",
    "messages",
    "attachments",
    "prompt_logs",
    "request_logs",
    "guardrail_triggers",
    "api_request_logs",
]
DSRTypeLiteral = Literal["access", "correction", "erasure", "portability", "grievance"]
DSRStatusLiteral = Literal[
    "submitted",
    "under_review",
    "in_progress",
    "fulfilled",
    "partially_fulfilled",
    "rejected",
]

# Keep Literal unions in sync with the frozen model enums (F4/F5).
assert set(ConsentCategoryLiteral.__args__) == {c.value for c in ConsentCategory}
assert set(DSRTypeLiteral.__args__) == {t.value for t in DSRType}
assert set(DSRStatusLiteral.__args__) == {s.value for s in DSRStatus}


class ConsentSetRequest(BaseModel):
    category: ConsentCategoryLiteral
    granted: bool = True
    source: str = Field(default="settings_ui", max_length=32)


class ConsentRead(BaseModel):
    id: uuid.UUID
    category: str
    status: str
    version: int
    granted_at: datetime | None = None
    withdrawn_at: datetime | None = None
    updated_at: datetime


class RetentionSetRequest(BaseModel):
    data_category: RetentionCategoryLiteral
    retention_days: int | None = Field(default=None, ge=1)
    zero_retention: bool = False
    org_id: uuid.UUID | None = None


class RetentionRead(BaseModel):
    id: uuid.UUID
    data_category: str
    retention_days: int | None = None
    zero_retention: bool = False
    org_id: uuid.UUID | None = None
    version: int
    updated_at: datetime


class DSRSubmitRequest(BaseModel):
    type: DSRTypeLiteral
    detail: str | None = Field(default=None, max_length=4000)


class DSRTransitionRequest(BaseModel):
    to_status: DSRStatusLiteral
    reason_code: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)


class DSREventRead(BaseModel):
    id: uuid.UUID
    from_status: str | None = None
    to_status: str
    note: str | None = None
    created_at: datetime


class DSRRead(BaseModel):
    id: uuid.UUID
    type: str
    status: str
    reason_code: str | None = None
    detail: str | None = None
    due_at: datetime
    fulfilled_at: datetime | None = None
    created_at: datetime
    events: list[DSREventRead] = Field(default_factory=list)


class ErasureRequest(BaseModel):
    """Local password proof for erasure scheduling. Maps onto the settings
    deletion service (AccountDeleteRequest) inside service.py — never import
    sibling-domain schemas here."""

    current_password: str | None = Field(default=None, min_length=1, max_length=128)


class ErasureRead(BaseModel):
    scheduled_for: datetime
    days_remaining: int
