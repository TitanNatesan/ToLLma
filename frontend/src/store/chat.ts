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
  sidebarWidth: number;
  rightSidebarWidth: number;
  draft: string;
  optimisticMessages: OptimisticMessage[];
  addProviderOpen: boolean;
  providerSearch: string;
  providerTypeFilter: string;
  selectedProviderId: string | null;

  setProvider: (id: string | null) => void;
  setModel: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  setSearch: (s: string) => void;
  setStreaming: (b: boolean) => void;
  setLeftSidebar: (open: boolean) => void;
  setRightSidebar: (open: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setDraft: (text: string) => void;
  addOptimistic: (msg: OptimisticMessage) => void;
  updateOptimisticStreaming: (id: string, delta: string) => void;
  clearOptimistic: () => void;
  setAddProviderOpen: (open: boolean) => void;
  setProviderSearch: (s: string) => void;
  setProviderTypeFilter: (t: string) => void;
  setSelectedProviderId: (id: string | null) => void;
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
      sidebarWidth: 260,
      rightSidebarWidth: 380,
      draft: "",
      optimisticMessages: [],
      addProviderOpen: false,
      providerSearch: "",
      providerTypeFilter: "ALL",
      selectedProviderId: null,

      setProvider: (providerId) => set({ providerId, modelId: null }),
      setModel: (modelId) => set({ modelId }),
      setConversation: (activeConversationId) => set({ activeConversationId }),
      setSearch: (sidebarSearch) => set({ sidebarSearch }),
      setStreaming: (streaming) => set({ streaming }),
      setLeftSidebar: (leftSidebarOpen) => set({ leftSidebarOpen }),
      setRightSidebar: (rightSidebarOpen) => set({ rightSidebarOpen }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setRightSidebarWidth: (rightSidebarWidth) => set({ rightSidebarWidth }),
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
      setAddProviderOpen: (addProviderOpen) => set({ addProviderOpen }),
      setProviderSearch: (providerSearch) => set({ providerSearch }),
      setProviderTypeFilter: (providerTypeFilter) => set({ providerTypeFilter }),
      setSelectedProviderId: (selectedProviderId) => set({ selectedProviderId }),
    }),
    {
      name: "tollma-chat",
      partialize: (s) => ({
        providerId: s.providerId,
        modelId: s.modelId,
        activeConversationId: s.activeConversationId,
        leftSidebarOpen: s.leftSidebarOpen,
        rightSidebarOpen: s.rightSidebarOpen,
        sidebarWidth: s.sidebarWidth,
        rightSidebarWidth: s.rightSidebarWidth,
        draft: s.draft,
        selectedProviderId: s.selectedProviderId,
      }),
    },
  ),
);
