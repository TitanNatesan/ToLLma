"""Message history, editing, regeneration and generation navigation models."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from tollms.api.conversations.schemas import GenerationRunRead, MessageRead


class MessageVersionRead(BaseModel):
    id: uuid.UUID
    version_number: int
    content: str
    edited_by: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageHistoryRead(BaseModel):
    message_id: uuid.UUID
    role: str
    current_content: str
    current_version: int
    versions: list[MessageVersionRead]
    generations: list[GenerationRunRead]
    active_generation_id: uuid.UUID | None = None


class MessageEditRequest(BaseModel):
    content: str = Field(min_length=1, max_length=200_000)


class MessageEditRead(BaseModel):
    message: MessageRead
    versions: list[MessageVersionRead]
    current_version: int
    regeneration_started: bool = False
    regenerating_message_id: uuid.UUID | None = None


class GenerationActivateRead(BaseModel):
    message: MessageRead
    run: GenerationRunRead
