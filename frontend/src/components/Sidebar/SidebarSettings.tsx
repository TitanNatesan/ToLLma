"use client";

import Link from "next/link";
import type { ComponentType, MouseEvent } from "react";
import {
  AlertTriangle,
  Building2,
  Cookie,
  FileDown,
  History,
  KeyRound,
  MonitorSmartphone,
  Palette,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsSectionDef {
  hash: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Ordered settings sections. The hashes double as the page anchors
 * (`/settings#<hash>`) and as the settings cards' DOM ids.
 */
export const SETTINGS_SECTIONS = [
  { hash: "profile", label: "Profile", icon: UserRound },
  { hash: "appearance", label: "Appearance", icon: Palette },
  { hash: "chat", label: "Chat", icon: SlidersHorizontal },
  { hash: "account", label: "Account", icon: KeyRound },
  { hash: "sessions", label: "Sessions", icon: MonitorSmartphone },
  { hash: "providers", label: "Providers", icon: Server },
  { hash: "logging", label: "Logging", icon: ScrollText },
  { hash: "privacy", label: "Privacy", icon: ShieldCheck },
  { hash: "retention", label: "Retention", icon: History },
  { hash: "cookies", label: "Cookies", icon: Cookie },
  { hash: "data-rights", label: "Data rights", icon: FileDown },
  { hash: "organizations", label: "Organizations", icon: Building2 },
  { hash: "danger-zone", label: "Danger zone", icon: AlertTriangle },
] as const satisfies readonly SettingsSectionDef[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["hash"];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map(
  (section) => section.hash,
);

/**
 * Same-document anchors, driven natively: Next.js <Link> same-page hash
 * navigation uses history.pushState, which does NOT fire `hashchange` — so
 * every section subscriber would go stale. Assigning window.location.hash
 * directly fires the event and keeps highlights and content in sync.
 */
function navigate(event: MouseEvent<HTMLAnchorElement>, hash: SettingsSectionId) {
  event.preventDefault();
  if (window.location.hash === `#${hash}`) {
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.location.hash = hash;
  }
}

/** Settings context: section shortcuts anchor into the Settings page sections. */
export function SidebarSettings({ activeId }: { activeId: SettingsSectionId }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Settings">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <SlidersHorizontal className="size-3.5 text-zinc-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Settings
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <nav aria-label="Settings sections" data-testid="sidebar-settings-sections">
          <div className="space-y-0.5">
            {SETTINGS_SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = s.hash === activeId;
              return (
                <Link
                  key={s.hash}
                  href={`/settings#${s.hash}`}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => navigate(event, s.hash)}
                  data-testid={`sidebar-settings-${s.hash}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      active ? "text-white dark:text-zinc-900" : "text-zinc-400",
                    )}
                  />
                  <span>{s.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </section>
  );
}
