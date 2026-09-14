"use client";

import { create } from "zustand";
import type { User } from "@/types";

const TOKEN_KEY = "tollma_access_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // storage unavailable
  }
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  checked: boolean; // session bootstrap finished
  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  setChecked: () => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: getAccessToken(),
  checked: false,
  setUser: (user) => set({ user }),
  setAccessToken: (accessToken) => {
    setStoredAccessToken(accessToken);
    set({ accessToken });
  },
  setChecked: () => set({ checked: true }),
  reset: () => {
    setStoredAccessToken(null);
    set({ user: null, accessToken: null, checked: true });
  },
}));

export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("tollma_session="));
}
