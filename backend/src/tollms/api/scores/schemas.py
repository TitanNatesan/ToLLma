"""Score DTOs. No ORM imports — data_type/source mirror models/scores.py."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ScoreCreate(BaseModel):
    name: str = Field(max_length=128)
    data_type: str = Field(default="numeric", pattern="^(numeric|categorical|boolean)$")
    value_num: Decimal | None = None
    value_text: str | None = Field(default=None, max_length=1024)
    trace_id: str | None = Field(default=None, max_length=128)
    prompt_log_id: uuid.UUID | None = None
    session_key: str | None = Field(default=None, max_length=128)
    experiment_id: str | None = Field(default=None, max_length=128)
    source: str = Field(default="human", pattern="^(human|api|judge|system)$")
    config_name: str | None = Field(default=None, max_length=128)
    comment: str | None = Field(default=None, max_length=2000)
    environment: str | None = Field(default=None, max_length=64)


class ScoreRead(BaseModel):
    id: uuid.UUID
    name: str
    data_type: str
    value_num: Decimal | None
    value_text: str | None
    trace_id: str | None
    prompt_log_id: uuid.UUID | None
    session_key: str | None
    experiment_id: str | None
    source: str
    config_name: str | None
    comment: str | None
    environment: str | None
    user_id: uuid.UUID | None
    org_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ScoreList(BaseModel):
    """Canonical GET /scores response envelope. X-Next-Cursor mirrors /logs."""

    items: list[ScoreRead] = Field(default_factory=list)
