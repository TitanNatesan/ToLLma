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
} from "@/types/orgs";
import type { User } from "@/types";

const BASE = "/api/v1/orgs";
const NOTIF = "/api/v1/notifications";

import { apiRequest } from "@/services/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, init);
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

export function listMembers(orgId: string): Promise<Member[]> {
  return req<Member[]>(`${BASE}/${orgId}/members`);
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

export function listSets(orgId: string): Promise<PermissionSet[]> {
  return req<PermissionSet[]>(`${BASE}/${orgId}/sets`);
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

export function listInvitations(orgId: string, status?: string): Promise<Invitation[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return req<Invitation[]>(`${BASE}/${orgId}/invitations${q}`);
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

export function listRequests(orgId: string): Promise<Invitation[]> {
  return req<Invitation[]>(`${BASE}/${orgId}/requests`);
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

export function getAudit(orgId: string, limit = 100): Promise<AuditEntry[]> {
  return req<AuditEntry[]>(`${BASE}/${orgId}/audit?limit=${limit}`);
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

export function listOrgKeys(orgId: string): Promise<OrgKey[]> {
  return req<OrgKey[]>(`${BASE}/${orgId}/keys`);
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

export function getOrgAnalyticsOverview(orgId: string): Promise<OrgAnalyticsOverview> {
  return req<OrgAnalyticsOverview>(`${BASE}/${orgId}/analytics/overview`);
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
