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

export interface ActiveGenerationRef {
  id: string;
  messageId: string;
}

interface ChatState {
  providerId: string | null;
  modelId: string | null;
  activeConversationId: string | null;
  sidebarSearch: string;
  streaming: boolean;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  /** Bottom-anchored nav lists visible (both expanded sidebar and collapsed rail read this). */
  navVisible: boolean;
  sidebarWidth: number;
  rightSidebarWidth: number;
  draft: string;
  optimisticMessages: OptimisticMessage[];
  /** Backend-owned generation the UI is currently subscribed to (if any). */
  activeGeneration: ActiveGenerationRef | null;
  addProviderOpen: boolean;
  catalogOpen: boolean;
  catalogPrefill: { family: string; name: string; slug?: string | null; baseUrl?: string | null } | null;
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
  setNavVisible: (visible: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setDraft: (text: string) => void;
  addOptimistic: (msg: OptimisticMessage) => void;
  updateOptimisticStreaming: (id: string, delta: string) => void;
  setOptimisticContent: (id: string, content: string) => void;
  removeOptimistic: (id: string) => void;
  clearOptimistic: () => void;
  setActiveGeneration: (gen: ActiveGenerationRef | null) => void;
  setAddProviderOpen: (open: boolean) => void;
  setCatalogOpen: (open: boolean) => void;
  setCatalogPrefill: (prefill: { family: string; name: string; slug?: string | null; baseUrl?: string | null } | null) => void;
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
      navVisible: true,
      sidebarWidth: 260,
      rightSidebarWidth: 380,
      draft: "",
      optimisticMessages: [],
      activeGeneration: null,
      addProviderOpen: false,
      catalogOpen: false,
      catalogPrefill: null,
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
      setNavVisible: (navVisible) => set({ navVisible }),
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
      setOptimisticContent: (id, content) =>
        set((s) => ({
          optimisticMessages: s.optimisticMessages.map((m) =>
            m.id === id ? { ...m, content } : m,
          ),
        })),
      removeOptimistic: (id) =>
        set((s) => ({
          optimisticMessages: s.optimisticMessages.filter((m) => m.id !== id),
        })),
      clearOptimistic: () => set({ optimisticMessages: [] }),
      setActiveGeneration: (activeGeneration) => set({ activeGeneration }),
      setAddProviderOpen: (addProviderOpen) => set({ addProviderOpen }),
      setCatalogOpen: (catalogOpen) => set({ catalogOpen }),
      setCatalogPrefill: (catalogPrefill) => set({ catalogPrefill }),
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
