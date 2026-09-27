"""Platform admin API models. Aggregated data only.

Nothing in this module (or the services behind it) may carry message content,
prompts, responses, attachment bytes, or provider credentials — counts,
tokens, costs, latencies, names and statuses only.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class AdminRange(BaseModel):
    preset: str
    timezone: str
    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime


class AdminKpi(BaseModel):
    """One KPI with its preceding-period comparison."""

    value: Decimal
    previous: Decimal = Decimal(0)
    change_pct: float | None = None


class AdminTrendPoint(BaseModel):
    bucket: datetime
    requests: int = 0
    total_tokens: int = 0
    total_cost: Decimal = Decimal(0)
    errors: int = 0
    cache_read_tokens: int = 0


class AdminModelRow(BaseModel):
    model_id: uuid.UUID | None
    model_name: str
    provider_name: str | None = None
    requests: int
    total_tokens: int
    total_cost: Decimal
    cache_read_tokens: int = 0
    error_rate: float = 0.0
    avg_latency_ms: float | None = None


class AdminProviderRow(BaseModel):
    provider_id: uuid.UUID | None
    provider_name: str
    provider_type: str | None = None
    requests: int
    total_tokens: int
    total_cost: Decimal
    error_rate: float = 0.0
    avg_latency_ms: float | None = None
    validation_status: str = "unknown"
    validation_message: str | None = None
    last_validated_at: datetime | None = None


class AdminUserRow(BaseModel):
    user_id: uuid.UUID | None
    email: str | None = None
    requests: int
    total_tokens: int
    total_cost: Decimal
    conversations: int = 0
    cache_read_tokens: int = 0
    last_active_at: datetime | None = None


class AdminCostPoint(BaseModel):
    bucket: datetime
    total_cost: Decimal = Decimal(0)
    input_cost: Decimal = Decimal(0)
    output_cost: Decimal = Decimal(0)
    cache_read_cost: Decimal = Decimal(0)
    cache_write_cost: Decimal = Decimal(0)
    reasoning_cost: Decimal = Decimal(0)


class AdminTokenPoint(BaseModel):
    bucket: datetime
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0


class AdminCacheRow(BaseModel):
    key: uuid.UUID | None = None
    name: str
    requests: int = 0
    cached_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_cost: Decimal = Decimal(0)
    cache_write_cost: Decimal = Decimal(0)
    savings: Decimal = Decimal(0)
    hit_rate: float = 0.0
    supports_caching: bool = False


class AdminMediaRow(BaseModel):
    model_id: uuid.UUID | None = None
    model_name: str
    kind: str
    count: int
    media_bytes: int
    cost: Decimal = Decimal(0)


class AdminMediaPoint(BaseModel):
    bucket: datetime
    images: int = 0
    videos: int = 0
    media_bytes: int = 0
    cost: Decimal = Decimal(0)


class AdminErrorRow(BaseModel):
    error_code: str
    status: str
    provider_name: str | None = None
    model_name: str | None = None
    count: int
    last_seen_at: datetime | None = None


class AdminHealthCheck(BaseModel):
    name: str
    status: str  # ok | degraded | down
    latency_ms: float | None = None
    detail: str | None = None


# --- Endpoint payloads ------------------------------------------------------


class AdminDashboard(BaseModel):
    range: AdminRange
    generated_at: datetime
    requests: AdminKpi
    active_users: AdminKpi
    total_tokens: AdminKpi
    total_cost: AdminKpi
    cache_savings: AdminKpi
    error_rate: AdminKpi
    images: AdminKpi
    videos: AdminKpi
    spend_series: list[AdminTrendPoint] = Field(default_factory=list)
    token_series: list[AdminTokenPoint] = Field(default_factory=list)
    top_models: list[AdminModelRow] = Field(default_factory=list)
    top_providers: list[AdminProviderRow] = Field(default_factory=list)
    recent_errors: list[AdminErrorRow] = Field(default_factory=list)
    api_keys: "AdminApiKeys"
    health: "AdminHealthSummary"


class AdminHealthSummary(BaseModel):
    status: str
    database: str
    cache: str
    active_generations: int
    avg_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    error_rate_1h: float = 0.0


class AdminUsage(BaseModel):
    range: AdminRange
    requests: int
    failed_requests: int
    active_users: int
    new_users: int
    conversations: int
    total_tokens: int
    total_cost: Decimal
    series: list[AdminTrendPoint] = Field(default_factory=list)
    by_model: list[AdminModelRow] = Field(default_factory=list)
    by_provider: list[AdminProviderRow] = Field(default_factory=list)


class AdminModels(BaseModel):
    range: AdminRange
    rows: list[AdminModelRow] = Field(default_factory=list)


class AdminProviders(BaseModel):
    range: AdminRange
    rows: list[AdminProviderRow] = Field(default_factory=list)
    credential_health: dict[str, int] = Field(default_factory=dict)


class AdminUsers(BaseModel):
    range: AdminRange
    total_users: int
    active_users: int
    new_users: int
    rows: list[AdminUserRow] = Field(default_factory=list)


class AdminCosts(BaseModel):
    range: AdminRange
    total_cost: Decimal
    previous_cost: Decimal
    change_pct: float | None = None
    projected_month_cost: Decimal
    input_cost: Decimal = Decimal(0)
    output_cost: Decimal = Decimal(0)
    cache_cost: Decimal = Decimal(0)
    reasoning_cost: Decimal = Decimal(0)
    cache_savings: Decimal = Decimal(0)
    estimated_share: float = 0.0
    series: list[AdminCostPoint] = Field(default_factory=list)
    by_model: list[AdminModelRow] = Field(default_factory=list)
    by_provider: list[AdminProviderRow] = Field(default_factory=list)
    top_users: list[AdminUserRow] = Field(default_factory=list)


class AdminTokens(BaseModel):
    range: AdminRange
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    total_tokens: int
    cached_share: float = 0.0
    series: list[AdminTokenPoint] = Field(default_factory=list)
    by_model: list[AdminModelRow] = Field(default_factory=list)


class AdminCache(BaseModel):
    range: AdminRange
    cached_tokens: int
    cache_write_tokens: int
    cache_read_cost: Decimal
    cache_write_cost: Decimal
    savings: Decimal
    hit_rate: float = 0.0
    providers_with_cache: int = 0
    by_provider: list[AdminCacheRow] = Field(default_factory=list)
    by_model: list[AdminCacheRow] = Field(default_factory=list)


class AdminMedia(BaseModel):
    range: AdminRange
    images: int
    videos: int
    media_bytes: int
    image_cost: Decimal = Decimal(0)
    video_cost: Decimal = Decimal(0)
    series: list[AdminMediaPoint] = Field(default_factory=list)
    by_model: list[AdminMediaRow] = Field(default_factory=list)
    by_kind: list[AdminMediaRow] = Field(default_factory=list)


class AdminErrors(BaseModel):
    range: AdminRange
    failed_requests: int
    cancelled_requests: int
    error_rate: float = 0.0
    by_code: list[AdminErrorRow] = Field(default_factory=list)
    by_model: list[AdminErrorRow] = Field(default_factory=list)
    by_provider: list[AdminErrorRow] = Field(default_factory=list)
    series: list[AdminTrendPoint] = Field(default_factory=list)


class AdminHealth(BaseModel):
    range: AdminRange | None = None
    status: str
    checked_at: datetime
    uptime_seconds: float | None = None
    active_generations: int = 0
    error_rate_1h: float = 0.0
    avg_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    checks: list[AdminHealthCheck] = Field(default_factory=list)


class AdminLiveServer(BaseModel):
    """Host metrics sampled by psutil (CPU primed once, memory, disk, load)."""

    cpu_percent: float
    memory_percent: float
    memory_used_mb: int
    memory_total_mb: int
    disk_percent: float
    disk_used_gb: float
    disk_total_gb: float
    load_average: float


class AdminLiveProcess(BaseModel):
    """Backend process counters."""

    backend_uptime_seconds: float
    active_requests: int
    active_generations: int


class AdminLiveDatabase(BaseModel):
    """PostgreSQL probe. `latency_ms` is null when the probe fails."""

    status: str  # ok | down
    connections: int
    latency_ms: float | None = None


class AdminLiveCache(BaseModel):
    """Valkey probe: reachability plus `INFO memory` usage in MB."""

    status: str  # ok | degraded | down
    memory_mb: float


class AdminLiveQueue(BaseModel):
    """Generation queue depth.

    `running_jobs` counts local drivers; `pending_jobs` counts RUNNING
    assistant rows with no local driver (see `services/admin/live_health`).
    """

    pending_jobs: int
    running_jobs: int


class AdminLiveHealth(BaseModel):
    """One `GET /api/admin/health/stream` SSE frame (frozen contract)."""

    timestamp: str  # ISO-8601 UTC, e.g. 2026-09-24T17:20:00Z
    server: AdminLiveServer
    process: AdminLiveProcess
    database: AdminLiveDatabase
    cache: AdminLiveCache
    queue: AdminLiveQueue


class AdminAnalyticsRequest(BaseModel):
    """Shared query for every admin analytics endpoint."""

    preset: str = "last_7d"
    timezone: str = "UTC"
    start: date | None = None
    end: date | None = None
    granularity: str | None = None
    limit: int = Field(default=10, ge=1, le=50)
    search: str | None = Field(default=None, max_length=120)


# --- API keys ---------------------------------------------------------------


class AdminApiKeyUsageRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    requests: int = 0
    spend: Decimal = Decimal(0)
    tokens: int = 0


class AdminApiKeySpendRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    spend: Decimal = Decimal(0)
    share: float = 0.0


class AdminApiKeyErrorRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    errors: int = 0
    error_rate: float = 0.0


class AdminApiKeySavingsRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    savings: Decimal = Decimal(0)


class AdminApiKeyGrowthPoint(BaseModel):
    bucket: datetime
    created: int = 0


class AdminApiKeys(BaseModel):
    """Frozen API-key section for `/api/admin/api-keys` and the dashboard.

    Usage rows come from gateway traffic (`api_request_logs`); chat-traffic
    totals (`messages`) are a separate source and may differ.
    """

    range: AdminRange
    total: int = 0
    active: int = 0
    disabled: int = 0
    expired: int = 0
    rotated: int = 0
    top_keys: list[AdminApiKeyUsageRow] = Field(default_factory=list)
    spend_by_key: list[AdminApiKeySpendRow] = Field(default_factory=list)
    errors_by_key: list[AdminApiKeyErrorRow] = Field(default_factory=list)
    cache_savings_by_key: list[AdminApiKeySavingsRow] = Field(default_factory=list)
    growth: list[AdminApiKeyGrowthPoint] = Field(default_factory=list)


AdminDashboard.model_rebuild()
