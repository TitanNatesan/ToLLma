"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatKeyProblem } from "@/types";

/**
 * Selected chat API key. Colocated with the composer (not in src/store) so
 * the chat feature owns its persisted selection end to end; mirrors the
 * tollma-chat store conventions (zustand + persist, minimal partialize).
 */
interface ChatKeyState {
  keyId: string | null;
  /** Latest gateway key denial awaiting re-selection (null once resolved). */
  problem: ChatKeyProblem | null;
  problemAt: number | null;

  /** Selecting a key resolves any outstanding problem (explicit choice). */
  setKey: (id: string | null) => void;
  flagProblem: (problem: ChatKeyProblem) => void;
  clearProblem: () => void;
}

export const useChatKeyStore = create<ChatKeyState>()(
  persist(
    (set) => ({
      keyId: null,
      problem: null,
      problemAt: null,

      setKey: (keyId) => set({ keyId, problem: null, problemAt: null }),
      flagProblem: (problem) => set({ problem, problemAt: Date.now() }),
      clearProblem: () => set({ problem: null, problemAt: null }),
    }),
    {
      name: "tollma-chat-key",
      partialize: (s) => ({ keyId: s.keyId }),
    },
  ),
);
