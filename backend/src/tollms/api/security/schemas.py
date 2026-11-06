"""Security request/response models. Never carries secrets or raw PII."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SecurityAuditRead(BaseModel):
    event_id: uuid.UUID
    occurred_at: datetime
    actor_type: str
    actor_user_id: uuid.UUID | None = None
    actor_key_id: uuid.UUID | None = None
    actor_org_id: uuid.UUID | None = None
    session_id: str | None = None
    event_type: str
    severity: str
    outcome: str
    ip_hash: str | None = None
    user_agent_hash: str | None = None
    target_type: str | None = None
    target_id: uuid.UUID | None = None
    reason: str | None = None
    request_id: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": False}


class RevokeAllResult(BaseModel):
    revoked: int


class KekStatus(BaseModel):
    algorithm: str
    kek_version: int
    rotation_supported: bool
    previous_version_expires_at: datetime | None = None
