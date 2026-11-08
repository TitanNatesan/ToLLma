import type {
  AIModel,
  ActiveGeneration,
  ConversationPath,
  ConversationTree,
  AnalyticsBreakdown,
  AnalyticsConversations,
  AnalyticsDataset,
  AnalyticsGranularity,
  AnalyticsHeatmap,
  AnalyticsModels,
  AnalyticsPerformance,
  AnalyticsRangeParams,
  AnalyticsSummary,
  ChatAttachment,
  ChatKey,
  ChatKeyModel,
  ChatKeyProblem,
  AnalyticsTimeseries,
  AnalyticsWidgets,
  AuthResponse,
  BranchInfo,
  BranchTree,
  ChatMessage,
  CompactResult,
  Conversation,
  ConversationShare,
  DiscoveryResult,
  DraftValidation,
  GenerationRun,
  HealthResponse,
  LoginSession,
  MappedModel,
  MessageEditResult,
  MessageHistory,
  ModelSort,
  Provider,
  PublicShare,
  RegisterResult,
  RepositoryLookup,
  RequestLogPage,
  SearchResponse,
  StreamDone,
  StreamMeta,
  UsageTotals,
  User,
  UserPreferences,
  ValidationResult,
} from "@/types";
import { getAccessToken, setStoredAccessToken, useAuthStore } from "@/store/auth";
import { useChatKeyStore } from "@/app/components/chat/chatKeyStore";

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

/**
 * Absolute backend URL for a relative API path. Use this when the raw
 * Response is needed (e.g. reading the `X-Next-Cursor` pagination header),
 * since apiRequest only returns the parsed body.
 */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export class ApiError extends Error {
  /** Seconds from the `Retry-After` header on 429s, when present. */
  public retryAfterSeconds: number | null;
  constructor(
    public status: number,
    public statusText: string,
    public data: unknown,
    message: string,
    retryAfterSeconds?: number | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}

/** Shared low-level request helper (auth headers, refresh-and-retry, envelope errors). */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return req<T>(path, init);
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
    if (res.status === 403 && path !== "/auth/me" && isEmailVerificationRequired(data)) {
      // Email just got verified elsewhere (or state went stale): refetch so the
      // verification banner clears on the next render. Fire-and-forget.
      void getCurrentUser().then(
        (u) => useAuthStore.getState().setUser(u),
        () => {},
      );
    }
    if (res.status === 403 && path !== "/auth/me" && isAccountPendingDeletion(data)) {
      // Deletion was scheduled mid-session (another tab/device): refetch so
      // the Shell hard gate takes over on the next render. Fire-and-forget —
      // same pattern as the verification 403→refetch above.
      void getCurrentUser().then(
        (u) => useAuthStore.getState().setUser(u),
        () => {},
      );
    }
    const method = init?.method ?? "GET";
    const retryAfterSeconds = parseRetryAfter(res);
    throw new ApiError(
      res.status,
      res.statusText,
      data,
      `${method} ${path} -> ${res.status} ${body.slice(0, 200)}`,
      retryAfterSeconds,
    );
  }
  return res.json() as Promise<T>;
}


/** Seconds from the `Retry-After` header (429s), when present. */
function parseRetryAfter(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header === null || header.trim() === "" || !Number.isFinite(Number(header))) return null;
  return Math.max(0, Math.ceil(Number(header)));
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
export interface ConversationPage {
  items: Conversation[];
  /** Opaque cursor for the next page; null when the backend has no more (or
   *  is an older shape without pagination — then the single page is all). */
  nextCursor: string | null;
}

function asConversationPage(payload: unknown): ConversationPage {
  if (Array.isArray(payload)) return { items: payload as Conversation[], nextCursor: null };
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const key of ["items", "conversations", "results", "data"]) {
      if (Array.isArray(rec[key])) {
        const next = rec.next_cursor ?? rec.nextCursor ?? rec.cursor ?? null;
        return { items: rec[key] as Conversation[], nextCursor: typeof next === "string" ? next : null };
      }
    }
  }
  return { items: [], nextCursor: null };
}

export const listConversations = (search?: string) =>
  get<Conversation[]>(`/api/v1/conversations${search ? `?search=${encodeURIComponent(search)}` : ""}`);

/** Cursor-paged conversation read. The next-page cursor travels the
 * `X-Next-Cursor` response header (falling back to a body cursor field),
 * so this stays a raw fetch: apiRequest only returns the parsed body.
 * Older backends ignore the params and return a bare array (single page). */
export const listConversationPage = async (
  search?: string,
  opts?: { limit?: number; cursor?: string; signal?: AbortSignal },
): Promise<ConversationPage> => {
  const q = new URLSearchParams();
  if (search) q.set("search", search);
  q.set("limit", String(opts?.limit ?? 20));
  if (opts?.cursor) q.set("cursor", opts.cursor);
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(`/api/v1/conversations?${q.toString()}`), {
    cache: "no-store",
    credentials: "include",
    headers,
    signal: opts?.signal,
  });
  const headerCursor = res.headers.get("X-Next-Cursor");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    throw new ApiError(res.status, res.statusText, data, `GET /api/v1/conversations -> ${res.status}`);
  }
  const payload: unknown = await res.json().catch(() => []);
  const page = asConversationPage(payload);
  return { items: page.items, nextCursor: headerCursor || page.nextCursor };
};
export const getConversation = (id: string) => get<Conversation>(`/api/v1/conversations/${id}`);
export const createConversation = (body: { title?: string; provider_id?: string | null; model_id?: string | null }) =>
  post<Conversation>("/api/v1/conversations", body);
export const renameConversation = (id: string, title: string) =>
  patch<Conversation>(`/api/v1/conversations/${id}`, { title });
export const pinConversation = (id: string, pinned: boolean) =>
  patch<Conversation>(`/api/v1/conversations/${id}/pin`, { pinned });
export const deleteConversation = (id: string) => del<void>(`/api/v1/conversations/${id}`);
export const getUsage = (id: string) => get<UsageTotals>(`/api/v1/conversations/${id}/usage`);

/** Manual compaction (spec 9 + 12.7). 200 carries the summary node id and
 *  token deltas; 422 = below the 20% threshold (message explains); 409 =
 *  a generation/compaction already owns the conversation; 404 = unknown id. */
export const compactConversation = (id: string) =>
  post<CompactResult>(`/api/v1/conversations/${id}/compact`, {});

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

/**
 * Multipart upload with real progress. XHR is the only browser transport that
 * exposes upload progress events; fetch does not. Cookies + bearer ride along
 * exactly like the fetch version it replaces.
 */
export function uploadChatAttachment(
  file: File,
  conversationId?: string | null,
  onProgress?: (fraction: number) => void,
): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (conversationId) form.append("conversation_id", conversationId);
  const token = getAccessToken();

  return new Promise<UploadedAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/api/v1/chat/attachments`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedAttachment);
        } catch {
          reject(new ApiError(xhr.status, xhr.statusText, xhr.responseText, `upload ${file.name}: invalid response`));
        }
        return;
      }
      reject(
        new ApiError(
          xhr.status,
          xhr.statusText,
          xhr.responseText,
          `upload ${file.name} -> ${xhr.status} ${xhr.responseText.slice(0, 200)}`,
        ),
      );
    };
    xhr.onerror = () => reject(new Error(`upload ${file.name} failed: network error`));
    xhr.onabort = () => reject(new Error(`upload ${file.name} aborted`));
    // No JSON Content-Type: the browser sets multipart boundaries.
    xhr.send(form);
  });
}

export function attachmentContentUrl(attachmentId: string): string {
  return `${apiBase()}/api/v1/chat/attachments/${attachmentId}/content`;
}

export async function streamChat(
  body: {
    provider_id: string;
    model_id: string;
    /** In-app generation key. Defaults to the composer's selected key. */
    key_id?: string | null;
    conversation_id?: string | null;
    message: string;
    reasoning_level?: string | null;
    attachment_ids?: string[];
    client_key?: string | null;
  },
  cb: StreamCallbacks,
): Promise<void> {
  // BYOK: every in-app generation carries the selected key. The composer owns
  // selection; injecting here (rather than in each caller) guarantees no send
  // path can submit a model without its key.
  const selectedKeyId = body.key_id ?? useChatKeyStore.getState().keyId;
  return postStream(
    "/api/v1/gateway/stream",
    selectedKeyId ? { ...body, key_id: selectedKeyId } : body,
    cb,
  );
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
    const failure = await readStreamFailure(res);
    if (failure.problem) useChatKeyStore.getState().flagProblem(failure.problem);
    cb.onError(failure.message);
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
        // Terminal frames carry the full content too — done MUST win over
        // content/snapshot, otherwise onDone (usage, toast, cleanup) never
        // fires and the stream just ends silently.
        if (event.done) cb.onDone(event as unknown as StreamDone);
        else if (typeof event.delta === "string") cb.onDelta(event.delta);
        else if (typeof event.content === "string") cb.onSnapshot?.(event.content);
        else if (typeof event.conversation_id === "string") cb.onMeta?.(event as unknown as StreamMeta);
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

export interface ResendVerificationResponse {
  sent: boolean;
  cooldown_seconds: number;
}

/** True when a parsed error body carries the email-verification gate code. */
export function isEmailVerificationRequired(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const code = (data as { error?: { code?: unknown } }).error?.code;
  return code === "EMAIL_VERIFICATION_REQUIRED";
}

/** Phase 7: true when a parsed error body carries the pending-deletion gate code. */
export function isAccountPendingDeletion(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const code = (data as { error?: { code?: unknown } }).error?.code;
  return code === "ACCOUNT_PENDING_DELETION";
}

/** Re-send the verification email. 429s surface via ApiError.retryAfterSeconds. */
export function resendVerificationEmail(): Promise<ResendVerificationResponse> {
  return post<ResendVerificationResponse>("/auth/resend-verification", {});
}

export function forgotPassword(email: string): Promise<{ success: boolean }> {
  return post<{ success: boolean }>("/auth/forgot-password", { email });
}

export function validateResetToken(token: string): Promise<{ valid: boolean; email: string | null }> {
  return get<{ valid: boolean; email: string | null }>(
    `/auth/reset-password/validate?token=${encodeURIComponent(token)}`,
  );
}

export function resetPassword(
  token: string,
  password: string,
): Promise<{ success: boolean; email: string; message: string }> {
  return post<{ success: boolean; email: string; message: string }>("/auth/reset-password", {
    token,
    password,
  });
}

export function googleLoginUrl(): string {
  return `${apiBase()}/auth/google/login`;
}

// --- settings ---------------------------------------------------------------

export const getPreferences = () => get<UserPreferences>("/api/v1/settings/preferences");
export const updatePreferences = (body: Partial<UserPreferences>) =>
  patch<UserPreferences>("/api/v1/settings/preferences", body);
export const updateProfile = (body: {
  full_name?: string | null;
  username?: string | null;
  email?: string;
  /**
   * Phase 6: email-change confirmation for local-with-password accounts.
   * Required by the backend when `email` differs (missing → 422).
   */
  current_password?: string;
  avatar_url?: string | null;
}) => patch<User>("/api/v1/settings/profile", body);
export const changePassword = (body: { current_password: string; new_password: string }) =>
  post<{ status: string; revoked_sessions: number }>("/api/v1/settings/password", body);
/**
 * Phase 4: Google-only accounts create their first local password.
 * 200 generic success; 409 when a password is already set; 422 on weak input.
 * The response carries no user, so callers must refetch /auth/me afterwards.
 */
export interface SetPasswordResult {
  status: string;
  message?: string;
}
export const setPassword = (body: { password: string }) =>
  post<SetPasswordResult>("/api/v1/settings/password/set", body);
export interface SessionsResponse {
  sessions: LoginSession[];
  total: number;
}
export const listSessions = () => get<SessionsResponse>("/api/v1/settings/sessions");
export const revokeSession = (sessionId: string) =>
  del<{ status: string; session_id: string }>(`/api/v1/settings/sessions/${sessionId}`);
export const revokeOtherSessions = () =>
  post<{ revoked: number }>("/api/v1/settings/sessions/revoke-others", {});

// --- Phase 7: account deletion ------------------------------------------------

export interface DeleteRequestResult {
  scheduled_for: string;
  days_remaining: number;
}

/**
 * Phase 7: schedule account deletion (15-day retention window).
 * 401 wrong password; 422 missing password (local-with-password accounts);
 * 403 when a passwordless account needs a fresh Google sign-in; 409 when
 * deletion is already pending. The response carries no user — callers must
 * refetch /auth/me afterwards so the Shell hard gate takes over.
 */
export const requestAccountDeletion = (body: { current_password?: string }) =>
  post<DeleteRequestResult>("/api/v1/settings/account/delete-request", body);

/**
 * Phase 7: cancel a pending deletion. 409 when nothing is pending.
 * Returns the restored user — callers set it into the auth store so the
 * hard gate clears.
 */
export const restoreAccount = (body: { current_password?: string }) =>
  post<User>("/auth/restore", body);

// --- analytics --------------------------------------------------------------

function analyticsQuery(params: AnalyticsRangeParams, extra?: Record<string, string | undefined>): string {
  const q = new URLSearchParams({ range: params.preset, tz: params.tz });
  if (params.preset === "custom") {
    if (params.start) q.set("start", params.start);
    if (params.end) q.set("end", params.end);
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) q.set(key, value);
  }
  return q.toString();
}

export const getAnalyticsSummary = (params: AnalyticsRangeParams) =>
  get<AnalyticsSummary>(`/api/v1/analytics/summary?${analyticsQuery(params)}`);
export const getAnalyticsTimeseries = (params: AnalyticsRangeParams, granularity?: AnalyticsGranularity) =>
  get<AnalyticsTimeseries>(`/api/v1/analytics/timeseries?${analyticsQuery(params, { granularity })}`);
export const getAnalyticsBreakdown = (params: AnalyticsRangeParams) =>
  get<AnalyticsBreakdown>(`/api/v1/analytics/breakdown?${analyticsQuery(params)}`);
export const getAnalyticsModels = (params: AnalyticsRangeParams, sort: ModelSort) =>
  get<AnalyticsModels>(`/api/v1/analytics/models?${analyticsQuery(params, { sort })}`);
export const getAnalyticsHeatmap = (params: AnalyticsRangeParams) =>
  get<AnalyticsHeatmap>(`/api/v1/analytics/heatmap?${analyticsQuery(params)}`);
export const getAnalyticsPerformance = (params: AnalyticsRangeParams) =>
  get<AnalyticsPerformance>(`/api/v1/analytics/performance?${analyticsQuery(params)}`);
export const getAnalyticsConversations = (params: AnalyticsRangeParams) =>
  get<AnalyticsConversations>(`/api/v1/analytics/conversations?${analyticsQuery(params)}`);
export const getAnalyticsWidgets = (params: AnalyticsRangeParams) =>
  get<AnalyticsWidgets>(`/api/v1/analytics/widgets?${analyticsQuery(params)}`);

/** Phase 10: truncation metadata on export responses. All fields optional —
 * older backends omit them (undefined → no notice, no crash). Blob exports
 * carry them via `X-Total-Count` / `X-Truncated` / `X-Exported-Count`
 * response headers; JSON bodies may also embed `total_count`/`truncated`. */
export interface ExportResult {
  total_count?: number;
  truncated?: boolean;
  exported_count?: number;
}

function parseCountHeader(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function parseTruncatedHeader(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/** Header channel for blob downloads (case-insensitive via Headers.get).
 * Backend emits `X-Export-Total-Count` / `X-Export-Truncated`; the shorter
 * aliases are accepted as fallback. */
function truncationFromHeaders(res: Response): ExportResult {
  const result: ExportResult = {};
  const total = parseCountHeader(
    res.headers.get("x-export-total-count") ?? res.headers.get("x-total-count"),
  );
  if (total !== undefined) result.total_count = total;
  const truncated = parseTruncatedHeader(
    res.headers.get("x-export-truncated") ?? res.headers.get("x-truncated"),
  );
  if (truncated !== undefined) result.truncated = truncated;
  const exported = parseCountHeader(
    res.headers.get("x-exported-count") ?? res.headers.get("x-exported"),
  );
  if (exported !== undefined) result.exported_count = exported;
  return result;
}

/**
 * JSON-body fallback: when the export itself is JSON, the backend may embed
 * truncation metadata (or a raw array whose length is the exported count).
 * Never throws; unknown shapes yield no metadata.
 */
async function truncationFromJsonBody(blob: Blob, known: ExportResult): Promise<ExportResult> {
  let data: unknown;
  try {
    data = JSON.parse(await blob.text());
  } catch {
    return known;
  }
  const out: ExportResult = { ...known };
  if (Array.isArray(data)) {
    out.exported_count ??= data.length;
    return out;
  }
  if (typeof data !== "object" || data === null) return out;
  const rec = data as Record<string, unknown>;
  if (out.total_count === undefined && typeof rec.total_count === "number") {
    out.total_count = Math.floor(rec.total_count);
  }
  if (out.truncated === undefined && typeof rec.truncated === "boolean") {
    out.truncated = rec.truncated;
  }
  if (out.exported_count === undefined) {
    const direct =
      typeof rec.exported_count === "number"
        ? rec.exported_count
        : typeof rec.count === "number"
          ? rec.count
          : undefined;
    if (direct !== undefined) {
      out.exported_count = Math.floor(direct);
    } else {
      for (const key of ["rows", "items", "data", "conversations"]) {
        if (Array.isArray(rec[key])) {
          out.exported_count = (rec[key] as unknown[]).length;
          break;
        }
      }
    }
  }
  return out;
}

async function exportResultFromResponse(res: Response, blob: Blob): Promise<ExportResult> {
  const fromHeaders = truncationFromHeaders(res);
  if (fromHeaders.truncated !== undefined && fromHeaders.total_count !== undefined) return fromHeaders;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return fromHeaders;
  return truncationFromJsonBody(blob, fromHeaders);
}

/**
 * Truncation notice text, or null when no notice applies (truncated is
 * falsy/absent). Counts degrade gracefully when the backend omits them.
 */
export function formatExportTruncationNotice(result: ExportResult | null | undefined): string | null {
  if (result?.truncated !== true) return null;
  const total = typeof result.total_count === "number" ? result.total_count : undefined;
  const exported = typeof result.exported_count === "number" ? result.exported_count : undefined;
  if (total !== undefined && exported !== undefined) {
    return `Exported ${exported} of ${total} rows (truncated) — only the first ${exported} were included`;
  }
  if (total !== undefined) {
    return `Exported subset of ${total} rows (truncated) — only the first rows were included`;
  }
  return "Export truncated — only the first rows were included";
}

/** Server-rendered export (CSV today, PDF-ready): fetch as a blob and download. */
export async function downloadAnalyticsExport(
  params: AnalyticsRangeParams,
  dataset: AnalyticsDataset,
  format: "csv" | "json" | "xlsx",
): Promise<ExportResult> {
  const url = `${apiBase()}/api/v1/analytics/export?${analyticsQuery(params, { dataset, format })}`;
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include", cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, res.statusText, null, `export failed (${res.status})`);
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = match?.[1] ?? `tollma-${dataset}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
  return exportResultFromResponse(res, blob);
}


// --- Phase B: conversation intelligence ------------------------------------

export const searchConversations = (
  query: string,
  filters: { providerId?: string; modelId?: string; start?: string; end?: string } = {},
) => {
  const q = new URLSearchParams({ q: query });
  if (filters.providerId) q.set("provider_id", filters.providerId);
  if (filters.modelId) q.set("model_id", filters.modelId);
  if (filters.start) q.set("start", filters.start);
  if (filters.end) q.set("end", filters.end);
  return get<SearchResponse>(`/api/v1/search?${q.toString()}`);
};

async function downloadFile(path: string, fallbackName: string): Promise<ExportResult> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { headers, credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try {
      data = JSON.parse(body);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, res.statusText, data, `download failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
  return exportResultFromResponse(res, blob);
}

export const exportConversation = (conversationId: string, format: "md" | "json" | "pdf") =>
  downloadFile(`/api/v1/exports/conversations/${conversationId}?format=${format}`, `conversation.${format}`);

export async function exportConversations(payload: {
  conversation_ids?: string[];
  all?: boolean;
  format: "md" | "json" | "pdf";
}): Promise<ExportResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}/api/v1/exports/conversations`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try {
      data = JSON.parse(body);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, res.statusText, data, `export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = match?.[1] ?? `tollma-conversations.${payload.format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
  return exportResultFromResponse(res, blob);
}

export const getMessageHistory = (messageId: string) =>
  get<MessageHistory>(`/api/v1/messages/${messageId}/history`);
/**
 * BYOK: edits and regenerations carry the composer's selected key (same gate
 * as chat send — see streamChat). Resolves from the chat key store unless an
 * explicit id is passed. With no key selected the request never fires: the
 * key-required notice goes up and the thrown 422 flows through the callers'
 * existing toastApiError handling.
 */
function requireChatKeyId(explicit?: string | null): string {
  const keyId = explicit ?? useChatKeyStore.getState().keyId;
  if (keyId) return keyId;
  useChatKeyStore.getState().flagProblem("key-required");
  throw new ApiError(
    422,
    "Unprocessable Entity",
    {
      error: {
        code: "KEY_REQUIRED",
        message: "Select an API key above first — edits and regenerations carry the selected key.",
        retryable: false,
      },
    },
    "edit/regenerate without a selected chat key",
  );
}
export const editMessage = (messageId: string, content: string, keyId?: string | null) =>
  patch<MessageEditResult>(
    `/api/v1/messages/${messageId}?key_id=${encodeURIComponent(requireChatKeyId(keyId))}`,
    { content },
  );
export const regenerateMessage = (messageId: string, keyId?: string | null) =>
  post<{ conversation_id: string; generation_id: string; message_id: string; status: string }>(
    `/api/v1/messages/${messageId}/regenerate`,
    { key_id: requireChatKeyId(keyId) },
  );
export const activateGeneration = (messageId: string, runId: string) =>
  post<{ message: ChatMessage; run: GenerationRun }>(
    `/api/v1/messages/${messageId}/generations/${runId}/activate`,
    {},
  );
export const createBranch = (conversationId: string, messageId: string, branchName?: string) =>
  post<BranchInfo>(`/api/v1/conversations/${conversationId}/branches`, {
    message_id: messageId,
    branch_name: branchName ?? null,
  });
export const getBranchTree = (conversationId: string) =>
  get<BranchTree>(`/api/v1/conversations/${conversationId}/branches`);

// --- Message-level branching (spec sections 7-10 contract) ------------------
// One-file switch: every tree/path/select read lives here, so pointing the UI
// at a mock adapter (or back) means editing only these functions.
export const getConversationTree = (conversationId: string) =>
  get<ConversationTree>(`/api/v1/conversations/${conversationId}/tree`);
export const getConversationPath = (conversationId: string) =>
  get<ConversationPath>(`/api/v1/conversations/${conversationId}/path`);
export const selectConversationBranch = (conversationId: string, messageId: string) =>
  post<ConversationPath>(`/api/v1/conversations/${conversationId}/select`, {
    message_id: messageId,
  });
export const getMessageSiblings = (messageId: string) =>
  get<ChatMessage[]>(`/api/v1/messages/${messageId}/siblings`);
export const getMessageChildren = (messageId: string) =>
  get<ChatMessage[]>(`/api/v1/messages/${messageId}/children`);

export const listShares = (conversationId: string) =>
  get<ConversationShare[]>(`/api/v1/shares?conversation_id=${conversationId}`);
export const createShare = (conversationId: string, expiresInHours?: number) =>
  post<ConversationShare>("/api/v1/shares", {
    conversation_id: conversationId,
    expires_in_hours: expiresInHours ?? null,
  });
export const disableShare = (shareId: string) => del<ConversationShare>(`/api/v1/shares/${shareId}`);
export const regenerateShare = (shareId: string) =>
  post<ConversationShare>(`/api/v1/shares/${shareId}/regenerate`, {});
export const getPublicShare = (token: string) => get<PublicShare>(`/api/v1/shares/public/${token}`);

export const getRequestLogs = (params: { conversationId?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.conversationId) q.set("conversation_id", params.conversationId);
  if (params.limit) q.set("limit", String(params.limit));
  return get<RequestLogPage>(`/api/v1/request-logs?${q.toString()}`);
};

// --- Chat API keys (BYOK composer) -------------------------------------------

export const listChatKeys = () => get<ChatKey[]>("/api/v1/chat/keys");
export const listChatKeyModels = (keyId: string) =>
  get<ChatKeyModel[]>(`/api/v1/chat/models?key_id=${encodeURIComponent(keyId)}`);

/**
 * Classify gateway key denials from the error envelope so the composer can
 * refresh its lists and request re-selection. Key 404s read lowercase
 * `api key <id> not found` — distinct from `conversation ...` / `generation
 * ... not found`, which never classify here. Disabled/expired keys stay that
 * 404 oracle; budget, rate, and IP denials arrive as 403/429 carrying reason
 * strings (budget_exceeded, rate_limited/rpm/…, model_not_allowed,
 * ip_blocked). Matching is case-insensitive: the same reason can surface in
 * the envelope message or a raw string body.
 */
export function classifyChatKeyProblem(status: number, data: unknown): ChatKeyProblem | null {
  const raw = typeof data === "string" ? data : JSON.stringify(data ?? "");
  const text = raw.toLowerCase();
  if (status === 422 && text.includes("key_required")) return "key-required";
  if (status === 404 && /api key \S+ not found/.test(raw)) return "key-invalid";
  if (status === 403 || status === 429) {
    if (text.includes("model_not_allowed")) return "model-not-allowed";
    if (text.includes("ip_blocked")) return "ip-blocked";
    if (
      text.includes("budget") ||
      text.includes("spend") ||
      text.includes("overbudget") ||
      text.includes("over budget") ||
      text.includes("exhausted")
    ) {
      return "budget-exceeded";
    }
    if (
      status === 429 ||
      text.includes("rate_limited") ||
      text.includes("rate limited") ||
      text.includes("too many requests") ||
      /\b(rpm|rph|rpd|tpm|tpd|model_rpm|model_tpm)\b/.test(text)
    ) {
      return "rate-limited";
    }
  }
  return null;
}

export interface PolicyDenialCopy {
  problem: ChatKeyProblem;
  title: string;
  description: string;
  /** Show a "Manage API keys" recovery action alongside the message. */
  manageKeys: boolean;
}

/**
 * Friendly copy for unified gateway policy denials. One source of truth for
 * stream toasts and composer banners — raw reason strings never reach the UI.
 * Nothing is generated on denial, so every description says so.
 */
export function policyDenialCopy(
  problem: ChatKeyProblem,
  retryAfterSeconds?: number | null,
): PolicyDenialCopy {
  switch (problem) {
    case "key-required":
      return {
        problem,
        title: "An API key is required",
        description: "Select a model above — its API key is selected automatically.",
        manageKeys: false,
      };
    case "key-invalid":
      return {
        problem,
        title: "This API key is no longer valid",
        description:
          "It was revoked, disabled, expired, or your org access changed. Your key list was refreshed — pick another model to continue.",
        manageKeys: false,
      };
    case "model-not-allowed":
      return {
        problem,
        title: "That model isn't allowed for this key",
        description: "Pick another model to continue — your key is unchanged.",
        manageKeys: false,
      };
    case "budget-exceeded":
      return {
        problem,
        title: "Budget exhausted",
        description:
          "This API key hit its spending limit, so the request was blocked and nothing was generated. Raise the budget or pick another key.",
        manageKeys: true,
      };
    case "rate-limited":
      return {
        problem,
        title: "Rate limited",
        description:
          retryAfterSeconds != null
            ? `This key hit its request limit. Retry in about ${retryAfterSeconds}s — nothing was generated.`
            : "This key hit its request limit. Wait a moment and retry — nothing was generated.",
        manageKeys: false,
      };
    case "ip-blocked":
      return {
        problem,
        title: "Blocked by IP rules",
        description:
          "Your current network isn't allowed by this key's IP rules, so the request was blocked. Update the allowlist or pick another key.",
        manageKeys: true,
      };
  }
}

/** Non-OK stream-setup response → user-facing message + optional key problem.
 *  Classified policy denials surface the friendly copy (never the raw reason
 *  string); anything else keeps the previous behavior. */
async function readStreamFailure(res: Response): Promise<{ message: string; problem: ChatKeyProblem | null }> {
  const retryAfterSeconds = parseRetryAfter(res);
  const fallback = `stream failed with ${res.status}`;
  const text = await res.text().catch(() => "");
  if (!text) return { message: fallback, problem: null };
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    return { message: `${fallback}: ${text.slice(0, 200)}`, problem: null };
  }
  const problem = classifyChatKeyProblem(res.status, data);
  if (problem) return { message: policyDenialCopy(problem, retryAfterSeconds).description, problem };
  const err = (data as { error?: { message?: unknown } })?.error;
  const message = typeof err?.message === "string" && err.message ? err.message : fallback;
  return { message, problem: null };
}
