"""Gateway request/response models."""

import uuid
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    provider_id: uuid.UUID
    model_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    message: str = Field(min_length=1)
    system: str | None = None
    # Capability-aware composer fields. Adapters are text-only today, so the
    # service accepts, validates, and logs these without forwarding content.
    reasoning_level: str | None = Field(default=None, max_length=32)
    attachments: list[dict[str, Any]] = Field(default_factory=list, max_length=10)


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    content: str
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
    usage_estimated: bool
    latency_ms: float
