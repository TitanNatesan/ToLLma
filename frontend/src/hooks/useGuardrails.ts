"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cloneGuardrail,
  createEvaluator,
  createGuardrail,
  createGuardrailFromTemplate,
  deleteEvaluator,
  deleteGuardrail,
  disableGuardrail,
  enableGuardrail,
  getEffectiveGuardrails,
  getGuardrail,
  getLayaHealth,
  getTrigger,
  listEvaluators,
  listGuardrails,
  listGuardrailTemplates,
  listTriggers,
  patchEvaluator,
  revalidateEvaluator,
  testGuardrail,
  updateGuardrail,
  validateGuardrailCredentials,
  type CredentialsValidateInput,
  type EvaluatorCreateInput,
  type EvaluatorPatchInput,
  type GuardrailCreateInput,
  type GuardrailTestInput,
  type GuardrailUpdateInput,
  type TriggerFilters,
} from "@/services/guardrails";
import { isGuardrailStatus } from "@/services/guardrails";

export const GUARDRAILS_KEYS = {
  all: ["guardrails"] as const,
  list: (orgId?: string | null) => ["guardrails", "list", orgId ?? "personal"] as const,
  detail: (id: string) => ["guardrails", "detail", id] as const,
  templates: ["guardrails", "templates"] as const,
  laya: ["guardrails", "laya-health"] as const,
  effective: (key: string) => ["guardrails", "effective", key] as const,
  triggers: (filters: TriggerFilters) => ["guardrails", "triggers", filters] as const,
  trigger: (id: string) => ["guardrails", "trigger", id] as const,
  evaluators: (policyId: string) => ["guardrails", "evaluators", policyId] as const,
};

/** Governance list: always fresh, refetch on focus. 404-oracle never retries. */
export function useGuardrails(orgId?: string | null) {
  return useQuery({
    queryKey: GUARDRAILS_KEYS.list(orgId ?? undefined),
    queryFn: () => listGuardrails(orgId ?? undefined),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: (count, e) => (isGuardrailStatus(e, 404) ? false : count < 1),
  });
}

export function useGuardrail(id: string | null, orgId?: string | null) {
  return useQuery({
    queryKey: GUARDRAILS_KEYS.detail(id ?? ""),
    queryFn: () => getGuardrail(id!, orgId ?? undefined),
    enabled: !!id,
    retry: (count, e) => (isGuardrailStatus(e, 404) ? false : count < 1),
  });
}

export function useGuardrailMutations(orgId?: string | null) {
  const qc = useQueryClient();
  const scope = orgId ?? undefined;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: GUARDRAILS_KEYS.all });
  };
  return {
    create: useMutation({
      // org_id rides the POST body (matches backend PolicyCreate); omit for personal.
      mutationFn: (body: GuardrailCreateInput) =>
        createGuardrail(orgId ? { ...body, org_id: orgId } : body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: GuardrailUpdateInput }) => updateGuardrail(id, body, scope),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => deleteGuardrail(id, scope), onSuccess: invalidate }),
    clone: useMutation({ mutationFn: (id: string) => cloneGuardrail(id, scope), onSuccess: invalidate }),
    enable: useMutation({ mutationFn: (id: string) => enableGuardrail(id, scope), onSuccess: invalidate }),
    disable: useMutation({ mutationFn: (id: string) => disableGuardrail(id, scope), onSuccess: invalidate }),
    test: useMutation({
      mutationFn: ({ id, content, stage, credentials, run_llm }: { id: string } & GuardrailTestInput) =>
        testGuardrail(id, { content, stage, credentials, run_llm }, scope),
    }),
    fromTemplate: useMutation({
      mutationFn: (key: string) => createGuardrailFromTemplate(key, scope),
      onSuccess: invalidate,
    }),
    createEvaluator: useMutation({
      mutationFn: ({ policyId, body }: { policyId: string; body: EvaluatorCreateInput }) =>
        createEvaluator(policyId, body, scope),
      onSuccess: invalidate,
    }),
    patchEvaluator: useMutation({
      mutationFn: ({ evaluatorId, body }: { evaluatorId: string; body: EvaluatorPatchInput }) =>
        patchEvaluator(evaluatorId, body, scope),
      onSuccess: invalidate,
    }),
    deleteEvaluator: useMutation({
      mutationFn: (evaluatorId: string) => deleteEvaluator(evaluatorId, scope),
      onSuccess: invalidate,
    }),
    revalidateEvaluator: useMutation({
      mutationFn: (evaluatorId: string) => revalidateEvaluator(evaluatorId, scope),
    }),
    validateCredentials: useMutation({
      mutationFn: (body: CredentialsValidateInput) => validateGuardrailCredentials(body),
    }),
  };
}

export function useGuardrailTemplates(enabled = true) {
  return useQuery({
    queryKey: GUARDRAILS_KEYS.templates,
    queryFn: listGuardrailTemplates,
    enabled,
    staleTime: 60_000,
  });
}

/** Laya evaluator health, polled every 30s while mounted. */
export function useLayaHealth(enabled = true) {
  return useQuery({
    queryKey: GUARDRAILS_KEYS.laya,
    queryFn: getLayaHealth,
    enabled,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useEffectiveGuardrails(
  params: { provider_id?: string; model_id?: string; key_id?: string; org_id?: string | null; source?: string },
  enabled = true,
) {
  const key = JSON.stringify(params);
  return useQuery({
    queryKey: GUARDRAILS_KEYS.effective(key),
    queryFn: () => getEffectiveGuardrails(params),
    enabled,
    staleTime: 30_000,
  });
}

export type { GuardrailCreateInput };

/** Cursor-paginated trigger feed. */
export function useGuardrailTriggers(filters: Omit<TriggerFilters, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: GUARDRAILS_KEYS.triggers(filters as TriggerFilters),
    queryFn: ({ pageParam }) => listTriggers({ ...(filters as TriggerFilters), cursor: pageParam as string | undefined, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useGuardrailTrigger(id: string | null, orgId?: string | null) {
  return useQuery({
    queryKey: GUARDRAILS_KEYS.trigger(id ?? ""),
    queryFn: () => getTrigger(id!, orgId ?? undefined),
    enabled: !!id,
    retry: (count, e) => (isGuardrailStatus(e, 404) ? false : count < 1),
  });
}

export function useEvaluators(policyId: string | null, orgId?: string | null, enabled = true) {
  return useQuery({
    queryKey: GUARDRAILS_KEYS.evaluators(policyId ?? ""),
    queryFn: () => listEvaluators(policyId!, orgId ?? undefined),
    enabled: !!policyId && enabled,
    retry: (count, e) => (isGuardrailStatus(e, 404) ? false : count < 1),
  });
}
