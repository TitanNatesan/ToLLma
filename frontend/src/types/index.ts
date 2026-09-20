export interface HealthResponse {
  status: string;
  database?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  email_verified: boolean;
  auth_provider: "EMAIL" | "GOOGLE";
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

export interface DiscoveredModelInfo {
  model_id: string;
  name: string;
  endpoint_type: string;
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
  status?: MessageStatus | null;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
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
  generation_id?: string;
  status?: MessageStatus | null;
  content?: string;
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
  context_window: number | null;
  max_output_tokens: number | null;
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

