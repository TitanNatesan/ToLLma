"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { listChatKeys, listChatKeyModels } from "@/services/api";
import type { ChatKey, ChatKeyModel } from "@/types";
import { useMemo } from "react";

/** Eligible keys for the session user (personal live + assigned org keys). */
export function useChatKeys() {
  return useQuery({ queryKey: ["chat-keys"], queryFn: listChatKeys, staleTime: 30_000 });
}

export interface KeyModelsEntry {
  key: ChatKey;
  /** Undefined while this key's models are still loading. */
  models: ChatKeyModel[] | undefined;
  pending: boolean;
  error: boolean;
}

/**
 * Models for every key at once (same per-key query keys as
 * useChatKeyModels, so caches are shared, not duplicated). Powers the
 * unified key-grouped model dropdown: no separate key picker needed.
 */
export function useAllChatKeyModels(keys: ChatKey[] | undefined) {
  const list = useMemo(() => keys ?? [], [keys]);
  const results = useQueries({
    queries: list.map((k) => ({
      queryKey: ["chat-key-models", k.id],
      queryFn: () => listChatKeyModels(k.id),
      staleTime: 30_000,
    })),
  });
  return useMemo(() => {
    const entries: KeyModelsEntry[] = list.map((key, i) => {
      const r = results[i];
      return {
        key,
        models: r?.data,
        pending: r?.isPending ?? false,
        error: r?.isError ?? false,
      };
    });
    return { entries, isPending: entries.some((e) => e.pending) };
  }, [list, results]);
}
