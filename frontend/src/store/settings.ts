"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AccentName, EnterBehavior, UserPreferences } from "@/types";
import { applyAccent } from "@/lib/accent";

const ANIMATIONS_KEY = "tollma-animations";

function applyAnimations(enabled: boolean): void {
  if (typeof document === "undefined") return;
  if (enabled) document.documentElement.removeAttribute("data-animations");
  else document.documentElement.setAttribute("data-animations", "off");
  try {
    localStorage.setItem(ANIMATIONS_KEY, enabled ? "on" : "off");
  } catch {
    // storage unavailable
  }
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  accent: "green",
  accent_color: null,
  enter_behavior: "send",
  default_thinking_level: null,
  auto_scroll: true,
  stream_animations: true,
};

interface SettingsState {
  accent: AccentName;
  accentColor: string | null;
  enterBehavior: EnterBehavior;
  defaultThinkingLevel: string | null;
  autoScroll: boolean;
  streamAnimations: boolean;
  /** True once server preferences have been merged (or defaults confirmed). */
  synced: boolean;

  hydrateFromPreferences: (prefs: UserPreferences) => void;
  setAccent: (accent: AccentName, customHex?: string | null) => void;
  setEnterBehavior: (behavior: EnterBehavior) => void;
  setDefaultThinkingLevel: (level: string | null) => void;
  setAutoScroll: (enabled: boolean) => void;
  setStreamAnimations: (enabled: boolean) => void;
  refresh: () => UserPreferences;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      accent: DEFAULT_PREFERENCES.accent,
      accentColor: DEFAULT_PREFERENCES.accent_color,
      enterBehavior: DEFAULT_PREFERENCES.enter_behavior,
      defaultThinkingLevel: DEFAULT_PREFERENCES.default_thinking_level,
      autoScroll: DEFAULT_PREFERENCES.auto_scroll,
      streamAnimations: DEFAULT_PREFERENCES.stream_animations,
      synced: false,

      hydrateFromPreferences: (prefs) => {
        set({
          accent: prefs.accent,
          accentColor: prefs.accent_color,
          enterBehavior: prefs.enter_behavior,
          defaultThinkingLevel: prefs.default_thinking_level,
          autoScroll: prefs.auto_scroll,
          streamAnimations: prefs.stream_animations,
          synced: true,
        });
        applyAccent(prefs.accent, prefs.accent_color);
        applyAnimations(prefs.stream_animations);
      },
      setAccent: (accent, customHex) => {
        const accentColor =
          accent === "custom" ? (customHex ?? get().accentColor) : get().accentColor;
        set({ accent, accentColor });
        applyAccent(accent, accentColor);
      },
      setEnterBehavior: (enterBehavior) => set({ enterBehavior }),
      setDefaultThinkingLevel: (defaultThinkingLevel) => set({ defaultThinkingLevel }),
      setAutoScroll: (autoScroll) => set({ autoScroll }),
      setStreamAnimations: (streamAnimations) => {
        set({ streamAnimations });
        applyAnimations(streamAnimations);
      },
      refresh: () => {
        const s = get();
        return {
          accent: s.accent,
          accent_color: s.accentColor,
          enter_behavior: s.enterBehavior,
          default_thinking_level: s.defaultThinkingLevel,
          auto_scroll: s.autoScroll,
          stream_animations: s.streamAnimations,
        };
      },
    }),
    {
      name: "tollma-settings",
      partialize: (s) => ({
        accent: s.accent,
        accentColor: s.accentColor,
        enterBehavior: s.enterBehavior,
        defaultThinkingLevel: s.defaultThinkingLevel,
        autoScroll: s.autoScroll,
        streamAnimations: s.streamAnimations,
      }),
    },
  ),
);
