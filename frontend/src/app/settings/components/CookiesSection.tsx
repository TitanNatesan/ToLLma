"use client";

import { useState } from "react";
import { Badge, SettingItem, Switch } from "@/components/ui";
import type { CookiePrefs } from "@/types/trust";

const STORAGE_KEY = "tollma-cookie-prefs";

function readPrefs(): CookiePrefs {
  if (typeof window === "undefined") return { analytics: false, marketing: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { analytics: false, marketing: false };
    const parsed = JSON.parse(raw) as Partial<CookiePrefs>;
    return { analytics: parsed.analytics === true, marketing: parsed.marketing === true };
  } catch {
    return { analytics: false, marketing: false };
  }
}

/** Local-first cookie prefs (this device only — no backend, F4 categories). */
export function CookiesSection() {
  const [prefs, setPrefs] = useState<CookiePrefs>(readPrefs);

  function toggle(key: keyof CookiePrefs, next: boolean) {
    const updated = { ...prefs, [key]: next };
    setPrefs(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // storage unavailable — in-memory only
    }
  }

  return (
    <div data-testid="privacy-cookies">
      <p className="pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        Stored on this device only; clearing site data resets them. Session and security cookies are always on.
      </p>
      <SettingItem label="Strictly necessary" description="Session, CSRF, and theme. Always on.">
        <Badge variant="secondary" data-testid="cookie-locked-necessary">Required</Badge>
      </SettingItem>
      <SettingItem label="Analytics" description="Local usage counters used to improve the product.">
        <Switch
          checked={prefs.analytics}
          onCheckedChange={(next) => toggle("analytics", next)}
          aria-label="Analytics cookies"
          data-testid="cookie-toggle-analytics"
        />
      </SettingItem>
      <SettingItem label="Marketing" description="Reserved — no marketing cookies are set today.">
        <Switch
          checked={prefs.marketing}
          onCheckedChange={(next) => toggle("marketing", next)}
          aria-label="Marketing cookies"
          data-testid="cookie-toggle-marketing"
        />
      </SettingItem>
    </div>
  );
}
