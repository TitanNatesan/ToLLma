/** Organizations Phase A API client (thin fetch wrappers; react-query lives in hooks). */

import type {
  AuditEntry,
  Invitation,
  InvitePreview,
  Member,
  Notification,
  OrgAnalyticsOverview,
  OrgBudget,
  OrgCard,
  Organization,
  OrgKey,
  OrgKeyCreateInput,
  OrgKeySecretResponse,
  OrgProvider,
  OrgProviderCreateInput,
  PermissionGroup,
  PermissionSet,
  Team,
  TeamCreateInput,
} from "@/types/orgs";
import type { User } from "@/types";

const BASE = "/api/v1/orgs";
const NOTIF = "/api/v1/notifications";

import { apiRequest } from "@/services/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, init);
}

/** Append defined params as a query string; skips undefined/null/empty values. */
function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

/** Normalize list/detail shapes: array, or an enveloped {items|data|results|entries}. */
function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const key of ["items", "data", "results", "entries"]) {
      if (Array.isArray(rec[key])) return rec[key] as T[];
    }
  }
  return [];
}

export function permissionCatalog(): Promise<PermissionGroup[]> {
  return req<PermissionGroup[]>(`${BASE}/permissions/catalog`);
}

export function listOrgs(): Promise<Organization[]> {
  return req<Organization[]>(BASE);
}

export function searchOrgs(q: string): Promise<OrgCard[]> {
  return req<OrgCard[]>(`${BASE}/search?q=${encodeURIComponent(q)}`);
}

export function createOrg(payload: {
  name: string;
  description?: string;
  website?: string;
  industry?: string;
  location?: string;
  size?: string;
}): Promise<Organization> {
  return req<Organization>(BASE, { method: "POST", body: JSON.stringify(payload) });
}

export function getOrg(id: string): Promise<Organization> {
  return req<Organization>(`${BASE}/${id}`);
}

export function updateOrg(id: string, payload: Record<string, unknown>): Promise<Organization> {
  return req<Organization>(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export interface MemberQuery {
  search?: string;
  state?: string;
  limit?: number;
  offset?: number;
}

export async function listMembers(orgId: string, params?: MemberQuery): Promise<Member[]> {
  return asList<Member>(await req<unknown>(`${BASE}/${orgId}/members${qs(params ?? {})}`));
}

export function removeMember(orgId: string, userId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/members/${userId}`, { method: "DELETE" });
}

export function suspendMember(orgId: string, userId: string): Promise<Member> {
  return req<Member>(`${BASE}/${orgId}/members/${userId}/suspend`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function resumeMember(orgId: string, userId: string): Promise<Member> {
  return req<Member>(`${BASE}/${orgId}/members/${userId}/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function leaveOrg(orgId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/leave`, { method: "POST", body: JSON.stringify({}) });
}

export function assignSets(orgId: string, userId: string, setIds: string[]): Promise<Member> {
  return req<Member>(`${BASE}/${orgId}/members/${userId}/sets`, {
    method: "POST",
    body: JSON.stringify({ set_ids: setIds }),
  });
}

export interface SetQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listSets(orgId: string, params?: SetQuery): Promise<PermissionSet[]> {
  return asList<PermissionSet>(await req<unknown>(`${BASE}/${orgId}/sets${qs(params ?? {})}`));
}

export function createSet(orgId: string, payload: {
  name: string;
  description?: string;
  permissions: string[];
}): Promise<PermissionSet> {
  return req<PermissionSet>(`${BASE}/${orgId}/sets`, { method: "POST", body: JSON.stringify(payload) });
}

export function updateSet(orgId: string, setId: string, payload: Record<string, unknown>): Promise<PermissionSet> {
  return req<PermissionSet>(`${BASE}/${orgId}/sets/${setId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSet(orgId: string, setId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/sets/${setId}`, { method: "DELETE" });
}

export function cloneSet(orgId: string, setId: string, name: string): Promise<PermissionSet> {
  return req<PermissionSet>(`${BASE}/${orgId}/sets/${setId}/clone`, {
    method: "POST",
    body: JSON.stringify({ name, permissions: [] }),
  });
}

export function inviteUser(orgId: string, email: string, setIds: string[]): Promise<Invitation> {
  return req<Invitation>(`${BASE}/${orgId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, set_ids: setIds }),
  });
}

export interface InvitationQuery {
  status?: string;
  kind?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listInvitations(
  orgId: string,
  status?: string,
  params?: InvitationQuery,
): Promise<Invitation[]> {
  return asList<Invitation>(
    await req<unknown>(`${BASE}/${orgId}/invitations${qs({ status, ...(params ?? {}) })}`),
  );
}

export function cancelInvitation(orgId: string, invitationId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/invitations/${invitationId}`, { method: "DELETE" });
}

export function resendInvitation(orgId: string, invitationId: string): Promise<Invitation> {
  return req<Invitation>(`${BASE}/${orgId}/invitations/${invitationId}/resend`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function myInvitations(): Promise<Invitation[]> {
  return req<Invitation[]>(`${BASE}/invitations/mine`);
}

export function acceptInvitation(token: string): Promise<Organization> {
  return req<Organization>(`${BASE}/invitations/by-token/${token}/accept`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function rejectInvitation(token: string): Promise<void> {
  return req<void>(`${BASE}/invitations/by-token/${token}/reject`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function requestJoin(orgId: string): Promise<Invitation> {
  return req<Invitation>(`${BASE}/${orgId}/requests`, { method: "POST", body: JSON.stringify({}) });
}

export interface RequestQuery {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listRequests(orgId: string, params?: RequestQuery): Promise<Invitation[]> {
  return asList<Invitation>(await req<unknown>(`${BASE}/${orgId}/requests${qs(params ?? {})}`));
}

export function approveRequest(orgId: string, invitationId: string, setIds: string[]): Promise<Member> {
  return req<Member>(`${BASE}/${orgId}/requests/${invitationId}/approve`, {
    method: "POST",
    body: JSON.stringify({ set_ids: setIds }),
  });
}

export function rejectRequest(orgId: string, invitationId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/requests/${invitationId}/reject`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface AuditQuery {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export async function getAudit(orgId: string, limitOrQuery: number | AuditQuery = 100): Promise<AuditEntry[]> {
  const q = typeof limitOrQuery === "number" ? { limit: limitOrQuery } : limitOrQuery;
  return asList<AuditEntry>(await req<unknown>(`${BASE}/${orgId}/audit${qs(q)}`));
}

/** Cursor-paged audit read; tolerates enveloped ({entries,cursor}) or bare arrays. */
export async function getAuditPage(orgId: string, query: AuditQuery): Promise<AuditPage> {
  const payload = await req<unknown>(`${BASE}/${orgId}/audit${qs(query)}`);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    for (const key of ["entries", "items", "data", "results"]) {
      if (Array.isArray(rec[key])) {
        const next = rec.next_cursor ?? rec.nextCursor ?? rec.cursor ?? null;
        return { entries: rec[key] as AuditEntry[], nextCursor: typeof next === "string" ? next : null };
      }
    }
  }
  return { entries: asList<AuditEntry>(payload), nextCursor: null };
}

export function listNotifications(limit = 50): Promise<Notification[]> {
  return req<Notification[]>(`${NOTIF}?limit=${limit}`);
}

export function unreadCount(): Promise<{ unread: number }> {
  return req<{ unread: number }>(`${NOTIF}/unread-count`);
}

export function markNotificationRead(id: string): Promise<Notification> {
  return req<Notification>(`${NOTIF}/${id}/read`, { method: "POST", body: JSON.stringify({}) });
}

export function markAllNotificationsRead(): Promise<{ marked: number }> {
  return req<{ marked: number }>(`${NOTIF}/read-all`, { method: "POST", body: JSON.stringify({}) });
}

// --- Phase B: org API keys --------------------------------------------------

export interface OrgKeyQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listOrgKeys(orgId: string, params?: OrgKeyQuery): Promise<OrgKey[]> {
  return asList<OrgKey>(await req<unknown>(`${BASE}/${orgId}/keys${qs(params ?? {})}`));
}

export function createOrgKey(orgId: string, payload: OrgKeyCreateInput): Promise<OrgKeySecretResponse> {
  return req<OrgKeySecretResponse>(`${BASE}/${orgId}/keys`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeOrgKey(orgId: string, keyId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/keys/${keyId}`, { method: "DELETE" });
}

// --- Phase B: org providers -------------------------------------------------

export function listOrgProviders(orgId: string): Promise<OrgProvider[]> {
  return req<OrgProvider[]>(`${BASE}/${orgId}/providers`);
}

export function createOrgProvider(orgId: string, payload: OrgProviderCreateInput): Promise<OrgProvider> {
  return req<OrgProvider>(`${BASE}/${orgId}/providers`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Org register-with-models. Same body shape as personal register; org_id comes from the URL only.
 * NOTE: unlike personal register (RegisterResult envelope), the org endpoint
 * returns the provider read directly — single commit, so all models persist or nothing does. */
export function createOrgProviderWithModels(
  orgId: string,
  payload: OrgProviderCreateInput,
): Promise<OrgProvider> {
  return req<OrgProvider>(`${BASE}/${orgId}/providers/register`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteOrgProvider(orgId: string, providerId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/providers/${providerId}`, { method: "DELETE" });
}

export function updateOrgProvider(
  orgId: string,
  providerId: string,
  payload: Record<string, unknown>,
): Promise<OrgProvider> {
  return req<OrgProvider>(`${BASE}/${orgId}/providers/${providerId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// --- Phase B: org budget pools ----------------------------------------------

export function getOrgBudget(orgId: string): Promise<OrgBudget> {
  return req<OrgBudget>(`${BASE}/${orgId}/budget`);
}

export function updateOrgBudget(orgId: string, payload: Record<string, unknown>): Promise<OrgBudget> {
  return req<OrgBudget>(`${BASE}/${orgId}/budget`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// --- Phase B: org analytics -------------------------------------------------

export async function getOrgAnalyticsOverview(
  orgId: string,
  params?: import("@/types/orgs").OrgAnalyticsParams,
): Promise<OrgAnalyticsOverview> {
  return req<OrgAnalyticsOverview>(`${BASE}/${orgId}/analytics/overview${qs(params ?? {})}`);
}

// --- Phase B: public invitation preview (no auth required) -------------------

export function previewInvitation(token: string): Promise<InvitePreview> {
  return req<InvitePreview>(`${BASE}/invitations/preview/${encodeURIComponent(token)}`);
}

// --- Phase B: public invitation accept/reject with account creation (no auth) ---

/** POST .../accept-new response: login-shaped session plus the joined org. */
export interface InviteAcceptNewResponse {
  user: User;
  access_token?: string | null;
  refresh_token?: string | null;
  org_id: string;
}

export function acceptInvitationNew(
  token: string,
  payload: { full_name: string; password: string; email?: string },
): Promise<InviteAcceptNewResponse> {
  return req<InviteAcceptNewResponse>(
    `${BASE}/invitations/by-token/${encodeURIComponent(token)}/accept-new`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function rejectInvitationNew(token: string): Promise<{ status: string }> {
  return req<{ status: string }>(
    `${BASE}/invitations/by-token/${encodeURIComponent(token)}/reject-new`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

// --- Teams (parallel backend; callers treat 404 as denied-or-missing) --------

/** Normalize list/detail shapes: array, or an enveloped {teams|items|data}. */
function asTeamList(payload: unknown): Team[] {
  if (Array.isArray(payload)) return payload as Team[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const key of ["teams", "items", "data"]) {
      if (Array.isArray(rec[key])) return rec[key] as Team[];
    }
  }
  return [];
}

export interface TeamQuery {
  include?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listTeams(orgId: string, params?: TeamQuery): Promise<Team[]> {
  return asTeamList(await req<unknown>(`${BASE}/${orgId}/teams${qs(params ?? {})}`));
}

export function createTeam(orgId: string, payload: TeamCreateInput): Promise<Team> {
  return req<Team>(`${BASE}/${orgId}/teams`, { method: "POST", body: JSON.stringify(payload) });
}

export function getTeam(orgId: string, teamId: string): Promise<Team> {
  return req<Team>(`${BASE}/${orgId}/teams/${teamId}`);
}

export function updateTeam(orgId: string, teamId: string, payload: Record<string, unknown>): Promise<Team> {
  return req<Team>(`${BASE}/${orgId}/teams/${teamId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTeam(orgId: string, teamId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/teams/${teamId}`, { method: "DELETE" });
}

export function addTeamMember(orgId: string, teamId: string, userId: string): Promise<Team> {
  return req<Team>(`${BASE}/${orgId}/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function removeTeamMember(orgId: string, teamId: string, userId: string): Promise<void> {
  return req<void>(`${BASE}/${orgId}/teams/${teamId}/members/${userId}`, { method: "DELETE" });
}

export function replaceTeamSets(orgId: string, teamId: string, setIds: string[]): Promise<Team> {
  return req<Team>(`${BASE}/${orgId}/teams/${teamId}/sets`, {
    method: "PUT",
    body: JSON.stringify({ set_ids: setIds }),
  });
}
