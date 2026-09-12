"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getUsage,
  listConversations,
  renameConversation,
} from "@/services/api";
import { useChatStore } from "@/store/chat";

export function useConversations(search: string) {
  return useQuery({ queryKey: ["conversations", search], queryFn: () => listConversations(search || undefined) });
}

// Paused while streaming: the id-change fetch could otherwise resolve after the
// post-stream refresh and overwrite fresh messages with stale empties.
export function useConversation(id: string | null) {
  const streaming = useChatStore((s) => s.streaming);
  return useQuery({
    queryKey: ["conversation", id],
    queryFn: () => getConversation(id as string),
    enabled: !!id && !streaming,
  });
}

export function useUsage(id: string | null) {
  const streaming = useChatStore((s) => s.streaming);
  return useQuery({
    queryKey: ["usage", id],
    queryFn: () => getUsage(id as string),
    enabled: !!id && !streaming,
  });
}

export function useConversationMutations() {
  const qc = useQueryClient();
  const invalidateLists = () => void qc.invalidateQueries({ queryKey: ["conversations"] });
  return {
    create: useMutation({ mutationFn: createConversation, onSuccess: invalidateLists }),
    rename: useMutation({
      mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(id, title),
      onSuccess: (_d, v) => {
        invalidateLists();
        void qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      },
    }),
    remove: useMutation({ mutationFn: deleteConversation, onSuccess: invalidateLists }),
    refresh: (id: string | null) => {
      if (!id) return;
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
      void qc.invalidateQueries({ queryKey: ["usage", id] });
      invalidateLists();
    },
  };
}
