"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  listModels,
  listProviders,
  updateModel,
  updateProvider,
  validateProvider,
} from "@/services/api";

export function useProviders() {
  return useQuery({ queryKey: ["providers"], queryFn: listProviders });
}

export function useProviderMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["providers"] });
    void qc.invalidateQueries({ queryKey: ["models"] });
  };
  return {
    create: useMutation({ mutationFn: createProvider, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => updateProvider(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: deleteProvider, onSuccess: invalidate }),
    validate: useMutation({ mutationFn: validateProvider }),
  };
}

export function useModels(providerId?: string, search?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["models", providerId ?? "", search ?? ""],
    queryFn: () => listModels({ provider_id: providerId || undefined, search: search || undefined }),
    enabled: options?.enabled ?? true,
  });
}

export function useModelMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["models"] });
  return {
    create: useMutation({ mutationFn: createModel, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => updateModel(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: deleteModel, onSuccess: invalidate }),
  };
}
