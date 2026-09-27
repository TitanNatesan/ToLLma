/**
 * User API key types (`/api/v1/keys/*`).
 *
 * Mirrors `backend/src/tollms/api/keys/schemas.py`. Numeric fields that arrive
 * as Pydantic `Decimal` are typed `number | string` and coerced with
 * `Number(...)` at the UI boundary. Every limit is nullable: `null` means
 * "unlimited".
 */

/** JSON number tolerance: Pydantic serializes Decimal as a string. */
export type Numeric = number | string;

/** Derived key lifecycle state (enabled + expiry). */
export type ApiKeyStatus = "enabled" | "disabled" | "expired";

export type ApiKeyIpRuleType = "allow" | "deny";

export interface ApiKeyIpRule {
  id: string;
  type: ApiKeyIpRuleType;
  cidr: string;
}

export interface ApiKeyModelPermission {
  id: string;
  provider_id: string | null;
  model_id: string | null;
  enabled: boolean;
  max_budget: Numeric | null;
  rpm: number | null;
  tpm: number | null;
}

/** Per-key limits. All fields nullable = unlimited. */
export interface ApiKeyPolicy {
  id?: string;
  max_budget_usd: Numeric | null;
  budget_reset_days: number | null;
  expires_at?: string | null;
  rpm: number | null;
  rph: number | null;
  rpd: number | null;
  tpm: number | null;
  tpd: number | null;
  daily_spend_limit: Numeric | null;
  monthly_spend_limit: Numeric | null;
}

/** `KeyRead`: the key itself, never the secret. */
export interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  masked: string;
  enabled: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  rotation_count: number;
  created_at: string;
  updated_at: string;
  policy: ApiKeyPolicy | null;
  ip_rules: ApiKeyIpRule[];
  model_permissions: ApiKeyModelPermission[];
}

/** Create + rotate responses: the raw key is shown exactly once. */
export interface ApiKeySecretResponse {
  key: ApiKey;
  raw_key: string;
}

// --- write payloads ---------------------------------------------------------

export interface ApiKeyCreateInput {
  name: string;
  description?: string | null;
  expires_at?: string | null;
  /** Nested on create: the backend accepts the full configuration in one POST. */
  policy?: ApiKeyPolicyInput | null;
  ip_rules?: ApiKeyIpRuleInput[];
  model_permissions?: ApiKeyModelPermissionInput[];
}

/** PATCH body: metadata only (policy/IP/models have dedicated endpoints). */
export interface ApiKeyUpdateInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  expires_at?: string | null;
}

export interface ApiKeyPolicyInput {
  max_budget_usd?: number | null;
  budget_reset_days?: number | null;
  rpm?: number | null;
  rph?: number | null;
  rpd?: number | null;
  tpm?: number | null;
  tpd?: number | null;
  daily_spend_limit?: number | null;
  monthly_spend_limit?: number | null;
}

export interface ApiKeyIpRuleInput {
  type: ApiKeyIpRuleType;
  cidr: string;
}

export interface ApiKeyModelPermissionInput {
  provider_id?: string | null;
  model_id?: string | null;
  enabled?: boolean;
  max_budget?: number | null;
  rpm?: number | null;
  tpm?: number | null;
}

// --- analytics --------------------------------------------------------------

export type ApiKeyAnalyticsPreset =
  | "today"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  | "this_month";

export interface ApiKeyAnalyticsPoint {
  bucket: string;
  requests: number;
  tokens: number;
  cost: Numeric;
  errors: number;
}

export interface ApiKeyTopModel {
  model: string;
  requests: number;
  tokens: number;
  cost: Numeric;
}

export interface ApiKeyTopEndpoint {
  endpoint: string;
  requests: number;
  cost: Numeric;
}

export interface ApiKeyTopCountry {
  country: string;
  requests: number;
}

export interface ApiKeyAnalytics {
  /** Preset name echoed by the backend ("last_7d", …). */
  range: string;
  range_start: string;
  range_end: string;
  requests: number;
  tokens: number;
  cost: Numeric;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  /** Fraction of failed requests (0..1), not a percentage. */
  error_rate: number;
  series: ApiKeyAnalyticsPoint[];
  top_models: ApiKeyTopModel[];
  top_endpoints: ApiKeyTopEndpoint[];
  top_countries: ApiKeyTopCountry[];
}

// --- rich observability (`/api/analytics/api-keys/*`) -----------------------

/** Preset accepted by the rich analytics API. `custom` requires start + end. */
export type AnalyticsPreset = "24h" | "7d" | "30d" | "90d" | "custom";

/** Stacked-usage dimension for the timeseries endpoint. */
export type AnalyticsGroupBy = "model" | "provider" | "endpoint";

export interface AnalyticsRange {
  preset: string;
  start?: string | null;
  end?: string | null;
}

/** Key identity echoed by the analytics API (never the secret). */
export interface AnalyticsKeyRef {
  id?: string;
  name?: string | null;
  masked?: string | null;
  key_prefix?: string | null;
}

export interface AnalyticsRequestCounts {
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  timeout: number;
  retry: number;
  /** May arrive as a fraction (0..1) or a percentage (0..100). */
  success_rate?: Numeric | null;
  error_rate?: Numeric | null;
}

export interface AnalyticsPerformance {
  avg_latency_ms: number | null;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  slowest_ms: number | null;
  fastest_ms: number | null;
}

/** `most_expensive_request` may be a scalar cost or a small descriptor object. */
export interface AnalyticsExpensiveRequest {
  cost?: Numeric | null;
  model?: string | null;
  provider?: string | null;
  endpoint?: string | null;
  created_at?: string | null;
  request_id?: string | null;
}

export interface AnalyticsCost {
  total: Numeric;
  today: Numeric;
  last_7d: Numeric;
  last_30d: Numeric;
  projected_month: Numeric;
  /** Run-rate projection alias (same value); prefer with fallback to projected_month. */
  run_rate_projection?: Numeric;
  cost_per_request: Numeric;
  cost_per_token: Numeric;
  most_expensive_request: Numeric | AnalyticsExpensiveRequest | null;
}

export interface AnalyticsTokens {
  prompt: number;
  completion: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
  total: number;
  per_request: number;
}

export interface AnalyticsCacheProvider {
  provider: string;
  tokens_saved: number;
  money_saved: Numeric;
}

export interface AnalyticsCacheSavings {
  tokens_saved: number;
  money_saved: Numeric;
  by_provider: AnalyticsCacheProvider[];
}

export interface AnalyticsProviderRow {
  provider: string;
  requests: number;
  spend: Numeric;
  tokens: number;
  avg_latency_ms: number | null;
  /** May arrive as a fraction (0..1) or a percentage (0..100). */
  error_rate?: Numeric | null;
}

export interface AnalyticsModelRow {
  model: string;
  provider: string;
  requests: number;
  spend: Numeric;
  tokens: number;
  avg_latency_ms: number | null;
  /** May arrive as a fraction (0..1) or a percentage (0..100). */
  success_rate?: Numeric | null;
}

export interface AnalyticsEndpointRow {
  endpoint: string;
  requests: number;
  spend: Numeric;
  /** May arrive as a fraction (0..1) or a percentage (0..100). */
  share?: Numeric | null;
}

/** Free-form: known values include critical/warning/info/success/high/medium/low. */
export type AnalyticsInsightSeverity = string;

export interface AnalyticsInsight {
  id: string;
  severity: AnalyticsInsightSeverity;
  title: string;
  detail: string;
  metric?: string | null;
  /** Percent change; sign carries the direction. */
  delta_pct?: number | null;
  /** Share of the total, percent (values <= 1 are treated as fractions). */
  share_pct?: number | null;
}

export interface ApiKeyAnalyticsSummary {
  range: AnalyticsRange;
  key: AnalyticsKeyRef;
  requests: AnalyticsRequestCounts;
  performance: AnalyticsPerformance;
  cost: AnalyticsCost;
  tokens: AnalyticsTokens;
  cache_savings: AnalyticsCacheSavings;
  providers: AnalyticsProviderRow[];
  models: AnalyticsModelRow[];
  endpoints: AnalyticsEndpointRow[];
  insights: AnalyticsInsight[];
}

export interface ApiKeyTimeseriesPoint {
  bucket: string;
  requests: number;
  success: number;
  failed: number;
  cancelled: number;
  cost: Numeric;
  tokens: number;
}

/** Dynamic per-group columns (`bucket` + one key per model/provider/endpoint). */
export type ApiKeyTimeseriesStackedPoint = { bucket: string } & Record<string, string | number>;

export interface ApiKeyTimeseriesDualPoint {
  bucket: string;
  cost: Numeric;
  tokens: number;
}

export interface ApiKeyTimeseriesLatencyPoint {
  bucket: string;
  avg_latency_ms: number | null;
  p95_ms: number | null;
}

export interface ApiKeyTimeseries {
  range: AnalyticsRange;
  points: ApiKeyTimeseriesPoint[];
  stacked: ApiKeyTimeseriesStackedPoint[];
  dual: ApiKeyTimeseriesDualPoint[];
  latency: ApiKeyTimeseriesLatencyPoint[];
}

export interface ApiKeyNetworkIp {
  ip: string;
  requests: number;
  last_seen_at: string | null;
  blocked: boolean;
}

export interface ApiKeyNetworkLocation {
  country: string | null;
  city: string | null;
  region: string | null;
  requests: number;
}

export interface ApiKeyNetworkDevice {
  device_type: string | null;
  platform: string | null;
  browser: string | null;
  user_agent: string | null;
  requests: number;
}

export interface ApiKeyNetworkClient {
  client: string;
  sdk: string | null;
  requests: number;
  /** May arrive as a fraction (0..1) or a percentage (0..100). */
  share?: Numeric | null;
}

export interface ApiKeyNetwork {
  range: AnalyticsRange;
  unique_ips: number;
  blocked_ips: number;
  allowed_ips: number;
  new_ips: number;
  ips: ApiKeyNetworkIp[];
  locations: ApiKeyNetworkLocation[];
  devices: ApiKeyNetworkDevice[];
  clients: ApiKeyNetworkClient[];
}

export interface ApiKeyInsightsResponse {
  range: AnalyticsRange;
  insights: AnalyticsInsight[];
}

/** Shared query for every rich analytics endpoint. */
export interface ApiKeyAnalyticsQuery {
  preset: AnalyticsPreset;
  /** ISO date (YYYY-MM-DD); required when `preset` is `custom`. */
  start?: string;
  /** ISO date (YYYY-MM-DD); required when `preset` is `custom`. */
  end?: string;
}
