"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePromptLog,
  getPromptLog,
  getPromptLogRetention,
  getPromptLoggingSettings,
  isPromptLogStatus,
  listPromptLogs,
  purgePromptLogs,
  updateKeyLoggingState,
  updatePromptLoggingSettings,
  type PromptLogFilters,
  type PromptLoggingUpdateInput,
} from "@/services/promptLogs";

export const PROMPT_LOGS_KEYS = {
  all: ["prompt-logs"] as const,
  settings: (orgId?: string | null) => ["prompt-logs", "settings", orgId ?? "personal"] as const,
  list: (filters: PromptLogFilters) => ["prompt-logs", "list", filters] as const,
  detail: (id: string, orgId?: string | null) =>
    ["prompt-logs", "detail", id, orgId ?? "personal"] as const,
  retention: (orgId?: string | null) => ["prompt-logs", "retention", orgId ?? "personal"] as const,
};

const noRetryOn404 = (count: number, e: unknown) =>
  isPromptLogStatus(e, 404) ? false : count < 1;

/** Logging policy. Never optimistic: the UI must not display unpersisted policy. */
export function usePromptLoggingSettings(orgId?: string | null, enabled = true) {
  return useQuery({
    queryKey: PROMPT_LOGS_KEYS.settings(orgId ?? undefined),
    queryFn: () => getPromptLoggingSettings(orgId ?? undefined),
    staleTime: 0,
    refetchOnWindowFocus: true,
    enabled,
    retry: noRetryOn404,
  });
}

export function useUpdatePromptLoggingSettings(orgId?: string | null) {
  const qc = useQueryClient();
  const scope = orgId ?? undefined;
  return useMutation({
    mutationFn: (body: Omit<PromptLoggingUpdateInput, "org_id">) =>
      updatePromptLoggingSettings(scope ? { ...body, org_id: scope } : body),
    onSuccess: async () => {
      // No optimistic state: invalidate, then refetch the persisted policy.
      await qc.invalidateQueries({ queryKey: PROMPT_LOGS_KEYS.all });
      await qc.refetchQueries({ queryKey: PROMPT_LOGS_KEYS.settings(scope) });
    },
  });
}

/** Per-key override (`null` = reset to inherit); invalidates on success. */
export function useUpdateKeyLoggingState(orgId?: string | null) {
  const qc = useQueryClient();
  const scope = orgId ?? undefined;
  return useMutation({
    mutationFn: (p: { keyId: string; enabled: boolean | null }) =>
      updateKeyLoggingState(scope, p.keyId, p.enabled),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PROMPT_LOGS_KEYS.all });
      await qc.refetchQueries({ queryKey: PROMPT_LOGS_KEYS.settings(scope) });
    },
  });
}

export type { PromptLogFilters };

/** Cursor-paginated log feed (server-side filtering; filters AND-combine). */
export function usePromptLogList(filters: Omit<PromptLogFilters, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: PROMPT_LOGS_KEYS.list(filters as PromptLogFilters),
    queryFn: ({ pageParam }) =>
      listPromptLogs({ ...(filters as PromptLogFilters), cursor: pageParam as string | undefined, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function usePromptLogDetail(id: string | null, orgId?: string | null, enabled = true) {
  return useQuery({
    queryKey: PROMPT_LOGS_KEYS.detail(id ?? "", orgId ?? undefined),
    queryFn: () => getPromptLog(id!, orgId ?? undefined),
    enabled: !!id && enabled,
    retry: noRetryOn404,
  });
}

export function usePromptLogRetention(orgId?: string | null, enabled = true) {
  return useQuery({
    queryKey: PROMPT_LOGS_KEYS.retention(orgId ?? undefined),
    queryFn: () => getPromptLogRetention(orgId ?? undefined),
    enabled,
    staleTime: 60_000,
    retry: noRetryOn404,
  });
}

export function usePromptLogMutations(orgId?: string | null) {
  const qc = useQueryClient();
  const scope = orgId ?? undefined;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: PROMPT_LOGS_KEYS.all });
  };
  return {
    remove: useMutation({
      mutationFn: (id: string) => deletePromptLog(id, scope),
      onSuccess: invalidate,
    }),
    purge: useMutation({
      mutationFn: (before?: string) => purgePromptLogs(scope, before),
      onSuccess: invalidate,
    }),
  };
}
