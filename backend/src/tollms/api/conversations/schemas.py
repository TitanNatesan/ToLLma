"""Conversation + message request/response models."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from tollms.api.attachments.schemas import AttachmentRead
from tollms.models.message import Role


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
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None
    input_cost: Decimal | None
    output_cost: Decimal | None
    total_cost: Decimal | None
    cache_read_cost: Decimal | None = None
    cache_write_cost: Decimal | None = None
    reasoning_cost: Decimal | None = None
    latency_ms: float | None = None
    created_at: datetime
    attachments: list[AttachmentRead] = Field(default_factory=list)

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


class ModelUsageBreakdown(BaseModel):
    model_id: uuid.UUID | None
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    total_cost: Decimal


class ProviderUsageBreakdown(BaseModel):
    provider_id: uuid.UUID | None
    provider_name: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    total_cost: Decimal


class UsageTotals(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    input_cost: Decimal
    output_cost: Decimal
    total_cost: Decimal
    cache_read_cost: Decimal = Decimal(0)
    cache_write_cost: Decimal = Decimal(0)
    reasoning_cost: Decimal = Decimal(0)
    by_model: list[ModelUsageBreakdown] = Field(default_factory=list)
    by_provider: list[ProviderUsageBreakdown] = Field(default_factory=list)
