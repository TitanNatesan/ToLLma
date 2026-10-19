"use client";

import type { ComponentType, MouseEvent } from "react";
import {
  AlertTriangle,
  Building2,
  KeyRound,
  MonitorSmartphone,
  Palette,
  Server,
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
  { hash: "organizations", label: "Organizations", icon: Building2 },
  { hash: "danger-zone", label: "Danger zone", icon: AlertTriangle },
] as const satisfies readonly SettingsSectionDef[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["hash"];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map(
  (section) => section.hash,
);

/**
 * Same-document anchors: the browser sets the hash and the `scroll-smooth`
 * scroll container performs the smooth scroll (scroll-margin on the cards
 * keeps the sticky header clear). Repeat clicks on the current section are a
 * browser no-op, so scroll manually in that case.
 */
function navigate(event: MouseEvent<HTMLAnchorElement>, hash: SettingsSectionId) {
  if (window.location.hash === `#${hash}`) {
    event.preventDefault();
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
                <a
                  key={s.hash}
                  href={`/settings#${s.hash}`}
                  aria-current={active ? "location" : undefined}
                  onClick={(event) => navigate(event, s.hash)}
                  data-testid={`sidebar-settings-${s.hash}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-tollma-50 text-tollma-800 dark:bg-tollma-950/50 dark:text-tollma-200"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      active ? "text-tollma-600 dark:text-tollma-400" : "text-zinc-400",
                    )}
                  />
                  <span>{s.label}</span>
                </a>
              );
            })}
          </div>
        </nav>
      </div>
    </section>
  );
}
