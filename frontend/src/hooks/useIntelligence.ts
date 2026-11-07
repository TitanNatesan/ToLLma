"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateGeneration,
  createBranch,
  createShare,
  disableShare,
  editMessage,
  getAnalyticsWidgets,
  getBranchTree,
  getConversationPath,
  getConversationTree,
  getMessageHistory,
  listShares,
  regenerateMessage,
  regenerateShare,
  searchConversations,
  selectConversationBranch,
} from "@/services/api";
import type { AnalyticsRangeParams } from "@/types";

export function useConversationSearch(query: string, filters: { providerId?: string; modelId?: string } = {}) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed, filters.providerId ?? "", filters.modelId ?? ""],
    queryFn: () => searchConversations(trimmed, filters),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
  });
}

function noRetryOnMissing(count: number, error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (status === 404 || status === 422) return false;
  return count < 2;
}

/** Message-level tree (spec 7-10). 404s while the backend is mid-build: the
 *  caller falls back to the persisted conversation array, never a blank chat. */
export function useConversationTree(conversationId: string | null) {
  return useQuery({
    queryKey: ["conversation-tree", conversationId],
    queryFn: () => getConversationTree(conversationId as string),
    enabled: Boolean(conversationId),
    retry: noRetryOnMissing,
  });
}

/** Active path root→leaf (spec 7-10). Same 404 tolerance as the tree. */
export function useConversationPath(conversationId: string | null) {
  return useQuery({
    queryKey: ["conversation-path", conversationId],
    queryFn: () => getConversationPath(conversationId as string),
    enabled: Boolean(conversationId),
    retry: noRetryOnMissing,
  });
}

export function useBranchTree(conversationId: string | null) {
  return useQuery({
    queryKey: ["branches", conversationId],
    queryFn: () => getBranchTree(conversationId as string),
    enabled: Boolean(conversationId),
  });
}

export function useShares(conversationId: string | null) {
  return useQuery({
    queryKey: ["shares", conversationId],
    queryFn: () => listShares(conversationId as string),
    enabled: Boolean(conversationId),
  });
}

export function useMessageHistory(messageId: string | null) {
  return useQuery({
    queryKey: ["message-history", messageId],
    queryFn: () => getMessageHistory(messageId as string),
    enabled: Boolean(messageId),
  });
}

export function useAnalyticsWidgets(params: AnalyticsRangeParams) {
  return useQuery({
    queryKey: ["analytics-widgets", params.preset, params.start ?? "", params.end ?? "", params.tz],
    queryFn: () => getAnalyticsWidgets(params),
    staleTime: 60_000,
  });
}

export function useIntelligenceMutations(conversationId: string | null) {
  const qc = useQueryClient();
  const invalidate = (id?: string | null) => {
    const target = id ?? conversationId;
    if (target) {
      void qc.invalidateQueries({ queryKey: ["conversation", target] });
      void qc.invalidateQueries({ queryKey: ["conversation-tree", target] });
      void qc.invalidateQueries({ queryKey: ["conversation-path", target] });
      void qc.invalidateQueries({ queryKey: ["branches", target] });
      void qc.invalidateQueries({ queryKey: ["request-logs", target] });
      void qc.invalidateQueries({ queryKey: ["shares", target] });
    }
    void qc.invalidateQueries({ queryKey: ["conversations"] });
    void qc.invalidateQueries({ queryKey: ["analytics-widgets"] });
  };

  const edit = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      editMessage(messageId, content),
    onSuccess: (result) => invalidate(result.message.conversation_id),
  });

  const regenerate = useMutation({
    mutationFn: (messageId: string) => regenerateMessage(messageId),
    onSuccess: (result) => invalidate(result.conversation_id),
  });

  const activate = useMutation({
    mutationFn: ({ messageId, runId }: { messageId: string; runId: string }) =>
      activateGeneration(messageId, runId),
    onSuccess: (result) => invalidate(result.message.conversation_id),
  });

  const select = useMutation({
    mutationFn: ({ conversationId: id, messageId }: { conversationId: string; messageId: string }) =>
      selectConversationBranch(id, messageId),
    // Conversation id is known from the variables (the path payload only
    // carries messages + the leaf); the composer draft lives in the store
    // and is untouched, so switching never loses typed text.
    onSuccess: (_result, variables) => invalidate(variables.conversationId),
  });

  const branch = useMutation({
    mutationFn: ({ conversationId: id, messageId, branchName }: { conversationId: string; messageId: string; branchName?: string }) =>
      createBranch(id, messageId, branchName),
    onSuccess: (info) => invalidate(info.conversation_id),
  });

  const share = useMutation({
    mutationFn: ({ conversationId: id, expiresInHours }: { conversationId: string; expiresInHours?: number }) =>
      createShare(id, expiresInHours),
    onSuccess: (result) => invalidate(result.conversation_id),
  });

  const unshare = useMutation({
    mutationFn: (shareId: string) => disableShare(shareId),
    onSuccess: (result) => invalidate(result.conversation_id),
  });

  const rotate = useMutation({
    mutationFn: (shareId: string) => regenerateShare(shareId),
    onSuccess: (result) => invalidate(result.conversation_id),
  });

  return { edit, regenerate, activate, branch, select, share, unshare, rotate };
}
