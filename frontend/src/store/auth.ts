"use client";

import { create } from "zustand";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  checked: boolean; // session bootstrap finished
  setUser: (user: User | null) => void;
  setChecked: () => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  checked: false,
  setUser: (user) => set({ user }),
  setChecked: () => set({ checked: true }),
  reset: () => set({ user: null, checked: true }),
}));

export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("tollma_session="));
}
