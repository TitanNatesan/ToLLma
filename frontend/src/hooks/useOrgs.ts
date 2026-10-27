"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as orgApi from "@/services/orgs";
import { ApiError } from "@/services/api";
import type { OrgKeyCreateInput, OrgProviderCreateInput } from "@/types/orgs";
import type {
  ApiKeyIpRuleInput,
  ApiKeyModelPermissionInput,
  ApiKeyPolicyInput,
  ApiKeyUpdateInput,
} from "@/types/apiKeys";

export const ORG_KEYS = {
  list: ["orgs"],
  detail: (id: string) => ["orgs", id],
  members: (id: string) => ["orgs", id, "members"],
  sets: (id: string) => ["orgs", id, "sets"],
  invitations: (id: string) => ["orgs", id, "invitations"],
  requests: (id: string) => ["orgs", id, "requests"],
  audit: (id: string) => ["orgs", id, "audit"],
  keys: (id: string) => ["orgs", id, "keys"],
  providers: (id: string) => ["orgs", id, "providers"],
  models: (id: string) => ["orgs", id, "models"],
  budget: (id: string) => ["orgs", id, "budget"],
  analyticsOverview: (id: string) => ["orgs", id, "analytics", "overview"],
  teams: (id: string) => ["orgs", id, "teams"],
  team: (orgId: string, teamId: string) => ["orgs", orgId, "teams", teamId],
  mine: ["orgs", "mine-invitations"],
  search: (q: string) => ["orgs", "search", q],
  notifications: ["notifications"],
  unread: ["notifications", "unread"],
} as const;

/** Additive status helpers for scope-isolation UI (no signature changes elsewhere). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function apiErrorStatus(error: unknown): number {
  return error instanceof ApiError ? error.status : 0;
}

export function useOrgs() {
  return useQuery({ queryKey: ORG_KEYS.list, queryFn: orgApi.listOrgs, staleTime: 0, refetchOnWindowFocus: true });
}

export function useOrg(id: string, options?: { enabled?: boolean }) {
  return useQuery({ queryKey: ORG_KEYS.detail(id), queryFn: () => orgApi.getOrg(id), staleTime: 0, refetchOnWindowFocus: true, enabled: options?.enabled ?? true });
}

export function useOrgSearch(q: string) {
  return useQuery({
    queryKey: ORG_KEYS.search(q),
    queryFn: () => orgApi.searchOrgs(q),
    enabled: q.trim().length >= 2,
  });
}

export function useMembers(orgId: string, params?: orgApi.MemberQuery & { enabled?: boolean }) {
  const { enabled, ...query } = params ?? {};
  const key = params ? [...ORG_KEYS.members(orgId), query] : ORG_KEYS.members(orgId);
  return useQuery({ queryKey: key, queryFn: () => orgApi.listMembers(orgId, query), staleTime: 0, refetchOnWindowFocus: true, enabled: enabled ?? true });
}

export function useOrgSets(orgId: string, params?: orgApi.SetQuery, options?: { enabled?: boolean }) {
  const key = params ? [...ORG_KEYS.sets(orgId), params] : ORG_KEYS.sets(orgId);
  return useQuery({ queryKey: key, queryFn: () => orgApi.listSets(orgId, params), staleTime: 0, refetchOnWindowFocus: true, enabled: options?.enabled ?? true });
}

export function usePermissionCatalog() {
  return useQuery({ queryKey: ["orgs", "permission-catalog"], queryFn: orgApi.permissionCatalog });
}

export function useOrgInvitations(orgId: string, params?: orgApi.InvitationQuery, options?: { enabled?: boolean }) {
  const key = params ? [...ORG_KEYS.invitations(orgId), params] : ORG_KEYS.invitations(orgId);
  return useQuery({
    queryKey: key,
    queryFn: () => orgApi.listInvitations(orgId, params?.status, params),
    staleTime: 0,
    enabled: options?.enabled ?? true,
  });
}

export function useJoinRequests(orgId: string, params?: orgApi.RequestQuery, options?: { enabled?: boolean }) {
  const key = params ? [...ORG_KEYS.requests(orgId), params] : ORG_KEYS.requests(orgId);
  return useQuery({ queryKey: key, queryFn: () => orgApi.listRequests(orgId, params), staleTime: 0, refetchOnWindowFocus: true, enabled: options?.enabled ?? true });
}

export function useOrgAudit(orgId: string, params?: orgApi.AuditQuery, options?: { enabled?: boolean }) {
  const key = params ? [...ORG_KEYS.audit(orgId), params] : ORG_KEYS.audit(orgId);
  return useQuery({ queryKey: key, queryFn: () => orgApi.getAudit(orgId, params ?? 100), staleTime: 0, refetchOnWindowFocus: true, enabled: options?.enabled ?? true });
}

export function useMyInvitations() {
  return useQuery({ queryKey: ORG_KEYS.mine, queryFn: orgApi.myInvitations, staleTime: 0, refetchOnWindowFocus: true });
}

export function useNotifications() {
  return useQuery({ queryKey: ORG_KEYS.notifications, queryFn: () => orgApi.listNotifications(), staleTime: 0, refetchOnWindowFocus: true });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ORG_KEYS.unread,
    queryFn: orgApi.unreadCount,
    refetchInterval: 60000,
  });
}

function invalidateOrg(qc: ReturnType<typeof useQueryClient>, orgId?: string) {
  void qc.invalidateQueries({ queryKey: ORG_KEYS.list });
  void qc.invalidateQueries({ queryKey: ORG_KEYS.mine });
  void qc.invalidateQueries({ queryKey: ORG_KEYS.notifications });
  void qc.invalidateQueries({ queryKey: ORG_KEYS.unread });
  if (orgId) {
    void qc.invalidateQueries({ queryKey: ORG_KEYS.detail(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.members(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.sets(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.invitations(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.requests(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.audit(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.keys(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.providers(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.models(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.budget(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.analyticsOverview(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.teams(orgId) });
  }
}

/** Phase B: org API keys (defensive: 404 while the backend lands → empty states). */
export function useOrgKeys(orgId: string, options?: { enabled?: boolean; params?: orgApi.OrgKeyQuery }) {
  const key = options?.params ? [...ORG_KEYS.keys(orgId), options.params] : ORG_KEYS.keys(orgId);
  return useQuery({
    queryKey: key,
    queryFn: () => orgApi.listOrgKeys(orgId, options?.params),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** Phase B: org providers. */
export function useOrgProviders(orgId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ORG_KEYS.providers(orgId),
    queryFn: () => orgApi.listOrgProviders(orgId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

export function useOrgProviderModels(orgId: string, providerId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["orgs", orgId, "providers", providerId ?? "", "models"],
    queryFn: () => orgApi.listOrgProviderModels(orgId, providerId as string),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: (options?.enabled ?? true) && !!providerId,
  });
}

/** All active models across the org's live providers (key-picker support). */
export function useOrgModels(orgId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ORG_KEYS.models(orgId),
    queryFn: () => orgApi.listOrgModels(orgId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** Phase B: org budget pools ({max_spend, allocated, unallocated}). */
export function useOrgBudget(orgId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ORG_KEYS.budget(orgId),
    queryFn: () => orgApi.getOrgBudget(orgId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** Phase B: org analytics overview (ViewUsage; cost null without ViewCost). */
export function useOrgAnalyticsOverview(
  orgId: string,
  options?: { enabled?: boolean; params?: import("@/types/orgs").OrgAnalyticsParams },
) {
  const key = options?.params
    ? [...ORG_KEYS.analyticsOverview(orgId), options.params]
    : ORG_KEYS.analyticsOverview(orgId);
  return useQuery({
    queryKey: key,
    queryFn: () => orgApi.getOrgAnalyticsOverview(orgId, options?.params),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** Member analytics (ViewUsage; cost null without ViewCost). 404 while the
 *  backend lands is surfaced to the caller — the section renders empty. */
export function useMemberAnalytics(
  orgId: string,
  userId: string | null,
  options?: { enabled?: boolean; params?: import("@/types/orgs").MemberAnalyticsParams },
) {
  const key = options?.params
    ? [...ORG_KEYS.members(orgId), "analytics", userId, options.params]
    : [...ORG_KEYS.members(orgId), "analytics", userId];
  return useQuery({
    queryKey: key,
    queryFn: () => orgApi.getMemberAnalytics(orgId, userId as string, options?.params),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: (options?.enabled ?? true) && !!userId,
  });
}

/** Phase B: public invitation preview (no auth; invalid/expired → error → not-found UI). */
export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ["orgs", "invite-preview", token],
    queryFn: () => orgApi.previewInvitation(token),
    retry: false,
    staleTime: 30_000,
    enabled: token.trim().length > 0,
  });
}

/** Phase B: public accept-new (creates the account + joins; 409 = account exists). */
export function useAcceptInviteNew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { token: string; full_name: string; password: string; email?: string }) =>
      orgApi.acceptInvitationNew(p.token, { full_name: p.full_name, password: p.password, email: p.email }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_KEYS.list });
      void qc.invalidateQueries({ queryKey: ORG_KEYS.mine });
    },
  });
}

/** Phase B: public reject-new (declines; never creates an account). */
export function useRejectInviteNew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => orgApi.rejectInvitationNew(token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_KEYS.mine });
    },
  });
}

/** Teams list (defensive: 404 while the backend lands → honest empty states). */
export function useTeams(orgId: string, options?: { enabled?: boolean; params?: orgApi.TeamQuery }) {
  const key = options?.params ? [...ORG_KEYS.teams(orgId), options.params] : ORG_KEYS.teams(orgId);
  return useQuery({
    queryKey: key,
    queryFn: () => orgApi.listTeams(orgId, options?.params),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

/** Team detail (retry off: 404 is the denied-or-missing oracle). */
export function useTeam(orgId: string, teamId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ORG_KEYS.team(orgId, teamId),
    queryFn: () => orgApi.getTeam(orgId, teamId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: (options?.enabled ?? true) && teamId.trim().length > 0,
  });
}

/** Teams mutations; same invalidation pattern as useOrgMutations. */
export function useTeamMutations(orgId?: string) {
  const qc = useQueryClient();
  const inv = (id?: string) => invalidateOrg(qc, id ?? orgId);
  const invTeam = (teamId?: string) => {
    inv();
    if (teamId && orgId) {
      void qc.invalidateQueries({ queryKey: ORG_KEYS.team(orgId, teamId) });
    }
  };
  return {
    createTeam: useMutation({
      mutationFn: (p: { name: string; description?: string; setIds?: string[] }) =>
        orgApi.createTeam(orgId ?? "", { name: p.name, description: p.description, set_ids: p.setIds }),
      onSuccess: () => inv(),
    }),
    updateTeam: useMutation({
      mutationFn: (p: { teamId: string; payload: Record<string, unknown> }) =>
        orgApi.updateTeam(orgId ?? "", p.teamId, p.payload),
      onSuccess: (_d, v) => invTeam(v.teamId),
    }),
    deleteTeam: useMutation({
      mutationFn: (teamId: string) => orgApi.deleteTeam(orgId ?? "", teamId),
      onSuccess: () => inv(),
    }),
    addMember: useMutation({
      mutationFn: (p: { teamId: string; userId: string }) =>
        orgApi.addTeamMember(orgId ?? "", p.teamId, p.userId),
      onSuccess: (_d, v) => invTeam(v.teamId),
    }),
    removeMember: useMutation({
      mutationFn: (p: { teamId: string; userId: string }) =>
        orgApi.removeTeamMember(orgId ?? "", p.teamId, p.userId),
      onSuccess: (_d, v) => invTeam(v.teamId),
    }),
    replaceSets: useMutation({
      mutationFn: (p: { teamId: string; setIds: string[] }) =>
        orgApi.replaceTeamSets(orgId ?? "", p.teamId, p.setIds),
      onSuccess: (_d, v) => invTeam(v.teamId),
    }),
  };
}

export function useOrgMutations(orgId?: string) {
  const qc = useQueryClient();
  const inv = (id?: string) => invalidateOrg(qc, id ?? orgId);
  return {
    createOrg: useMutation({ mutationFn: orgApi.createOrg, onSuccess: () => inv() }),
    updateOrg: useMutation({
      mutationFn: (p: Record<string, unknown>) => orgApi.updateOrg(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    invite: useMutation({
      mutationFn: (p: { email: string; setIds: string[] }) => orgApi.inviteUser(orgId ?? "", p.email, p.setIds),
      onSuccess: () => inv(),
    }),
    cancelInvite: useMutation({
      mutationFn: (id: string) => orgApi.cancelInvitation(orgId ?? "", id),
      onSuccess: () => inv(),
    }),
    resendInvite: useMutation({
      mutationFn: (id: string) => orgApi.resendInvitation(orgId ?? "", id),
      onSuccess: () => inv(),
    }),
    acceptInvite: useMutation({
      mutationFn: (token: string) => orgApi.acceptInvitation(token),
      onSuccess: () => inv(),
    }),
    rejectInvite: useMutation({
      mutationFn: (token: string) => orgApi.rejectInvitation(token),
      onSuccess: () => inv(),
    }),
    requestJoin: useMutation({
      mutationFn: (id: string) => orgApi.requestJoin(id),
      onSuccess: () => inv(),
    }),
    approveRequest: useMutation({
      mutationFn: (p: { invitationId: string; setIds: string[] }) =>
        orgApi.approveRequest(orgId ?? "", p.invitationId, p.setIds),
      onSuccess: () => inv(),
    }),
    rejectRequest: useMutation({
      mutationFn: (id: string) => orgApi.rejectRequest(orgId ?? "", id),
      onSuccess: () => inv(),
    }),
    removeMember: useMutation({
      mutationFn: (userId: string) => orgApi.removeMember(orgId ?? "", userId),
      onSuccess: () => inv(),
    }),
    suspendMember: useMutation({
      mutationFn: (userId: string) => orgApi.suspendMember(orgId ?? "", userId),
      onSuccess: () => inv(),
    }),
    resumeMember: useMutation({
      mutationFn: (userId: string) => orgApi.resumeMember(orgId ?? "", userId),
      onSuccess: () => inv(),
    }),
    leave: useMutation({ mutationFn: (id: string) => orgApi.leaveOrg(id), onSuccess: () => inv() }),
    assignSets: useMutation({
      mutationFn: (p: { userId: string; setIds: string[] }) =>
        orgApi.assignSets(orgId ?? "", p.userId, p.setIds),
      onSuccess: () => inv(),
    }),
    createSet: useMutation({
      mutationFn: (p: { name: string; description?: string; permissions: string[] }) =>
        orgApi.createSet(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    updateSet: useMutation({
      mutationFn: (p: { setId: string; payload: Record<string, unknown> }) =>
        orgApi.updateSet(orgId ?? "", p.setId, p.payload),
      onSuccess: () => inv(),
    }),
    deleteSet: useMutation({
      mutationFn: (setId: string) => orgApi.deleteSet(orgId ?? "", setId),
      onSuccess: () => inv(),
    }),
    cloneSet: useMutation({
      mutationFn: (p: { setId: string; name: string }) => orgApi.cloneSet(orgId ?? "", p.setId, p.name),
      onSuccess: () => inv(),
    }),
    createKey: useMutation({
      mutationFn: (p: OrgKeyCreateInput) =>
        orgApi.createOrgKey(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    revokeKey: useMutation({
      mutationFn: (keyId: string) => orgApi.revokeOrgKey(orgId ?? "", keyId),
      onSuccess: () => inv(),
    }),
    updateKey: useMutation({
      mutationFn: (p: { keyId: string; patch: ApiKeyUpdateInput }) =>
        orgApi.updateOrgKey(orgId ?? "", p.keyId, p.patch),
      onSuccess: () => inv(),
    }),
    updateKeyPolicy: useMutation({
      mutationFn: (p: { keyId: string; policy: ApiKeyPolicyInput }) =>
        orgApi.updateOrgKeyPolicy(orgId ?? "", p.keyId, p.policy),
      onSuccess: () => inv(),
    }),
    updateKeyIpRules: useMutation({
      mutationFn: (p: { keyId: string; rules: ApiKeyIpRuleInput[] }) =>
        orgApi.updateOrgKeyIpRules(orgId ?? "", p.keyId, p.rules),
      onSuccess: () => inv(),
    }),
    updateKeyModelPermissions: useMutation({
      mutationFn: (p: { keyId: string; permissions: ApiKeyModelPermissionInput[] }) =>
        orgApi.updateOrgKeyModelPermissions(orgId ?? "", p.keyId, p.permissions),
      onSuccess: () => inv(),
    }),
    rotateKey: useMutation({
      mutationFn: (keyId: string) => orgApi.rotateOrgKey(orgId ?? "", keyId),
      onSuccess: () => inv(),
    }),
    createOrgProvider: useMutation({
      mutationFn: (p: OrgProviderCreateInput) =>
        orgApi.createOrgProvider(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    createOrgProviderWithModels: useMutation({
      mutationFn: (p: OrgProviderCreateInput) =>
        orgApi.createOrgProviderWithModels(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    deleteOrgProvider: useMutation({
      mutationFn: (providerId: string) => orgApi.deleteOrgProvider(orgId ?? "", providerId),
      onSuccess: () => inv(),
    }),
    updateOrgProvider: useMutation({
      mutationFn: (p: { providerId: string; payload: Record<string, unknown> }) =>
        orgApi.updateOrgProvider(orgId ?? "", p.providerId, p.payload),
      onSuccess: () => inv(),
    }),
    createOrgModel: useMutation({
      mutationFn: (p: { providerId: string; payload: Record<string, unknown> }) =>
        orgApi.createOrgModel(orgId ?? "", p.providerId, p.payload),
      onSuccess: () => inv(),
    }),
    updateOrgModel: useMutation({
      mutationFn: (p: { modelId: string; payload: Record<string, unknown> }) =>
        orgApi.updateOrgModel(orgId ?? "", p.modelId, p.payload),
      onSuccess: () => inv(),
    }),
    deleteOrgModel: useMutation({
      mutationFn: (modelId: string) => orgApi.deleteOrgModel(orgId ?? "", modelId),
      onSuccess: () => inv(),
    }),
    updateBudget: useMutation({
      mutationFn: (p: Record<string, unknown>) => orgApi.updateOrgBudget(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    markRead: useMutation({
      mutationFn: (id: string) => orgApi.markNotificationRead(id),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ORG_KEYS.notifications });
        void qc.invalidateQueries({ queryKey: ORG_KEYS.unread });
      },
    }),
    markAllRead: useMutation({
      mutationFn: orgApi.markAllNotificationsRead,
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ORG_KEYS.notifications });
        void qc.invalidateQueries({ queryKey: ORG_KEYS.unread });
      },
    }),
  };
}
