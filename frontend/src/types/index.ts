export interface HealthResponse {
  status: string;
  database?: string;
}

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export type ProviderType =
  | "OPENAI_RESPONSES"
  | "OPENAI_CHAT"
  | "ANTHROPIC_MESSAGES"
  | "GEMINI"
  | "VERTEX_AI"
  | "BEDROCK_CONVERSE"
  | "CUSTOM";

export type EndpointType = "responses" | "chat_completions" | "messages" | "converse";

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

export interface DiscoveryResult {
  provider_id: string;
  discovered: string[];
  created: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  message: string;
  latency_ms: number;
}

export interface AIModel {
  id: string;
  provider_id: string;
  model_id: string;
  name: string;
  description: string | null;
  endpoint_type: EndpointType;
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
  supports_streaming: boolean;
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

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
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
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost?: { input_cost: string; output_cost: string; total_cost: string };
  usage_estimated?: boolean;
  latency_ms?: number;
  empty?: boolean;
}

export interface RepositoryModelItem {
  id: string;
  model_key: string;
  canonical_name: string;
  display_name: string | null;
  family: string | null;
  provider: string;
  provider_model_id: string;
  vendor: string | null;
  endpoint_type: string;
  description: string | null;
  documentation_url: string | null;
  release_date: string | null;
  is_active: boolean;
  is_deprecated: boolean;
  last_seen_at: string | null;
  sources: string[];
  supports_text_input: boolean;
  supports_text_output: boolean;
  supports_vision_input: boolean;
  supports_image_output: boolean;
  supports_audio_input: boolean;
  supports_audio_output: boolean;
  supports_video_input: boolean;
  supports_video_output: boolean;
  supports_reasoning: boolean;
  supports_tool_calling: boolean;
  supports_structured_output: boolean;
  supports_streaming: boolean;
  supports_embeddings: boolean;
  supports_prompt_caching: boolean;
  context_window: number | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  input_cost: string | null;
  output_cost: string | null;
  cache_read_cost: string | null;
  cache_write_cost: string | null;
  reasoning_cost: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RepositoryModelPage {
  items: RepositoryModelItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface LastSyncInfo {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  models_created: number;
  models_updated: number;
  models_deactivated: number;
  errors_count: number;
}

export interface RepositoryStats {
  total_models: number;
  active_models: number;
  deprecated_models: number;
  providers_count: number;
  by_provider: Record<string, number>;
  last_sync: LastSyncInfo | null;
}

export interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  models_created: number;
  models_updated: number;
  models_deactivated: number;
  errors_count: number;
  error_details: string[];
}

