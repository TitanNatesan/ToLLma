"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatState {
  providerId: string | null;
  modelId: string | null;
  activeConversationId: string | null;
  sidebarSearch: string;
  streaming: boolean;
  setProvider: (id: string | null) => void;
  setModel: (id: string | null) => void;
  setConversation: (id: string | null) => void;
  setSearch: (s: string) => void;
  setStreaming: (b: boolean) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      providerId: null,
      modelId: null,
      activeConversationId: null,
      sidebarSearch: "",
      streaming: false,
      setProvider: (providerId) => set({ providerId, modelId: null }),
      setModel: (modelId) => set({ modelId }),
      setConversation: (activeConversationId) => set({ activeConversationId }),
      setSearch: (sidebarSearch) => set({ sidebarSearch }),
      setStreaming: (streaming) => set({ streaming }),
    }),
    { name: "tollms-chat" },
  ),
);
