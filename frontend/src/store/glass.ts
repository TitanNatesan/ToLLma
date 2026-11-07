"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyGlassTheme, clampGlass } from "@/lib/glass";

export type GlassAppearance = "light" | "dark";

export type NotificationPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export const NOTIFICATION_POSITIONS: readonly NotificationPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export interface GlassConfig {
  appearance: GlassAppearance;
  transparencyEnabled: boolean;
  transparency: number;
  blur: number;
  refraction: number;
  depth: number;
  notificationPosition: NotificationPosition;
}

export const DEFAULT_GLASS: GlassConfig = {
  appearance: "dark",
  transparencyEnabled: true,
  transparency: 25,
  blur: 16,
  refraction: 35,
  depth: 30,
  notificationPosition: "bottom-right",
};

const LEGACY_THEME_KEY = "theme";

function writeLegacyTheme(appearance: GlassAppearance): void {
  try {
    localStorage.setItem(LEGACY_THEME_KEY, appearance === "light" ? "light" : "dark");
  } catch {
    // storage unavailable — theme still applies for this session
  }
}

interface GlassState {
  config: GlassConfig;
  userId: string | null;
  hydrated: boolean;
  setUser: (id: string | null) => void;
  update: (patch: Partial<GlassConfig>) => void;
  reset: () => void;
}

export const useGlassStore = create<GlassState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_GLASS },
      userId: null,
      hydrated: false,

      setUser: (id) => {
        if (get().userId === id) return;
        set({ userId: id, config: { ...DEFAULT_GLASS } });
      },
      update: (patch) => {
        const config = clampGlass({ ...get().config, ...patch });
        set({ config });
        applyGlassTheme(config);
        writeLegacyTheme(config.appearance);
      },
      reset: () => {
        const config = { ...DEFAULT_GLASS };
        set({ config });
        applyGlassTheme(config);
        writeLegacyTheme(config.appearance);
      },
    }),
    {
      name: "tollma-glass",
      partialize: (s) => ({ config: s.config, userId: s.userId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<GlassState, "config" | "userId">>;
        return {
          ...current,
          config: p.config ? clampGlass({ ...DEFAULT_GLASS, ...p.config }) : current.config,
          userId: typeof p.userId === "string" ? p.userId : null,
          hydrated: true,
        };
      },
      // Re-apply on boot: layout script restores classes for a flash-free
      // first paint, but only the engine knows the full var set (blur,
      // transparency, refraction, depth) — paint it once rehydrated.
      onRehydrateStorage: () => (state) => {
        if (state) applyGlassTheme(state.config);
      },
    },
  ),
);

// The engine owns the DOM: every store change re-applies the theme.
useGlassStore.subscribe((s) => applyGlassTheme(s.config));
