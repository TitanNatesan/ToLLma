export interface HealthResponse {
  status: string;
  database?: string;
}

/** Platform-wide role returned by `/auth/me`; gates the /admin console. */
export type PlatformRole = "user" | "platform_admin";

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  username?: string | null;
  email_verified: boolean;
  platform_role: PlatformRole;
  auth_provider: "EMAIL" | "GOOGLE";
  /** Auth identity: "local" shows password management, "google" does not. */
  provider: "local" | "google";
  /**
   * Pending email-change target. Set while a new address awaits confirmation;
   * null when nothing is pending. Optional: older /auth/me responses omit
   * it — readers must treat undefined as "unknown" and hide pending UI.
   */
  pending_email?: string | null;
  /**
   * Whether a local password exists. Optional: older /auth/me responses omit
   * it — readers must treat undefined as "unknown" and hide password surfaces.
   */
  has_password?: boolean;
  /**
   * Phase 7: pending account-deletion timestamps. Set while deletion is
   * scheduled; null when nothing is pending. Optional: older /auth/me
   * responses omit them — readers must treat undefined as "unknown" and hide
   * deletion UI (same tolerance pattern as pending_email/has_password).
   */
  deletion_requested_at?: string | null;
  deletion_scheduled_for?: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  access_token?: string | null;
  debug_verification_token?: string | null;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export type ProviderType =
  | "OPENAI"
  | "ANTHROPIC_MESSAGES"
  | "GEMINI"
  | "VERTEX_AI"
  | "BEDROCK_CONVERSE"
  | "CUSTOM";

/** Legacy endpoint enum, mirrored server-side from `primary_endpoint`. */
export type EndpointType =
  | "responses"
  | "chat_completions"
  | "messages"
  | "converse"
  | "embeddings"
  | "images_generations"
  | "audio_transcriptions"
  | "audio_speech";

export interface Provider {
  id: string;
  name: string;
  provider_type: ProviderType;
  credentials_masked: Record<string, string>;
  metadata: Record<string, unknown>;
  is_active: boolean;
  validation_status: "unknown" | "valid" | "invalid";
  validation_message: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredModelInfo {
  model_id: string;
  name: string;
  endpoint_type: string;
  primary_endpoint: string | null;
  supported_endpoints: string[];
  context_window: number | null;
  max_output_tokens: number | null;
  repository_model_key: string | null;
  match_type: MatchType;
  suggested: Record<string, string | number | boolean | null>;
  repository_match: Record<string, string | null>;
}

/** Refresh-models result: discovery cache summary. Nothing is registered. */
export interface DiscoveryResult {
  provider_id: string;
  discovered: DiscoveredModelInfo[];
  total: number;
  new_count: number;
  registered_count: number;
  last_discovery_at: string | null;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  message: string;
  latency_ms: number;
}

/** Models.dev reasoning control passthrough (backend frozen contract).
 *  Null when the model has none; absent in older responses — readers must
 *  treat undefined as unknown and hide reasoning UI (null-safe, never crash).
 *  Observed variants: {type:'effort', values:[...]}, {type:'budget_tokens',
 *  min, max?, default?}, {type:'toggle'}. Missing/null means unknown: never
 *  invent levels from this. */
export interface ReasoningOption {
  type: string;
  values?: string[];
  min?: number;
  max?: number;
  default?: string;
}

export interface AIModel {
  id: string;
  provider_id: string;
  model_id: string;
  name: string;
  description: string | null;
  endpoint_type: EndpointType;
  primary_endpoint: string | null;
  supported_endpoints: string[];
  input_price: string;
  output_price: string;
  cache_read_price: string;
  cache_write_price: string;
  supports_text: boolean;
  supports_vision: boolean;
  supports_audio_input: boolean;
  supports_audio_output: boolean;
  supports_image_generation: boolean;
  supports_tool_calling: boolean;
  supports_reasoning: boolean;
  supports_embeddings: boolean;
  supports_streaming: boolean;
  reasoning_options?: ReasoningOption[] | null;
  context_window: number | null;
  max_output_tokens: number | null;
  release_date: string | null;
  repository_model_key: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Role = "system" | "user" | "assistant";

export type MessageStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export interface ChatAttachment {
  id: string;
  filename: string;
  mime_type: string;
  kind: string;
  file_size: number;
  conversation_id: string | null;
  message_id: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  conversation_id?: string;
  /** Branching: null for roots; siblings share a parent. Additive — older backends omit. */
  parent_message_id?: string | null;
  /** 1-based position among same-parent messages. Additive — older backends omit. */
  version_number?: number | null;
  status?: MessageStatus | null;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  error_code?: string | null;
  generations?: GenerationRun[];
  active_generation_id?: string | null;
  versions_count?: number;
  /** Generation details for media messages (generation_type/status/model/...). */
  metadata?: Record<string, unknown>;
  /** True when tokens/cost were estimated because the provider reported none. */
  usage_estimated?: boolean;
  thinking_ms?: number | null;
  attachments?: ChatAttachment[];
  provider_id: string | null;
  model_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  input_cost: string | null;
  output_cost: string | null;
  total_cost: string | null;
  cache_read_cost: string | null;
  cache_write_cost: string | null;
  reasoning_cost: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  is_pinned: boolean;
  /** Live message count; 0 for abandoned/empty chats (hidden in the sidebar). */
  message_count?: number;
  provider_id: string | null;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
}

export interface UsageBreakdown {
  model_id?: string | null;
  provider_id?: string | null;
  model_name?: string;
  provider_name?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_cost: string;
}

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  input_cost: string;
  output_cost: string;
  total_cost: string;
  cache_read_cost: string;
  cache_write_cost: string;
  reasoning_cost: string;
  /** Net prompt-cache savings vs. full input price (estimated). */
  cache_savings?: string;
  by_model: UsageBreakdown[];
  by_provider: UsageBreakdown[];
}

export interface RepositoryLookup {
  entry: {
    model_key: string;
    display_name: string | null;
    provider: string;
    provider_model_id: string;
    description: string | null;
    context_window: number | null;
    input_cost: string | null;
    output_cost: string | null;
  };
  suggested: Record<string, string | number | boolean | null>;
}

export interface StreamDone {
  done: boolean;
  message_id?: string;
  generation_id?: string;
  status?: MessageStatus | null;
  content?: string;
  /** Generated media persisted alongside the message (absent on older backends). */
  attachments?: ChatAttachment[];
  error?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost?: { input_cost: string; output_cost: string; total_cost: string };
  usage_estimated?: boolean;
  latency_ms?: number;
  empty?: boolean;
}

export interface StreamMeta {
  conversation_id: string;
  generation_id?: string;
  message_id?: string;
  status?: MessageStatus | null;
}

export interface ActiveGeneration {
  generation_id: string;
  message_id: string;
  conversation_id: string;
  status: MessageStatus;
  current_content: string;
  started_at: string | null;
}

export type MatchType = "provider_specific" | "global" | "fallback";

export interface DraftDiscoveredModel {
  model_id: string;
  name: string;
  endpoint_type: string;
  primary_endpoint: string | null;
  supported_endpoints: string[];
  context_window: number | null;
  max_output_tokens: number | null;
  /** Draft-validate does not return repository suggestions yet; optional for forward compat. */
  suggested?: Record<string, string | number | boolean | null>;
}

export interface DraftValidation {
  valid: boolean;
  message: string;
  latency_ms: number;
  discovered: DraftDiscoveredModel[];
}

export interface MappedModel {
  model_id: string;
  match_type: MatchType;
  repository_model_key: string | null;
  suggested: Record<string, string | number | boolean | null>;
  repository_match: Record<string, string | null>;
}

export interface RegisterResult {
  provider: Provider;
  models_created: number;
  match_stats: Record<MatchType, number>;
}


// --- settings / analytics ---------------------------------------------------

export type AccentName = "green" | "blue" | "purple" | "orange" | "red" | "cyan" | "pink" | "custom";
export type EnterBehavior = "send" | "newline";

export interface UserPreferences {
  accent: AccentName;
  accent_color: string | null;
  enter_behavior: EnterBehavior;
  default_thinking_level: string | null;
  auto_scroll: boolean;
  stream_animations: boolean;
}

export interface LoginSession {
  id: string;
  current: boolean;
  device: string;
  browser: string;
  os: string;
  provider?: "local" | "google";
  location?: string | null;
  ip: string | null;
  login_method: string;
  created_at: string | null;
  last_seen: string | null;
  requests: number;
  tokens: number;
}

export type AnalyticsPreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "last_month"
  | "last_90d"
  | "custom";

export type AnalyticsGranularity = "hour" | "day" | "week" | "month";
export type ModelSort = "most_used" | "most_expensive" | "fastest" | "slowest";
export type AnalyticsDataset = "summary" | "timeseries" | "models" | "providers" | "conversations";

export interface AnalyticsRange {
  preset: string;
  timezone: string;
  start: string;
  end: string;
  prev_start: string;
  prev_end: string;
}

export interface KpiValue {
  value: string | number;
  previous: string | number;
  change_pct: number | null;
}

export interface AnalyticsInsight {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "positive" | "warning";
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  currency: string;
  total_spend: KpiValue;
  total_requests: KpiValue;
  total_tokens: KpiValue;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  active_models: number;
  active_providers: number;
  active_conversations: number;
  avg_cost_per_request: string;
  avg_tokens_per_request: number;
  avg_response_ms: number | null;
  avg_ttfb_ms: number | null;
  streaming_sessions: number;
  failed_requests: number;
  estimated_requests: number;
  projected_month_spend: string;
  /** Run-rate projection alias (same value); prefer with fallback to projected_month_spend. */
  run_rate_projection?: string;
  insights: AnalyticsInsight[];
}

export interface TimeseriesPoint {
  bucket: string;
  spend: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  requests: number;
  avg_latency_ms: number | null;
}

export interface AnalyticsTimeseries {
  range: AnalyticsRange;
  granularity: AnalyticsGranularity;
  points: TimeseriesPoint[];
}

export interface AnalyticsBreakdownRow {
  key: string;
  name: string;
  kind: string;
  requests: number;
  spend: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  avg_cost: string;
  avg_latency_ms: number | null;
  avg_ttfb_ms: number | null;
  error_rate: number;
  share_pct: number;
}

export interface AnalyticsBreakdown {
  range: AnalyticsRange;
  by_provider: AnalyticsBreakdownRow[];
  by_model: AnalyticsBreakdownRow[];
}

export interface AnalyticsModels {
  range: AnalyticsRange;
  sort: ModelSort;
  models: AnalyticsBreakdownRow[];
}

export interface HeatmapCell {
  day: number;
  hour: number;
  requests: number;
  spend: string;
  tokens: number;
}

export interface HeatmapPeak {
  day: number;
  hour: number;
  requests: number;
}

export interface AnalyticsHeatmap {
  range: AnalyticsRange;
  cells: HeatmapCell[];
  max_requests: number;
  peak: HeatmapPeak | null;
  quiet: HeatmapPeak | null;
  busiest_day: number | null;
}

export interface LatencyRow {
  key: string;
  name: string;
  requests: number;
  avg_latency_ms: number | null;
  avg_ttfb_ms: number | null;
  avg_response_chars: number | null;
  error_rate: number;
}

export interface AnalyticsPerformance {
  range: AnalyticsRange;
  avg_ttfb_ms: number | null;
  avg_completion_ms: number | null;
  avg_stream_duration_ms: number | null;
  avg_response_chars: number | null;
  avg_thinking_ms: number | null;
  avg_tool_calls_per_request: number | null;
  fastest_model: LatencyRow | null;
  slowest_model: LatencyRow | null;
  by_model: LatencyRow[];
  by_provider: LatencyRow[];
}

export interface ConversationAnalyticsRow {
  id: string;
  title: string;
  provider_name: string | null;
  model_name: string | null;
  messages: number;
  user_messages: number;
  spend: string;
  tokens: number;
  max_context_tokens: number;
  avg_latency_ms: number | null;
  updated_at: string | null;
}

export interface AnalyticsConversations {
  range: AnalyticsRange;
  most_active: ConversationAnalyticsRow[];
  longest: ConversationAnalyticsRow[];
  most_expensive: ConversationAnalyticsRow[];
  largest_context: ConversationAnalyticsRow[];
  highest_tokens: ConversationAnalyticsRow[];
}

export interface AnalyticsRangeParams {
  preset: AnalyticsPreset;
  tz: string;
  start?: string;
  end?: string;
}

// --- Phase B: conversation intelligence ------------------------------------

export interface SearchResult {
  conversation_id: string;
  conversation_title: string;
  message_id: string | null;
  role: string | null;
  kind: "conversation" | "message";
  snippet: string;
  provider_id: string | null;
  provider_name: string | null;
  model_id: string | null;
  model_name: string | null;
  created_at: string;
  rank: number;
}

export interface SearchGroupHit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  created_at: string | null;
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
  groups?: Record<string, SearchGroupHit[]>;
}

export interface MessageVersion {
  id: string;
  version_number: number;
  content: string;
  edited_by: string;
  created_at: string;
}

export interface GenerationRun {
  id: string;
  generation_number: number;
  provider_id: string | null;
  model_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  content: string;
  status: string;
  is_active: boolean;
  total_tokens: number | null;
  total_cost: string | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface MessageHistory {
  message_id: string;
  role: string;
  current_content: string;
  current_version: number;
  versions: MessageVersion[];
  generations: GenerationRun[];
  active_generation_id: string | null;
}

export interface MessageEditResult {
  message: ChatMessage;
  versions: MessageVersion[];
  current_version: number;
  regeneration_started: boolean;
  regenerating_message_id: string | null;
}

export interface ConversationShare {
  id: string;
  conversation_id: string;
  share_token: string;
  share_url: string;
  is_public: boolean;
  expires_at: string | null;
  view_count: number;
  created_at: string;
}

export interface PublicShareMessage {
  role: string;
  content: string;
  created_at: string;
  model_name: string | null;
}

export interface PublicShare {
  title: string;
  created_at: string;
  updated_at: string;
  model_name: string | null;
  provider_name: string | null;
  messages: PublicShareMessage[];
  view_count: number;
}

export interface BranchInfo {
  conversation_id: string;
  title: string;
  parent_conversation_id: string | null;
  branch_from_message_id: string | null;
  branch_name: string | null;
  message_count: number;
  created_at: string;
}

/** Message-level branch tree (spec sections 7-10 contract). */
export interface ConversationTreeNode {
  id: string;
  parent_message_id: string | null;
  role: string;
  version_number: number;
  status: string | null;
  created_at: string;
}

export interface ConversationTree {
  nodes: ConversationTreeNode[];
  active_leaf_id: string | null;
}

export interface ConversationPath {
  path: ChatMessage[];
  active_leaf_id: string | null;
}

export interface BranchTree {
  current: BranchInfo;
  parent: BranchInfo | null;
  siblings: BranchInfo[];
  children: BranchInfo[];
}

export interface RequestLogEntry {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  total_cost: string | null;
  status: string;
  error_code: string | null;
  is_regeneration: boolean;
  is_streaming: boolean;
  created_at: string;
}

export interface RequestLogPage {
  total: number;
  limit: number;
  offset: number;
  items: RequestLogEntry[];
}

export interface AnalyticsWidgets {
  regeneration_count: number;
  branch_count: number;
  shared_conversations: number;
  export_count: number;
  edit_count: number;
  most_regenerated: Array<{ conversation_id: string; title: string; regeneration_count: number }>;
  most_edited: Array<{
    message_id: string;
    conversation_id: string;
    conversation_title: string;
    version_count: number;
  }>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    timestamp: string;
  };
}

// --- Chat API keys (BYOK composer) -------------------------------------------
// Mirrors backend ChatKeyRead / ChatModelRead (GET /api/v1/chat/keys,
// GET /api/v1/chat/models). Never carries secrets or hashes.

export type ChatKeyScope = "personal" | "organization";

export interface ChatKey {
  id: string;
  name: string;
  scope: ChatKeyScope;
  org_id: string | null;
  org_name: string | null;
  enabled: boolean;
  model_count: number;
}

export type ChatKeyModel = AIModel;

/** Gateway key denials the composer must recover from (refresh + reselect). */
/** Gateway key denials the composer must recover from (refresh + reselect).
 *  Disabled/expired keys stay a 404 oracle (`key-invalid`); budget, rate,
 *  and IP denials arrive as 403/429 with reason strings. */
export type ChatKeyProblem =
  | "key-required"
  | "key-invalid"
  | "model-not-allowed"
  | "budget-exceeded"
  | "rate-limited"
  | "ip-blocked";
