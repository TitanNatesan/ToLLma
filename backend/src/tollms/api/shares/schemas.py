"""Conversation sharing request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ShareCreate(BaseModel):
    conversation_id: uuid.UUID
    expires_in_hours: int | None = Field(default=None, ge=1, le=24 * 365)


class ShareUpdate(BaseModel):
    is_public: bool | None = None
    expires_in_hours: int | None = Field(default=None, ge=1, le=24 * 365)


class ShareRead(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    share_token: str
    share_url: str
    is_public: bool
    expires_at: datetime | None = None
    view_count: int
    created_at: datetime


class PublicShareMessage(BaseModel):
    role: str
    content: str
    created_at: datetime
    model_name: str | None = None


class PublicShareRead(BaseModel):
    """Read-only public payload. Never contains user or credential information."""

    title: str
    created_at: datetime
    updated_at: datetime
    model_name: str | None = None
    provider_name: str | None = None
    messages: list[PublicShareMessage]
    view_count: int
