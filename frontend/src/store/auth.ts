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

export function clearAuthAndCredentialCache(): void {
  if (typeof window === "undefined") return;
  try {
    // Explicitly delete tokens and provider credentials
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("tollma-wizard-draft");
    localStorage.removeItem("tollma_provider_draft");

    // Clear any other auth tokens and provider credentials from localStorage
    // (preserving UI preferences: theme, accent palette, chat settings).
    const KEEP = ["theme", "tollma-accent", "tollma-accent-vars", "tollma-animations", "tollma-settings"];
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        !KEEP.includes(key) &&
        (key.startsWith("tollma") ||
          key.includes("token") ||
          key.includes("cred") ||
          key.includes("provider") ||
          key.includes("draft"))
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
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
    clearAuthAndCredentialCache();
    if (typeof document !== "undefined") {
      document.cookie = "tollma_session=; path=/; max-age=0";
    }
    set({ user: null, accessToken: null, checked: true });
  },
}));

export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("tollma_session="));
}
