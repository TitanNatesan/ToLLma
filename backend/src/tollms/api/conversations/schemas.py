"""Conversation + message request/response models."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from tollms.api.attachments.schemas import AttachmentRead
from tollms.models.message import MessageStatus, Role


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
    status: MessageStatus = MessageStatus.COMPLETED
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    error_code: str | None = None
    thinking_ms: int | None = None
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
    generations: list["GenerationRunRead"] = Field(default_factory=list)
    active_generation_id: uuid.UUID | None = None
    versions_count: int = 0

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


class BranchCreateRequest(BaseModel):
    message_id: uuid.UUID
    branch_name: str | None = Field(default=None, max_length=120)


class BranchRead(BaseModel):
    conversation_id: uuid.UUID
    title: str
    parent_conversation_id: uuid.UUID | None = None
    branch_from_message_id: uuid.UUID | None = None
    branch_name: str | None = None
    message_count: int
    created_at: datetime


class BranchListRead(BaseModel):
    current: BranchRead
    parent: BranchRead | None = None
    siblings: list[BranchRead] = Field(default_factory=list)
    children: list[BranchRead] = Field(default_factory=list)


class GenerationRunRead(BaseModel):
    id: uuid.UUID
    generation_number: int
    provider_id: uuid.UUID | None = None
    model_id: uuid.UUID | None = None
    provider_name: str | None = None
    model_name: str | None = None
    content: str
    status: str
    is_active: bool
    total_tokens: int | None = None
    total_cost: Decimal | None = None
    latency_ms: float | None = None
    error: str | None = None
    created_at: datetime
