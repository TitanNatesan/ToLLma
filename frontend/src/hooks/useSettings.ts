"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePassword,
  getPreferences,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updatePreferences,
  updateProfile,
} from "@/services/api";
import { useAuthStore } from "@/store/auth";
import { useSettingsStore } from "@/store/settings";
import type { UserPreferences } from "@/types";

export function preferencesQueryKey() {
  return ["settings", "preferences"] as const;
}

/** Server preferences -> local store (accent + chat behavior apply immediately). */
export function usePreferencesSync(enabled: boolean) {
  return useQuery({
    queryKey: preferencesQueryKey(),
    queryFn: async () => {
      const prefs = await getPreferences();
      useSettingsStore.getState().hydrateFromPreferences(prefs);
      return prefs;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Persist one preference change: apply locally first (instant UI), then patch
 * the server and reconcile. On failure the local value is reverted.
 */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserPreferences>) => updatePreferences(patch),
    onMutate: (patch) => {
      const store = useSettingsStore.getState();
      const previous = store.refresh();
      if (patch.accent !== undefined) store.setAccent(patch.accent, patch.accent_color ?? null);
      if (patch.enter_behavior !== undefined) store.setEnterBehavior(patch.enter_behavior);
      if (patch.default_thinking_level !== undefined) store.setDefaultThinkingLevel(patch.default_thinking_level);
      if (patch.auto_scroll !== undefined) store.setAutoScroll(patch.auto_scroll);
      if (patch.stream_animations !== undefined) store.setStreamAnimations(patch.stream_animations);
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) useSettingsStore.getState().hydrateFromPreferences(context.previous);
    },
    onSuccess: (prefs) => {
      useSettingsStore.getState().hydrateFromPreferences(prefs);
      qc.setQueryData(preferencesQueryKey(), prefs);
    },
  });
}

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => setUser(user),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}

export function sessionsQueryKey() {
  return ["settings", "sessions"] as const;
}

export function useSessions() {
  return useQuery({ queryKey: sessionsQueryKey(), queryFn: listSessions });
}

export function useSessionMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: sessionsQueryKey() });
  return {
    revoke: useMutation({ mutationFn: revokeSession, onSuccess: invalidate }),
    revokeOthers: useMutation({ mutationFn: revokeOtherSessions, onSuccess: invalidate }),
  };
}
