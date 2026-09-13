"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  discoverProviderModels,
  listModels,
  listProviders,
  updateModel,
  updateProvider,
  validateProvider,
} from "@/services/api";
import type { Provider } from "@/types";

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
    create: useMutation({
      mutationFn: createProvider,
      onSuccess: (newProvider) => {
        qc.setQueryData<Provider[]>(["providers"], (old = []) => [...old, newProvider]);
        invalidate();
      },
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => updateProvider(id, body),
      onSuccess: (updated) => {
        qc.setQueryData<Provider[]>(["providers"], (old = []) =>
          old.map((p) => (p.id === updated.id ? updated : p)),
        );
        invalidate();
      },
    }),
    remove: useMutation({
      mutationFn: deleteProvider,
      onSuccess: (_, removedId) => {
        qc.setQueryData<Provider[]>(["providers"], (old = []) =>
          old.filter((p) => p.id !== removedId),
        );
        invalidate();
      },
    }),
    validate: useMutation({
      mutationFn: validateProvider,
      onSuccess: (valRes, id) => {
        qc.setQueryData<Provider[]>(["providers"], (old = []) =>
          old.map((p) =>
            p.id === id
              ? {
                  ...p,
                  validation_status: valRes.valid ? "valid" : "invalid",
                  validation_message: valRes.message,
                  last_validated_at: new Date().toISOString(),
                }
              : p,
          ),
        );
        invalidate();
      },
    }),
    discover: useMutation({ mutationFn: discoverProviderModels, onSuccess: invalidate }),
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
