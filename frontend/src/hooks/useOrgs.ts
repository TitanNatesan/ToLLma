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
  mine: ["orgs", "mine-invitations"],
  search: (q: string) => ["orgs", "search", q],
  notifications: ["notifications"],
  unread: ["notifications", "unread"],
} as const;

export function useOrgs() {
  return useQuery({ queryKey: ORG_KEYS.list, queryFn: orgApi.listOrgs });
}

export function useOrg(id: string) {
  return useQuery({ queryKey: ORG_KEYS.detail(id), queryFn: () => orgApi.getOrg(id) });
}

export function useOrgSearch(q: string) {
  return useQuery({
    queryKey: ORG_KEYS.search(q),
    queryFn: () => orgApi.searchOrgs(q),
    enabled: q.trim().length >= 2,
  });
}

export function useMembers(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.members(orgId), queryFn: () => orgApi.listMembers(orgId) });
}

export function useOrgSets(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.sets(orgId), queryFn: () => orgApi.listSets(orgId) });
}

export function usePermissionCatalog() {
  return useQuery({ queryKey: ["orgs", "permission-catalog"], queryFn: orgApi.permissionCatalog });
}

export function useOrgInvitations(orgId: string) {
  return useQuery({
    queryKey: ORG_KEYS.invitations(orgId),
    queryFn: () => orgApi.listInvitations(orgId),
  });
}

export function useJoinRequests(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.requests(orgId), queryFn: () => orgApi.listRequests(orgId) });
}

export function useOrgAudit(orgId: string) {
  return useQuery({ queryKey: ORG_KEYS.audit(orgId), queryFn: () => orgApi.getAudit(orgId) });
}

export function useMyInvitations() {
  return useQuery({ queryKey: ORG_KEYS.mine, queryFn: orgApi.myInvitations });
}

export function useNotifications() {
  return useQuery({ queryKey: ORG_KEYS.notifications, queryFn: () => orgApi.listNotifications() });
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
  }
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
