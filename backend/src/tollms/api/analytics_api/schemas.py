"""Frozen `/api/analytics` response models (aggregates only, no content).

Every payload is built server-side from grouped SQL. Decimals serialize as
numbers, datetimes as ISO-8601; ``stacked`` points keep the flat
``{bucket, <group>: tokens}`` shape via extra fields. The admin-only platform
endpoint and the user-scoped per-key endpoints share the common sections here.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

InsightSeverity = Literal["info", "warning", "critical"]
GroupBy = Literal["model", "provider", "endpoint"]


class AnalyticsRange(BaseModel):
    preset: str
    timezone: str
    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime


class RequestsSection(BaseModel):
    total: int = 0
    success: int = 0
    failed: int = 0
    cancelled: int = 0
    success_rate: float = 0.0
    error_rate: float = 0.0
    # Documented approximations: error_code contains "timeout"; retry is the
    # count of repeated request ids inside the window (see services/analytics).
    timeout: int = 0
    retry: int = 0


class PerformanceSection(BaseModel):
    avg_latency_ms: float | None = None
    p50_ms: float | None = None
    p90_ms: float | None = None
    p95_ms: float | None = None
    p99_ms: float | None = None
    slowest_ms: float | None = None
    fastest_ms: float | None = None


class MostExpensiveRequest(BaseModel):
    cost: Decimal = Decimal(0)
    model: str | None = None
    provider: str | None = None
    endpoint: str | None = None
    latency_ms: float | None = None
    at: datetime | None = None


class CostSection(BaseModel):
    total: Decimal = Decimal(0)
    today: Decimal = Decimal(0)
    last_7d: Decimal = Decimal(0)
    last_30d: Decimal = Decimal(0)
    projected_month: Decimal = Decimal(0)
    # Alias of projected_month: linear run-rate extrapolation, not a
    # prediction (assumes the window daily spend continues unchanged).
    run_rate_projection: Decimal = Decimal(0)
    cost_per_request: Decimal = Decimal(0)
    cost_per_token: Decimal = Decimal(0)
    most_expensive_request: MostExpensiveRequest | None = None


class TokensSection(BaseModel):
    prompt: int = 0
    completion: int = 0
    reasoning: int = 0
    cache_read: int = 0
    cache_write: int = 0
    total: int = 0
    per_request: float = 0.0


class ProviderRow(BaseModel):
    provider: str
    requests: int = 0
    spend: Decimal = Decimal(0)
    tokens: int = 0
    avg_latency_ms: float | None = None
    error_rate: float = 0.0


class ModelRow(BaseModel):
    model: str
    provider: str
    requests: int = 0
    spend: Decimal = Decimal(0)
    tokens: int = 0
    avg_latency_ms: float | None = None
    success_rate: float = 0.0


class EndpointRow(BaseModel):
    endpoint: str
    requests: int = 0
    spend: Decimal = Decimal(0)
    share: float = 0.0


class KeysSection(BaseModel):
    total: int = 0
    active: int = 0
    disabled: int = 0
    expired: int = 0
    rotated: int = 0


class TopKeyRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    requests: int = 0
    spend: Decimal = Decimal(0)
    tokens: int = 0


class KeyGrowthPoint(BaseModel):
    bucket: datetime
    created: int = 0


class KeySpendRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    spend: Decimal = Decimal(0)
    share: float = 0.0


class KeyErrorRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    errors: int = 0
    error_rate: float = 0.0


class KeySavingsRow(BaseModel):
    key_id: uuid.UUID | None = None
    name: str
    savings: Decimal = Decimal(0)


class Insight(BaseModel):
    id: str
    severity: InsightSeverity = "info"
    title: str
    detail: str
    metric: str = ""
    delta_pct: float | None = None
    share_pct: float | None = None


class PlatformAnalytics(BaseModel):
    range: AnalyticsRange
    requests: RequestsSection
    performance: PerformanceSection
    cost: CostSection
    tokens: TokensSection
    providers: list[ProviderRow] = Field(default_factory=list)
    models: list[ModelRow] = Field(default_factory=list)
    endpoints: list[EndpointRow] = Field(default_factory=list)
    keys: KeysSection
    top_keys: list[TopKeyRow] = Field(default_factory=list)
    key_growth: list[KeyGrowthPoint] = Field(default_factory=list)
    key_spend: list[KeySpendRow] = Field(default_factory=list)
    key_errors: list[KeyErrorRow] = Field(default_factory=list)
    key_cache_savings: list[KeySavingsRow] = Field(default_factory=list)
    insights: list[Insight] = Field(default_factory=list)


class ApiKeyAnalyticsRow(BaseModel):
    key_id: uuid.UUID
    name: str
    key_prefix: str
    enabled: bool
    requests: int = 0
    success_rate: float = 0.0
    error_rate: float = 0.0
    spend: Decimal = Decimal(0)
    tokens: int = 0
    avg_latency_ms: float | None = None
    last_used_at: datetime | None = None


class ApiKeyListResponse(BaseModel):
    range: AnalyticsRange
    keys: list[ApiKeyAnalyticsRow] = Field(default_factory=list)


class ApiKeyMeta(BaseModel):
    key_id: uuid.UUID
    name: str
    key_prefix: str
    enabled: bool
    expires_at: datetime | None = None


class CacheProviderRow(BaseModel):
    provider: str
    tokens_saved: int = 0
    money_saved: Decimal = Decimal(0)


class CacheSavingsSection(BaseModel):
    tokens_saved: int = 0
    money_saved: Decimal = Decimal(0)
    by_provider: list[CacheProviderRow] = Field(default_factory=list)


class ApiKeyDetailResponse(BaseModel):
    range: AnalyticsRange
    key: ApiKeyMeta
    requests: RequestsSection
    performance: PerformanceSection
    cost: CostSection
    tokens: TokensSection
    cache_savings: CacheSavingsSection
    providers: list[ProviderRow] = Field(default_factory=list)
    models: list[ModelRow] = Field(default_factory=list)
    endpoints: list[EndpointRow] = Field(default_factory=list)
    insights: list[Insight] = Field(default_factory=list)


class TimeseriesPoint(BaseModel):
    bucket: datetime
    requests: int = 0
    success: int = 0
    failed: int = 0
    cancelled: int = 0
    cost: Decimal = Decimal(0)
    tokens: int = 0


class StackedPoint(BaseModel):
    """Flat stacked bucket; the grouping dimension arrives as an extra field."""

    model_config = ConfigDict(extra="allow")

    bucket: datetime


class DualPoint(BaseModel):
    bucket: datetime
    cost: Decimal = Decimal(0)
    tokens: int = 0


class LatencyPoint(BaseModel):
    bucket: datetime
    avg_latency_ms: float | None = None
    p95_ms: float | None = None


class TimeseriesResponse(BaseModel):
    range: AnalyticsRange
    points: list[TimeseriesPoint] = Field(default_factory=list)
    stacked: list[StackedPoint] = Field(default_factory=list)
    dual: list[DualPoint] = Field(default_factory=list)
    latency: list[LatencyPoint] = Field(default_factory=list)


class NetworkIpRow(BaseModel):
    ip: str
    requests: int = 0
    last_seen_at: datetime | None = None
    blocked: bool = False


class NetworkLocationRow(BaseModel):
    country: str | None = None
    city: str | None = None
    region: str | None = None
    requests: int = 0


class NetworkDeviceRow(BaseModel):
    device_type: str | None = None
    platform: str | None = None
    browser: str | None = None
    user_agent: str | None = None
    requests: int = 0


class NetworkClientRow(BaseModel):
    client: str
    sdk: str = "unknown"
    requests: int = 0
    share: float = 0.0


class NetworkResponse(BaseModel):
    range: AnalyticsRange
    unique_ips: int = 0
    blocked_ips: int = 0
    allowed_ips: int = 0
    new_ips: int = 0
    ips: list[NetworkIpRow] = Field(default_factory=list)
    locations: list[NetworkLocationRow] = Field(default_factory=list)
    devices: list[NetworkDeviceRow] = Field(default_factory=list)
    clients: list[NetworkClientRow] = Field(default_factory=list)


class InsightsResponse(BaseModel):
    range: AnalyticsRange
    insights: list[Insight] = Field(default_factory=list)
