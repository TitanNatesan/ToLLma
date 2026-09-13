import type {
  AIModel,
  ChatMessage,
  Conversation,
  DiscoveryResult,
  DraftValidation,
  HealthResponse,
  MappedModel,
  Provider,
  RegisterResult,
  RepositoryLookup,
  RepositoryModelPage,
  RepositoryStats,
  ResyncResult,
  StreamDone,
  SyncRun,
  UsageTotals,
  ValidationResult,
} from "@/types";

// Server components resolve BACKEND_URL (service name); client components
// fall back to NEXT_PUBLIC_API_URL (host-mapped port for the browser).
function apiBase(): string {
  if (typeof window !== "undefined") {
    if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${apiBase()}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try {
      data = JSON.parse(body);
    } catch {
      // not JSON
    }
    const method = init?.method ?? "GET";
    throw new ApiError(
      res.status,
      res.statusText,
      data,
      `${method} ${path} -> ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => req<T>(path);
const post = <T,>(path: string, body: unknown) => req<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) => req<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T,>(path: string) => req<T>(path, { method: "DELETE" });

export function getLiveness(): Promise<HealthResponse> {
  return get<HealthResponse>("/health");
}

export function getReadiness(): Promise<HealthResponse> {
  return get<HealthResponse>("/health/ready");
}

// --- Providers ---
export const listProviders = () => get<Provider[]>("/api/v1/providers");
export const createProvider = (body: { name: string; provider_type: string; credentials: Record<string, unknown> }) =>
  post<Provider>("/api/v1/providers", body);
export const updateProvider = (id: string, body: Record<string, unknown>) => patch<Provider>(`/api/v1/providers/${id}`, body);
export const deleteProvider = (id: string) => del<void>(`/api/v1/providers/${id}`);
export const validateProvider = (id: string) => post<ValidationResult>(`/api/v1/providers/${id}/validate`, {});
export const discoverProviderModels = (id: string) => post<DiscoveryResult>(`/api/v1/providers/${id}/discover`, {});
export const draftValidateProvider = (body: { provider_type: string; credentials: Record<string, unknown> }) =>
  post<DraftValidation>("/api/v1/providers/draft-validate", body);
export const registerProvider = (body: Record<string, unknown>) => post<RegisterResult>("/api/v1/providers/register", body);

// --- Models ---
export const listModels = (params?: { provider_id?: string; search?: string; capability?: string }) => {
  const q = new URLSearchParams();
  if (params?.provider_id) q.set("provider_id", params.provider_id);
  if (params?.search) q.set("search", params.search);
  if (params?.capability) q.set("capability", params.capability);
  const s = q.toString();
  return get<AIModel[]>(`/api/v1/models${s ? `?${s}` : ""}`);
};
export const createModel = (body: Record<string, unknown>) => post<AIModel>("/api/v1/models", body);
export const updateModel = (id: string, body: Record<string, unknown>) => patch<AIModel>(`/api/v1/models/${id}`, body);
export const deleteModel = (id: string) => del<void>(`/api/v1/models/${id}`);
export const bulkUpdateModels = (ids: string[], changes: Record<string, unknown>) =>
  patch<{ updated: number }>("/api/v1/models/bulk", { ids, patch: changes });
export const resyncModel = (id: string, includePricing = false) =>
  post<ResyncResult>(`/api/v1/models/${id}/resync${includePricing ? "?include_pricing=true" : ""}`, {});
export const lookupRepositoryModel = (query: string, providerHint?: string) => {
  const q = new URLSearchParams({ query });
  if (providerHint) q.set("provider_hint", providerHint);
  return get<RepositoryLookup>(`/api/v1/model-repository/lookup?${q.toString()}`);
};
export const listRepositoryModels = (params?: {
  search?: string;
  provider?: string;
  capability?: string;
  active_only?: boolean;
  page?: number;
  page_size?: number;
}) => {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.provider) q.set("provider", params.provider);
  if (params?.capability) q.set("capability", params.capability);
  if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
  if (params?.page) q.set("page", String(params.page));
  if (params?.page_size) q.set("page_size", String(params.page_size));
  const s = q.toString();
  return get<RepositoryModelPage>(`/api/v1/model-repository/models${s ? `?${s}` : ""}`);
};
export const getRepositoryStats = () => get<RepositoryStats>("/api/v1/model-repository/stats");
export const syncRepository = () => post<SyncRun>("/api/v1/model-repository/sync", {});
export const getRepositorySyncHistory = (limit = 20) =>
  get<SyncRun[]>(`/api/v1/model-repository/sync-history?limit=${limit}`);
export const mapDiscoveredModels = (body: { provider_type?: string; base_url?: string; model_ids: string[] }) =>
  post<{ mapped: MappedModel[] }>("/api/v1/model-repository/map", body);

// --- Conversations ---
export const listConversations = (search?: string) =>
  get<Conversation[]>(`/api/v1/conversations${search ? `?search=${encodeURIComponent(search)}` : ""}`);
export const getConversation = (id: string) => get<Conversation>(`/api/v1/conversations/${id}`);
export const createConversation = (body: { title?: string; provider_id?: string | null; model_id?: string | null }) =>
  post<Conversation>("/api/v1/conversations", body);
export const renameConversation = (id: string, title: string) =>
  patch<Conversation>(`/api/v1/conversations/${id}`, { title });
export const pinConversation = (id: string, pinned: boolean) =>
  patch<Conversation>(`/api/v1/conversations/${id}/pin`, { pinned });
export const deleteConversation = (id: string) => del<void>(`/api/v1/conversations/${id}`);
export const getUsage = (id: string) => get<UsageTotals>(`/api/v1/conversations/${id}/usage`);

// --- Gateway streaming (client-side; ReadableStream for stop/abort support) ---
export interface StreamCallbacks {
  signal: AbortSignal;
  onMeta?: (conversationId: string) => void;
  onDelta: (text: string) => void;
  onDone: (done: StreamDone) => void;
  onError: (message: string) => void;
}

export async function streamChat(
  body: { provider_id: string; model_id: string; conversation_id?: string | null; message: string },
  cb: StreamCallbacks,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/gateway/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: cb.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : "request failed");
    return;
  }
  if (!res.ok || !res.body) {
    cb.onError(`stream failed with ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (typeof event.delta === "string") cb.onDelta(event.delta);
        else if (typeof event.conversation_id === "string") cb.onMeta?.(event.conversation_id);
        else if (event.done) cb.onDone(event as unknown as StreamDone);
        else if (typeof event.error === "string") cb.onError(event.error);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") cb.onError(e instanceof Error ? e.message : "stream failed");
  } finally {
    reader.releaseLock();
  }
}

export type { ChatMessage };
