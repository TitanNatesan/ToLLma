"""Prompt logging DTOs. No ORM imports — enums mirror models/prompt_logging.py."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SettingsUpdate(BaseModel):
    org_id: uuid.UUID | None = None
    enabled: bool = False
    mode: str = "global"
    team_ids: list[uuid.UUID] | None = Field(default=None, max_length=100)
    key_ids: list[str] | None = Field(default=None, max_length=100)
    # Hierarchical enablement: per-team force on/off and per-key on/off/
    # inherit (null). Absent entries default to True for listed ids.
    team_states: dict[str, bool] | None = None
    key_states: dict[str, bool | None] | None = None
    capture_input: bool = False
    capture_output: bool = False
    retention_days: int | None = Field(default=None, ge=1, le=3650)


class TeamStateUpdate(BaseModel):
    enabled: bool


class KeyStateUpdate(BaseModel):
    # null resets to inherit (deletes the override row).
    enabled: bool | None = None


class SettingsRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    org_id: uuid.UUID | None
    enabled: bool
    mode: str
    capture_input: bool
    capture_output: bool
    retention_days: int
    version: int
    updated_by: uuid.UUID | None
    team_ids: list[uuid.UUID] = Field(default_factory=list)
    key_ids: list[str] = Field(default_factory=list)
    team_states: dict[str, bool] = Field(default_factory=dict)
    key_states: dict[str, bool | None] = Field(default_factory=dict)
    effective_summary: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class TeamRef(BaseModel):
    id: uuid.UUID
    name: str


class LogMeta(BaseModel):
    id: uuid.UUID
    workspace_type: str
    user_id: uuid.UUID | None
    org_id: uuid.UUID | None
    api_key_id: uuid.UUID | None
    key_provenance: str
    team_ids: list[str] = Field(default_factory=list)
    match_source: str | None = None
    conversation_id: uuid.UUID | None
    provider_id: uuid.UUID | None
    model_id: uuid.UUID | None
    endpoint: str
    source: str
    request_id: str | None
    generation_id: uuid.UUID | None
    status: str
    input_chars: int
    output_chars: int
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: float | None
    error_code: str | None
    policy_version: int
    content_expired: bool
    input_truncated: bool = False
    output_truncated: bool = False
    created_at: datetime
    expires_at: datetime
    # Derived conveniences (B2): captured-body flags, latency alias, and the
    # wall-clock completion instant (created_at + latency when known).
    fields: list[str] = Field(default_factory=list)
    duration_ms: int | None = None
    completed_at: datetime | None = None
    key_name: str | None = None
    user_email: str | None = None
    provider_name: str | None = None
    model_name: str | None = None


class LogList(BaseModel):
    """Canonical GET /logs response envelope (B1). The X-Next-Cursor response
    header still carries the cursor; frontends tolerate both."""

    items: list[LogMeta] = Field(default_factory=list)


class LogDetail(LogMeta):
    input_text: str | None = None
    output_text: str | None = None
    content_restricted: bool = False


class PurgeRequest(BaseModel):
    before: datetime | None = None


class PurgeResult(BaseModel):
    expired_count: int


class RetentionRead(BaseModel):
    default_days: int = 90
    effective_days: int = 90
    next_run: datetime
    # Async capture queue health (WS2): depth gauge + last worker error.
    queue_depth: int = 0
    last_error: str | None = None
