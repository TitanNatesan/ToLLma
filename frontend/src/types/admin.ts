/**
 * Platform admin API types.
 *
 * Mirrors `backend/src/tollms/api/admin/schemas.py` exactly. Every payload is
 * aggregated — counts, tokens, costs, latencies, names and statuses only; the
 * admin API never carries message content, prompts or credentials. Decimal
 * fields arrive as strings (Pydantic JSON), so charts convert at the boundary.
 */

/** Query-selector range presets accepted by every `/api/admin/*` endpoint. */
export type AdminPreset = "last_7d" | "last_30d" | "last_90d" | "this_month" | "today";

/** Bucket size for trend series (the console pins `day`). */
export type AdminGranularity = "hour" | "day" | "week" | "month";

/** Shared query for every admin analytics endpoint. */
export interface AdminQueryParams {
  preset: AdminPreset;
  /** IANA timezone; the console pins UTC for deterministic buckets. */
  timezone: string;
  granularity?: AdminGranularity;
  limit?: number;
  search?: string;
}

export interface AdminRange {
  preset: string;
  timezone: string;
  start: string;
  end: string;
  prev_start: string;
  prev_end: string;
}

/** One KPI with its preceding-period comparison. */
export interface AdminKpi {
  value: string;
  previous: string;
  change_pct: number | null;
}

export interface AdminTrendPoint {
  bucket: string;
  requests: number;
  total_tokens: number;
  total_cost: string;
  errors: number;
  cache_read_tokens: number;
}

export interface AdminModelRow {
  model_id: string | null;
  model_name: string;
  provider_name: string | null;
  requests: number;
  total_tokens: number;
  total_cost: string;
  cache_read_tokens: number;
  error_rate: number;
  avg_latency_ms: number | null;
}

export interface AdminProviderRow {
  provider_id: string | null;
  provider_name: string;
  provider_type: string | null;
  requests: number;
  total_tokens: number;
  total_cost: string;
  error_rate: number;
  avg_latency_ms: number | null;
}

export interface AdminUserRow {
  user_id: string | null;
  email: string | null;
  requests: number;
  total_tokens: number;
  total_cost: string;
  conversations: number;
  cache_read_tokens: number;
  last_active_at: string | null;
}

export interface AdminCostPoint {
  bucket: string;
  total_cost: string;
  input_cost: string;
  output_cost: string;
  cache_read_cost: string;
  cache_write_cost: string;
  reasoning_cost: string;
}

export interface AdminTokenPoint {
  bucket: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
}

export interface AdminCacheRow {
  key: string | null;
  name: string;
  requests: number;
  cached_tokens: number;
  cache_write_tokens: number;
  cache_read_cost: string;
  cache_write_cost: string;
  savings: string;
  hit_rate: number;
  supports_caching: boolean;
}

export interface AdminMediaRow {
  model_id: string | null;
  model_name: string;
  kind: string;
  count: number;
  media_bytes: number;
  cost: string;
}

export interface AdminMediaPoint {
  bucket: string;
  images: number;
  videos: number;
  media_bytes: number;
  cost: string;
}

export interface AdminErrorRow {
  error_code: string;
  status: string;
  provider_name: string | null;
  model_name: string | null;
  count: number;
  last_seen_at: string | null;
}

export interface AdminHealthCheck {
  name: string;
  /** ok | degraded | down */
  status: string;
  latency_ms: number | null;
  detail: string | null;
}

export interface AdminHealthSummary {
  status: string;
  database: string;
  cache: string;
  active_generations: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  error_rate_1h: number;
}

// --- Endpoint payloads ------------------------------------------------------

export interface AdminDashboard {
  range: AdminRange;
  generated_at: string;
  requests: AdminKpi;
  active_users: AdminKpi;
  total_tokens: AdminKpi;
  total_cost: AdminKpi;
  cache_savings: AdminKpi;
  error_rate: AdminKpi;
  images: AdminKpi;
  videos: AdminKpi;
  spend_series: AdminTrendPoint[];
  token_series: AdminTokenPoint[];
  top_models: AdminModelRow[];
  top_providers: AdminProviderRow[];
  recent_errors: AdminErrorRow[];
  health: AdminHealthSummary;
}

export interface AdminUsage {
  range: AdminRange;
  requests: number;
  failed_requests: number;
  active_users: number;
  new_users: number;
  conversations: number;
  total_tokens: number;
  total_cost: string;
  series: AdminTrendPoint[];
  by_model: AdminModelRow[];
  by_provider: AdminProviderRow[];
}

export interface AdminModels {
  range: AdminRange;
  rows: AdminModelRow[];
}

export interface AdminProviders {
  range: AdminRange;
  rows: AdminProviderRow[];
}

export interface AdminUsers {
  range: AdminRange;
  total_users: number;
  active_users: number;
  new_users: number;
  rows: AdminUserRow[];
}

export interface AdminCosts {
  range: AdminRange;
  total_cost: string;
  previous_cost: string;
  change_pct: number | null;
  projected_month_cost: string;
  input_cost: string;
  output_cost: string;
  cache_cost: string;
  reasoning_cost: string;
  cache_savings: string;
  estimated_share: number;
  series: AdminCostPoint[];
  by_model: AdminModelRow[];
  by_provider: AdminProviderRow[];
  top_users: AdminUserRow[];
}

export interface AdminTokens {
  range: AdminRange;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cached_share: number;
  series: AdminTokenPoint[];
  by_model: AdminModelRow[];
}

export interface AdminCache {
  range: AdminRange;
  cached_tokens: number;
  cache_write_tokens: number;
  cache_read_cost: string;
  cache_write_cost: string;
  savings: string;
  hit_rate: number;
  providers_with_cache: number;
  by_provider: AdminCacheRow[];
  by_model: AdminCacheRow[];
}

export interface AdminMedia {
  range: AdminRange;
  images: number;
  videos: number;
  media_bytes: number;
  image_cost: string;
  video_cost: string;
  series: AdminMediaPoint[];
  by_model: AdminMediaRow[];
  by_kind: AdminMediaRow[];
}

export interface AdminErrors {
  range: AdminRange;
  failed_requests: number;
  cancelled_requests: number;
  error_rate: number;
  by_code: AdminErrorRow[];
  by_model: AdminErrorRow[];
  by_provider: AdminErrorRow[];
  series: AdminTrendPoint[];
}

export interface AdminHealth {
  range: AdminRange | null;
  status: string;
  checked_at: string;
  uptime_seconds: number | null;
  active_generations: number;
  error_rate_1h: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  checks: AdminHealthCheck[];
}

// --- Live health stream -----------------------------------------------------

/** Connection state of the admin health SSE stream. */
export type LiveHealthStreamStatus = "connecting" | "live" | "reconnecting" | "disconnected";

export interface LiveHealthServerStats {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  load_average: number;
}

export interface LiveHealthProcessStats {
  backend_uptime_seconds: number;
  active_requests: number;
  active_generations: number;
}

export interface LiveHealthDatabaseStats {
  /** ok | degraded | down */
  status: string;
  connections: number;
  latency_ms: number;
}

export interface LiveHealthCacheStats {
  /** ok | degraded | down */
  status: string;
  memory_mb: number;
}

export interface LiveHealthQueueStats {
  pending_jobs: number;
  running_jobs: number;
}

/**
 * One `GET /api/admin/health/stream` SSE event (JSON payload, ~every 2s).
 * Mirrors the frozen backend contract exactly.
 */
export interface LiveHealthSample {
  timestamp: string;
  server: LiveHealthServerStats;
  process: LiveHealthProcessStats;
  database: LiveHealthDatabaseStats;
  cache: LiveHealthCacheStats;
  queue: LiveHealthQueueStats;
}
