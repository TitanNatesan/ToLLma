"""Conversation + message request/response models."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from tollms.modules.conversations.models import Role


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ConversationPin(BaseModel):
    pinned: bool


class MessageRead(BaseModel):
    id: uuid.UUID
    role: Role
    content: str
    provider_id: uuid.UUID | None
    model_id: uuid.UUID | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    input_cost: Decimal | None
    output_cost: Decimal | None
    total_cost: Decimal | None
    latency_ms: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationRead(BaseModel):
    id: uuid.UUID
    title: str
    is_pinned: bool = False
    provider_id: uuid.UUID | None
    model_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    messages: list[MessageRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UsageTotals(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    input_cost: Decimal
    output_cost: Decimal
    total_cost: Decimal
