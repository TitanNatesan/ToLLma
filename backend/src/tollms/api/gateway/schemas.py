"""Gateway request/response models."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class ChatRequest(BaseModel):
    provider_id: uuid.UUID
    model_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    message: str = ""
    system: str | None = None
    reasoning_level: str | None = Field(default=None, max_length=32)
    # Uploaded attachments (POST /api/v1/chat/attachments first). Content is
    # resolved, ownership-checked, and forwarded by the gateway.
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def _message_or_attachments(self) -> "ChatRequest":
        if not self.message.strip() and not self.attachment_ids:
            raise ValueError("message must not be blank")
        return self


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
