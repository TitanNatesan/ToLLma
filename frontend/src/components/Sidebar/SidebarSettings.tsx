"use client";

import Link from "next/link";
import {
  KeyRound,
  MonitorSmartphone,
  Palette,
  Server,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

const SECTIONS = [
  { hash: "profile", label: "Profile", icon: UserRound },
  { hash: "appearance", label: "Appearance", icon: Palette },
  { hash: "chat", label: "Chat", icon: SlidersHorizontal },
  { hash: "account", label: "Account", icon: KeyRound },
  { hash: "sessions", label: "Sessions", icon: MonitorSmartphone },
  { hash: "providers", label: "Providers", icon: Server },
];

/** Settings context: section shortcuts anchor into the Settings page sections. */
export function SidebarSettings() {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Settings">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <SlidersHorizontal className="size-3.5 text-zinc-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Settings
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.hash}
                href={`/settings#${s.hash}`}
                data-testid={`sidebar-settings-${s.hash}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <Icon className="size-3.5 shrink-0 text-zinc-400" />
                <span>{s.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
