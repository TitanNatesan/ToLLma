"""Gateway request/response models."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    provider_id: uuid.UUID
    model_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    message: str = Field(min_length=1)
    system: str | None = None


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    content: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    input_cost: Decimal
    output_cost: Decimal
    total_cost: Decimal
    usage_estimated: bool
    latency_ms: float
