"""Audit trail response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class AuditRead(BaseModel):
    id: uuid.UUID
    action: str
    actor_user_id: uuid.UUID | None
    target: dict
    created_at: datetime
    # Batch user lookup enrichment; both stay null for system events
    # (actor_user_id None), never fabricated.
    actor_email: str | None = None
    actor_name: str | None = None



class NotificationRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID | None
    kind: str
    title: str
    body: str | None
    ref: dict
    read_at: datetime | None
    created_at: datetime

