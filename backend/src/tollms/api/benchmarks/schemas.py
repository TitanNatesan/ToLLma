"""Benchmark run DTOs. No ORM imports. Conditions carry the sampling plan
only — input_text/output_text keys anywhere are rejected (422)."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BenchmarkRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    org_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=128)
    traffic_path: Literal["internal", "external"] = "internal"
    provider_label: str = Field(default="", max_length=128)
    model_label: str = Field(default="", max_length=255)
    logging_mode: str = Field(default="global", max_length=32)
    cache_state: str = Field(default="mixed", max_length=32)
    conditions: dict = Field(default_factory=dict)
    n: int = Field(default=0, ge=0)
    errors: int = Field(default=0, ge=0)
    mean_ms: float | None = Field(default=None, ge=0)
    p50_ms: float | None = Field(default=None, ge=0)
    p95_ms: float | None = Field(default=None, ge=0)
    p99_ms: float | None = Field(default=None, ge=0)
    ttft_mean_ms: float | None = Field(default=None, ge=0)
    ttft_p50_ms: float | None = Field(default=None, ge=0)
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    cache_read_tokens: int = Field(default=0, ge=0)
    cache_write_tokens: int = Field(default=0, ge=0)
    total_cost: Decimal | None = None
    notes: str | None = Field(default=None, max_length=4000)


class BenchmarkRunRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    org_id: uuid.UUID | None
    name: str
    traffic_path: str
    provider_label: str
    model_label: str
    logging_mode: str
    cache_state: str
    conditions: dict = Field(default_factory=dict)
    n: int
    errors: int
    mean_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    p99_ms: float | None = None
    ttft_mean_ms: float | None = None
    ttft_p50_ms: float | None = None
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_cost: Decimal | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class BenchmarkRunList(BaseModel):
    """GET /runs envelope (B1-style): items + X-Next-Cursor header."""

    items: list[BenchmarkRunRead] = Field(default_factory=list)
