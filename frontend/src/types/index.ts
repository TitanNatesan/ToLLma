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
  input_cost: string | null;
  output_cost: string | null;
  total_cost: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
}

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  input_cost: string;
  output_cost: string;
  total_cost: string;
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
