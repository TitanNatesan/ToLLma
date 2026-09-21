"""Request-log read models (observability API + log-based analytics)."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class RequestLogRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None
    message_id: uuid.UUID | None = None
    provider_id: uuid.UUID | None = None
    provider_name: str | None = None
    model_id: uuid.UUID | None = None
    model_name: str | None = None
    request_started_at: datetime | None = None
    request_completed_at: datetime | None = None
    latency_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    input_cost: Decimal | None = None
    output_cost: Decimal | None = None
    total_cost: Decimal | None = None
    status: str
    error_code: str | None = None
    is_regeneration: bool
    is_streaming: bool
    created_at: datetime


class RequestLogPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[RequestLogRead]


class ProviderLogRow(BaseModel):
    provider_id: uuid.UUID | None = None
    provider_name: str
    requests: int
    tokens: int
    cost: Decimal
    avg_latency_ms: float
    failed: int


class RequestLogSummary(BaseModel):
    """Aggregates computed from request_logs (the per-request ledger)."""

    range_start: datetime
    range_end: datetime
    requests: int
    total_cost: Decimal
    total_tokens: int
    avg_latency_ms: float
    failed: int
    cancelled: int
    regenerations: int
    by_provider: list[ProviderLogRow] = Field(default_factory=list)
