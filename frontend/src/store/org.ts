"use client";

import { create } from "zustand";

export type ActiveContext = { type: "personal" } | { type: "org"; orgId: string; orgName: string };

const CONTEXT_KEY = "tollma-active-context";

function load(): ActiveContext {
  if (typeof window === "undefined") return { type: "personal" };
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    if (!raw) return { type: "personal" };
    const parsed = JSON.parse(raw) as ActiveContext;
    if (parsed.type === "org" && parsed.orgId) return parsed;
    return { type: "personal" };
  } catch {
    return { type: "personal" };
  }
}

interface OrgState {
  context: ActiveContext;
  /** Switch context and remember it as the last active one. */
  setContext: (c: ActiveContext) => void;
  /** Drop org contexts the user can no longer access (called after org list loads). */
  reconcile: (orgIds: string[]) => void;
}

export const useOrgStore = create<OrgState>()((set) => ({
  context: load(),
  setContext: (context) => {
    try {
      localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
    } catch {
      // storage unavailable
    }
    set({ context });
  },
  reconcile: (orgIds) =>
    set((s) => {
      if (s.context.type === "org" && !orgIds.includes(s.context.orgId)) {
        try {
          localStorage.setItem(CONTEXT_KEY, JSON.stringify({ type: "personal" }));
        } catch {
          // storage unavailable
        }
        return { context: { type: "personal" } as ActiveContext };
      }
      return s;
    }),
}));
