"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as orgApi from "@/services/orgs";

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
  budget: (id: string) => ["orgs", id, "budget"],
  analyticsOverview: (id: string) => ["orgs", id, "analytics", "overview"],
  mine: ["orgs", "mine-invitations"],
  search: (q: string) => ["orgs", "search", q],
  notifications: ["notifications"],
  unread: ["notifications", "unread"],
} as const;

export function useOrgs() {
  return useQuery({ queryKey: ORG_KEYS.list, queryFn: orgApi.listOrgs, staleTime: 0, refetchOnWindowFocus: true });
}

export function useOrg(id: string) {
  return useQuery({ queryKey: ORG_KEYS.detail(id), queryFn: () => orgApi.getOrg(id), staleTime: 0, refetchOnWindowFocus: true });
}

export function useOrgSearch(q: string) {
  return useQuery({
    queryKey: ORG_KEYS.search(q),
    queryFn: () => orgApi.searchOrgs(q),
    enabled: q.trim().length >= 2,
  });
}

export function useMembers(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.members(orgId), queryFn: () => orgApi.listMembers(orgId), staleTime: 0, refetchOnWindowFocus: true });
}

export function useOrgSets(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.sets(orgId), queryFn: () => orgApi.listSets(orgId), staleTime: 0, refetchOnWindowFocus: true });
}

export function usePermissionCatalog() {
  return useQuery({ queryKey: ["orgs", "permission-catalog"], queryFn: orgApi.permissionCatalog });
}

export function useOrgInvitations(orgId: string) {
  return useQuery({
    queryKey: ORG_KEYS.invitations(orgId),
    queryFn: () => orgApi.listInvitations(orgId),
    staleTime: 0,
  });
}

export function useJoinRequests(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.requests(orgId), queryFn: () => orgApi.listRequests(orgId), staleTime: 0, refetchOnWindowFocus: true });
}

export function useOrgAudit(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.audit(orgId), queryFn: () => orgApi.getAudit(orgId), staleTime: 0, refetchOnWindowFocus: true });
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
    void qc.invalidateQueries({ queryKey: ORG_KEYS.budget(orgId) });
    void qc.invalidateQueries({ queryKey: ORG_KEYS.analyticsOverview(orgId) });
  }
}

/** Phase B: org API keys (defensive: 404 while the backend lands → empty states). */
export function useOrgKeys(orgId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ORG_KEYS.keys(orgId),
    queryFn: () => orgApi.listOrgKeys(orgId),
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
export function useOrgAnalyticsOverview(orgId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ORG_KEYS.analyticsOverview(orgId),
    queryFn: () => orgApi.getOrgAnalyticsOverview(orgId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: options?.enabled ?? true,
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
      mutationFn: (p: { name: string; assignee_user_id: string; description?: string; max_budget_usd?: number | null; model_permissions?: Array<{ model_id: string; provider_id?: string }> }) =>
        orgApi.createOrgKey(orgId ?? "", p),
      onSuccess: () => inv(),
    }),
    revokeKey: useMutation({
      mutationFn: (keyId: string) => orgApi.revokeOrgKey(orgId ?? "", keyId),
      onSuccess: () => inv(),
    }),
    createOrgProvider: useMutation({
      mutationFn: (p: { name: string; provider_type: string; credentials: Record<string, unknown> }) =>
        orgApi.createOrgProvider(orgId ?? "", p),
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
