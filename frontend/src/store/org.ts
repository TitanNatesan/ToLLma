"use client";

import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

export type ActiveContext = { type: "personal" } | { type: "org"; orgId: string; orgName: string };

const CONTEXT_KEY = "tollma-active-context";

/** Scope-dependent caches: personal↔org switches must refetch these. */
const SCOPE_KEYS: string[][] = [
  ["chat-keys"],
  ["chat-key-models"],
  ["providers"],
  ["models"],
  ["conversations"],
  ["orgs"],
];

function invalidateScopeCaches() {
  if (!scopeClient) return;
  for (const key of SCOPE_KEYS) {
    void scopeClient.invalidateQueries({ queryKey: key });
  }
}

/** React Query client for scope invalidations. Registered by a component
 * inside QueryProvider (AppShell); the store itself lives outside React. */
let scopeClient: QueryClient | null = null;

export function registerScopeClient(qc: QueryClient | null) {
  scopeClient = qc;
}

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

function sameContext(a: ActiveContext, b: ActiveContext) {
  return a.type === b.type && (b.type === "personal" || (a.type === "org" && a.orgId === b.orgId));
}

interface OrgState {
  context: ActiveContext;
  /** Switch context and remember it as the last active one. */
  setContext: (c: ActiveContext) => void;
  /** Drop org contexts the user can no longer access (called after org list loads). */
  reconcile: (orgIds: string[]) => void;
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  context: load(),
  setContext: (context) => {
    if (sameContext(get().context, context)) return;
    try {
      localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
    } catch {
      // storage unavailable
    }
    set({ context });
    invalidateScopeCaches();
  },
  reconcile: (orgIds) =>
    set((s) => {
      if (s.context.type === "org" && !orgIds.includes(s.context.orgId)) {
        try {
          localStorage.setItem(CONTEXT_KEY, JSON.stringify({ type: "personal" }));
        } catch {
          // storage unavailable
        }
        // Forced flip must not serve the previous scope's data either.
        invalidateScopeCaches();
        return { context: { type: "personal" } as ActiveContext };
      }
      return s;
    }),
}));
