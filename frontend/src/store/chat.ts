"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OptimisticMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  created_at: string;
}

interface ChatState {
  providerId: string | null;
  modelId: string | null;
  activeConversationId: string | null;
  sidebarSearch: string;
  streaming: boolean;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  draft: string;
  optimisticMessages: OptimisticMessage[];

  setProvider: (id: string | null) => void;
  setModel: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  setSearch: (s: string) => void;
  setStreaming: (b: boolean) => void;
  setLeftSidebar: (open: boolean) => void;
  setRightSidebar: (open: boolean) => void;
  setDraft: (text: string) => void;
  addOptimistic: (msg: OptimisticMessage) => void;
  updateOptimisticStreaming: (id: string, delta: string) => void;
  clearOptimistic: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      providerId: null,
      modelId: null,
      activeConversationId: null,
      sidebarSearch: "",
      streaming: false,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      draft: "",
      optimisticMessages: [],

      setProvider: (providerId) => set({ providerId, modelId: null }),
      setModel: (modelId) => set({ modelId }),
      setConversation: (activeConversationId) => set({ activeConversationId }),
      setSearch: (sidebarSearch) => set({ sidebarSearch }),
      setStreaming: (streaming) => set({ streaming }),
      setLeftSidebar: (leftSidebarOpen) => set({ leftSidebarOpen }),
      setRightSidebar: (rightSidebarOpen) => set({ rightSidebarOpen }),
      setDraft: (draft) => set({ draft }),
      addOptimistic: (msg) =>
        set((s) => ({ optimisticMessages: [...s.optimisticMessages, msg] })),
      updateOptimisticStreaming: (id, delta) =>
        set((s) => ({
          optimisticMessages: s.optimisticMessages.map((m) =>
            m.id === id ? { ...m, content: m.content + delta } : m,
          ),
        })),
      clearOptimistic: () => set({ optimisticMessages: [] }),
    }),
    {
      name: "tollms-chat",
      partialize: (s) => ({
        providerId: s.providerId,
        modelId: s.modelId,
        activeConversationId: s.activeConversationId,
        leftSidebarOpen: s.leftSidebarOpen,
        rightSidebarOpen: s.rightSidebarOpen,
        draft: s.draft,
      }),
    },
  ),
);
