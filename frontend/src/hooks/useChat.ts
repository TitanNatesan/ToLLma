"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getUsage,
  listConversationPage,
  listConversations,
  pinConversation,
  renameConversation,
} from "@/services/api";
import { useChatStore } from "@/store/chat";

export function useConversations(search: string) {
  return useQuery({ queryKey: ["conversations", search], queryFn: () => listConversations(search || undefined) });
}

const CONVERSATION_PAGE_LIMIT = 20;

/** Cursor-paged conversation feed for infinite scroll. The backend may not
 * paginate yet (bare array → single page, no next); the shape tolerates both.
 * Search/workspace changes reset via the query key. */
export function useConversationsInfinite(search: string) {
  return useInfiniteQuery({
    queryKey: ["conversations", "infinite", search],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      listConversationPage(search || undefined, { limit: CONVERSATION_PAGE_LIMIT, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

// Paused while streaming: the id-change fetch could otherwise resolve after the
// post-stream refresh and overwrite fresh messages with stale empties.
export function useConversation(id: string | null) {
  const streaming = useChatStore((s) => s.streaming);
  return useQuery({
    queryKey: ["conversation", id],
    queryFn: () => getConversation(id as string),
    enabled: !!id && !streaming,
    retry: (count, error) => {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 422) return false;
      return count < 2;
    },
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
    pin: useMutation({
      mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => pinConversation(id, pinned),
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
