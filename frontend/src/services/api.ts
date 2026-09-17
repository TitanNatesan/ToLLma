import type {
  ActiveGeneration,
  AIModel,
  AuthResponse,
  ChatMessage,
  Conversation,
  DiscoveryResult,
  DraftValidation,
  HealthResponse,
  MappedModel,
  Provider,
  RegisterResult,
  RepositoryLookup,
  StreamDone,
  StreamMeta,
  UsageTotals,
  User,
  ValidationResult,
} from "@/types";
import { getAccessToken, setStoredAccessToken, useAuthStore } from "@/store/auth";

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

async function req<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${apiBase()}${path}`, {
    cache: "no-store",
    credentials: "include", // httpOnly session cookies
    ...init,
    headers,
  });
  if (res.status === 204) return undefined as T;
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    // Access token may have expired mid-session: one silent refresh, then retry.
    const refreshed = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    }).catch(() => null);
    if (refreshed?.ok) {
      const data = await refreshed.json().catch(() => null);
      if (data?.access_token) {
        setStoredAccessToken(data.access_token);
        useAuthStore.getState().setAccessToken(data.access_token);
      }
      return req<T>(path, init, false);
    }
    useAuthStore.getState().reset();
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") {
      useAuthStore.getState().reset();
    }
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
export const lookupRepositoryModel = (query: string, providerHint?: string) => {
  const q = new URLSearchParams({ query });
  if (providerHint) q.set("provider_hint", providerHint);
  return get<RepositoryLookup>(`/api/v1/model-repository/lookup?${q.toString()}`);
};
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
//
// The backend owns generation state. This client only renders progress:
// - POST /gateway/stream creates the generation; meta carries its ids.
// - GET /gateway/stream/{id} reattaches after refresh (snapshot + live).
// - POST /gateway/generations/{id}/cancel stops the provider stream.
export interface StreamCallbacks {
  signal: AbortSignal;
  onMeta?: (meta: StreamMeta) => void;
  onSnapshot?: (content: string) => void;
  onDelta: (text: string) => void;
  onDone: (done: StreamDone) => void;
  onError: (message: string) => void;
  /** 409: another generation owns the conversation — adopt it, don't reset. */
  onConflict?: () => void;
}

export interface UploadedAttachment {
  attachment_id: string;
  filename: string;
  mime_type: string;
  kind: string;
  size: number;
}

export async function uploadChatAttachment(file: File, conversationId?: string | null): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (conversationId) form.append("conversation_id", conversationId);
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // No JSON Content-Type: the browser sets multipart boundaries. Cookies ride along.
  const res = await fetch(`${apiBase()}/api/v1/chat/attachments`, {
    method: "POST",
    headers,
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, res.statusText, detail, `upload ${file.name} -> ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<UploadedAttachment>;
}

export function attachmentContentUrl(attachmentId: string): string {
  return `${apiBase()}/api/v1/chat/attachments/${attachmentId}/content`;
}

export async function streamChat(
  body: {
    provider_id: string;
    model_id: string;
    conversation_id?: string | null;
    message: string;
    reasoning_level?: string | null;
    attachment_ids?: string[];
    client_key?: string | null;
  },
  cb: StreamCallbacks,
): Promise<void> {
  return postStream("/api/v1/gateway/stream", body, cb);
}

/** Refresh recovery: reattach to a running generation (snapshot + live). */
export async function streamGeneration(generationId: string, cb: StreamCallbacks): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/gateway/stream/${generationId}`, {
      headers,
      signal: cb.signal,
      credentials: "include",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : "request failed");
    return;
  }
  await consumeStream(res, cb);
}

/** User stop: cancel the backend generation (partial text persists). */
export function cancelGeneration(generationId: string): Promise<{ generation_id: string; status: string }> {
  return post(`/api/v1/gateway/generations/${generationId}/cancel`, {});
}

/** Recovery lookup: the running generation for a conversation, if any. */
export async function getActiveGeneration(conversationId: string): Promise<ActiveGeneration | null> {
  try {
    return await get<ActiveGeneration>(`/api/v1/conversations/${conversationId}/active-generation`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Single-generation status (running or terminal), ownership-checked. */
export function getGeneration(generationId: string): Promise<ActiveGeneration> {
  return get<ActiveGeneration>(`/api/v1/gateway/generations/${generationId}`);
}

/** Idempotency recovery: the generation a client_key send created (if any). */
export async function getGenerationByClientKey(clientKey: string): Promise<ActiveGeneration | null> {
  try {
    return await get<ActiveGeneration>(
      `/api/v1/gateway/generations/by-client/${encodeURIComponent(clientKey)}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

async function postStream(path: string, body: unknown, cb: StreamCallbacks): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: cb.signal,
      credentials: "include",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cb.onError(e instanceof Error ? e.message : "request failed");
    return;
  }

  // Handle 401 session expiration mid-use with silent refresh and a single retry
  if (res.status === 401) {
    try {
      const refreshed = await fetch(`${apiBase()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      if (refreshed.ok) {
        const data = await refreshed.json().catch(() => null);
        if (data?.access_token) {
          setStoredAccessToken(data.access_token);
          useAuthStore.getState().setAccessToken(data.access_token);
          headers["Authorization"] = `Bearer ${data.access_token}`;
        }
        res = await fetch(`${apiBase()}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: cb.signal,
          credentials: "include",
        });
      }
    } catch {
      // refresh failed; fall through to error handling
    }
  }

  await consumeStream(res, cb);
}

async function consumeStream(res: Response, cb: StreamCallbacks): Promise<void> {
  if (res.status === 409) {
    // Another generation owns this conversation (double-clicked regenerate,
    // retried send). The caller adopts it — never a reset, never a duplicate.
    await res.text().catch(() => null);
    cb.onConflict?.();
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
        else if (typeof event.content === "string") cb.onSnapshot?.(event.content);
        else if (typeof event.conversation_id === "string") cb.onMeta?.(event as unknown as StreamMeta);
        else if (event.done) cb.onDone(event as unknown as StreamDone);
        else if (typeof event.error === "string" && !event.done) cb.onError(event.error);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") cb.onError(e instanceof Error ? e.message : "stream failed");
  } finally {
    reader.releaseLock();
  }
}

export type { ChatMessage };

// --- auth (dual mode: httpOnly session cookies + Bearer token fallback) ---

export async function signup(email: string, password: string, fullName?: string): Promise<AuthResponse> {
  const res = await post<AuthResponse>("/auth/signup", { email, password, full_name: fullName || null });
  if (res.access_token) {
    setStoredAccessToken(res.access_token);
    useAuthStore.getState().setAccessToken(res.access_token);
  }
  return res;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await post<AuthResponse>("/auth/login", { email, password });
  if (res.access_token) {
    setStoredAccessToken(res.access_token);
    useAuthStore.getState().setAccessToken(res.access_token);
  }
  return res;
}

export async function logout(): Promise<{ status: string }> {
  setStoredAccessToken(null);
  useAuthStore.getState().reset();
  return post<{ status: string }>("/auth/logout", {});
}

export function getCurrentUser(): Promise<User> {
  return get<User>("/auth/me");
}

export function verifyEmail(token: string, signal?: AbortSignal): Promise<{ user: User; message: string }> {
  return req<{ user: User; message: string }>(
    `/auth/verify?token=${encodeURIComponent(token)}`,
    signal ? { signal } : undefined,
  );
}

export function googleLoginUrl(): string {
  return `${apiBase()}/auth/google/login`;
}
