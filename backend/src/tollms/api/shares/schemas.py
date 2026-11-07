"""Conversation sharing request/response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from tollms.api.conversations.schemas import ConversationTreeRead
from tollms.models.message import MessageStatus


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
    """One visible node of a shared conversation. Never carries user,
    credential, session, usage, cost, or observability fields — only the
    content plus the tree position needed to render every branch locally.
    Failed/cancelled nodes surface error/error_code only."""

    id: uuid.UUID
    parent_message_id: uuid.UUID | None = None
    version_number: int = 1
    role: str
    status: MessageStatus = MessageStatus.COMPLETED
    content: str
    error: str | None = None
    error_code: str | None = None
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
    # Full versioned tree (every live branch/root, failed + cancelled nodes
    # included with safe error info only); viewers navigate it locally and
    # never mutate the owner's leaf.
    tree: ConversationTreeRead = Field(default_factory=ConversationTreeRead)
    view_count: int
