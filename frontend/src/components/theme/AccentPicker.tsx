"use client";

import { useState } from "react";
import { Check, Palette } from "lucide-react";
import { toast } from "@/lib/notify";
import { Input, SettingItem } from "@/components/ui";
import { useUpdatePreferences } from "@/hooks/useSettings";
import { ACCENT_BASES, ACCENT_ORDER, HEX_COLOR_RE, hslToHex, hexToHsl } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import type { AccentName } from "@/types";

/** Accent color picker (server-synced). Appearance theming lives in the glass engine. */
export function AccentPicker() {
  const accent = useSettingsStore((s) => s.accent);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const update = useUpdatePreferences();
  const [customHex, setCustomHex] = useState(() =>
    accentColor && HEX_COLOR_RE.test(accentColor) ? accentColor : "#6366f1",
  );

  function choose(accentName: AccentName, custom?: string) {
    update.mutate(
      { accent: accentName, ...(custom ? { accent_color: custom } : {}) },
      { onError: (e) => toast.error("Could not save accent", { description: e.message }) },
    );
  }

  function chooseCustom(hex: string) {
    setCustomHex(hex);
    if (HEX_COLOR_RE.test(hex)) choose("custom", hex.toLowerCase());
  }

  const customPreview = (() => {
    const { h, s, l } = hexToHsl(HEX_COLOR_RE.test(customHex) ? customHex : "#6366f1");
    return hslToHex(h, s, l * 0.855);
  })();

  return (
    <>
      <SettingItem
        label="Accent color"
        description="Applies instantly to buttons, links, focus rings, sliders and charts."
      >
        <div className="flex items-center gap-1.5" data-testid="settings-accent-picker">
          {ACCENT_ORDER.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => choose(name)}
              aria-label={`${name} accent`}
              aria-pressed={accent === name}
              data-testid={`accent-${name}`}
              className={cn(
                "flex size-6 items-center justify-center rounded-full border transition-transform hover:scale-110",
                accent === name ? "border-zinc-400 ring-2 ring-zinc-300 dark:ring-zinc-700" : "border-transparent",
              )}
              style={{ background: ACCENT_BASES[name] }}
            >
              {accent === name && <Check className="size-3.5 text-white" />}
            </button>
          ))}

          <label
            className={cn(
              "relative flex size-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-transform hover:scale-110",
              accent === "custom"
                ? "border-zinc-400 ring-2 ring-zinc-300 dark:ring-zinc-700"
                : "border-transparent",
            )}
            style={{ background: `conic-gradient(from 180deg, #ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444)` }}
            title="Custom color"
          >
            <Palette className="size-3 text-white drop-shadow" />
            <input
              type="color"
              value={customHex}
              onChange={(e) => chooseCustom(e.target.value)}
              aria-label="Custom accent color"
              data-testid="accent-custom"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {accent === "custom" && (
              <span
                className="pointer-events-none absolute -bottom-1 -right-1 size-2.5 rounded-full border border-white dark:border-zinc-900"
                style={{ background: customPreview }}
              />
            )}
          </label>
        </div>
      </SettingItem>

      {accent === "custom" && (
        <SettingItem label="Custom accent" description="Pick any color — shades derive automatically.">
          <div className="flex items-center gap-2">
            <span
              className="size-6 rounded-md border border-zinc-200 dark:border-zinc-700"
              style={{ background: HEX_COLOR_RE.test(customHex) ? customHex : "#6366f1" }}
            />
            <Input
              value={customHex}
              onChange={(e) => {
                setCustomHex(e.target.value);
                if (HEX_COLOR_RE.test(e.target.value.trim())) choose("custom", e.target.value.trim().toLowerCase());
              }}
              aria-label="Custom accent hex"
              data-testid="accent-custom-hex"
              className="h-8 w-28 font-mono text-xs"
              spellCheck={false}
            />
          </div>
        </SettingItem>
      )}
    </>
  );
}
