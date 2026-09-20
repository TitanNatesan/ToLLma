"""Analytics response models. Every value is computed server-side."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

AnalyticsPreset = Literal[
    "today", "yesterday", "last_7d", "last_30d", "this_month", "last_month", "last_90d", "custom"
]
Granularity = Literal["hour", "day", "week", "month"]
ModelSort = Literal["most_used", "most_expensive", "fastest", "slowest"]
ExportFormat = Literal["csv", "json"]
ExportDataset = Literal["summary", "timeseries", "models", "providers", "conversations"]
InsightSeverity = Literal["info", "positive", "warning"]


class AnalyticsRange(BaseModel):
    """Resolved period (UTC instants) plus the equal-length preceding period."""

    preset: str
    timezone: str
    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime


class KpiValue(BaseModel):
    value: Decimal | int | float
    previous: Decimal | int | float
    change_pct: float | None


class Insight(BaseModel):
    id: str
    title: str
    detail: str
    severity: InsightSeverity = "info"


class AnalyticsSummary(BaseModel):
    range: AnalyticsRange
    currency: str = "USD"
    total_spend: KpiValue
    total_requests: KpiValue
    total_tokens: KpiValue
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    active_models: int
    active_providers: int
    active_conversations: int
    avg_cost_per_request: Decimal
    avg_tokens_per_request: float
    avg_response_ms: float | None
    avg_ttfb_ms: float | None
    streaming_sessions: int
    failed_requests: int
    estimated_requests: int
    projected_month_spend: Decimal
    insights: list[Insight]


class TimeseriesPoint(BaseModel):
    # Local wall-clock bucket start (the range timezone), naive on the wire.
    bucket: datetime
    spend: Decimal
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    total_tokens: int
    requests: int
    avg_latency_ms: float | None


class AnalyticsTimeseries(BaseModel):
    range: AnalyticsRange
    granularity: str
    points: list[TimeseriesPoint]


class BreakdownRow(BaseModel):
    key: str
    name: str
    kind: str = ""
    requests: int
    spend: Decimal
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    avg_cost: Decimal
    avg_latency_ms: float | None
    avg_ttfb_ms: float | None
    error_rate: float
    share_pct: float


class AnalyticsBreakdown(BaseModel):
    range: AnalyticsRange
    by_provider: list[BreakdownRow]
    by_model: list[BreakdownRow]


class AnalyticsModels(BaseModel):
    range: AnalyticsRange
    sort: str
    models: list[BreakdownRow]


class HeatmapCell(BaseModel):
    day: int  # Postgres DOW: 0 = Sunday
    hour: int
    requests: int
    spend: Decimal
    tokens: int


class HeatmapPeak(BaseModel):
    day: int
    hour: int
    requests: int


class AnalyticsHeatmap(BaseModel):
    range: AnalyticsRange
    cells: list[HeatmapCell]
    max_requests: int
    peak: HeatmapPeak | None
    quiet: HeatmapPeak | None
    busiest_day: int | None


class LatencyRow(BaseModel):
    key: str
    name: str
    requests: int
    avg_latency_ms: float | None
    avg_ttfb_ms: float | None
    avg_response_chars: float | None
    error_rate: float


class AnalyticsPerformance(BaseModel):
    range: AnalyticsRange
    avg_ttfb_ms: float | None
    avg_completion_ms: float | None
    avg_stream_duration_ms: float | None
    avg_response_chars: float | None
    avg_thinking_ms: float | None
    # Tool invocations are not persisted yet; null means "not tracked" and the
    # UI says so instead of inventing a number.
    avg_tool_calls_per_request: float | None = None
    fastest_model: LatencyRow | None
    slowest_model: LatencyRow | None
    by_model: list[LatencyRow]
    by_provider: list[LatencyRow]


class ConversationAnalyticsRow(BaseModel):
    id: str
    title: str
    provider_name: str | None
    model_name: str | None
    messages: int
    user_messages: int
    spend: Decimal
    tokens: int
    max_context_tokens: int
    avg_latency_ms: float | None
    updated_at: datetime | None


class AnalyticsConversations(BaseModel):
    range: AnalyticsRange
    most_active: list[ConversationAnalyticsRow]
    longest: list[ConversationAnalyticsRow]
    most_expensive: list[ConversationAnalyticsRow]
    largest_context: list[ConversationAnalyticsRow]
    highest_tokens: list[ConversationAnalyticsRow]
