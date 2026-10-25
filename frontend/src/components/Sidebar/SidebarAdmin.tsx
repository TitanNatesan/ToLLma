"use client";

import Link from "next/link";
import type { ComponentType, MouseEvent } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Coins,
  Gauge,
  Hash,
  HeartPulse,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Server,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface AdminSectionDef {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Ordered admin dashboard sections. The ids double as the page anchors
 * (`/admin#<id>`) and as the observability sections' DOM ids.
 */
export const ADMIN_SECTIONS = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "usage", label: "Usage", icon: Activity },
  { id: "costs", label: "Costs", icon: Coins },
  { id: "tokens", label: "Tokens", icon: Hash },
  { id: "providers", label: "Providers", icon: Server },
  { id: "catalog", label: "Catalog", icon: BookOpen },
  { id: "models", label: "Models", icon: Layers },
  { id: "users", label: "Users", icon: Users },
  { id: "api-keys", label: "API Keys", icon: KeyRound },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "cache", label: "Cache", icon: Zap },
  { id: "errors", label: "Errors", icon: AlertTriangle },
  { id: "health", label: "Health", icon: HeartPulse },
] as const satisfies readonly AdminSectionDef[];

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];

export const ADMIN_SECTION_IDS: readonly AdminSectionId[] = ADMIN_SECTIONS.map(
  (section) => section.id,
);

/**
 * Same-document anchors, driven natively: Next.js <Link> same-page hash
 * navigation uses history.pushState, which does NOT fire `hashchange` — so
 * every section subscriber (sidebar highlight, page content) would go stale.
 * Assigning window.location.hash directly fires the event and keeps deep
 * links, history, and all subscribers in sync.
 */
function navigate(event: MouseEvent<HTMLAnchorElement>, id: AdminSectionId) {
  event.preventDefault();
  if (window.location.hash === `#${id}`) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.location.hash = id;
  }
}

/** Admin context: one anchor per dashboard section, driven by the URL hash. */
export function SidebarAdmin({ activeId }: { activeId: AdminSectionId }) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-label="Admin navigation"
      data-testid="sidebar-admin"
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        <ShieldCheck className="size-3.5 text-zinc-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Admin Navigation
        </span>
      </div>
      <nav
        aria-label="Admin sections"
        className="flex-1 overflow-y-auto px-2 pb-2"
        data-testid="sidebar-admin-sections"
      >
        <div className="space-y-0.5">
          {ADMIN_SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = id === activeId;
            return (
              <Link
                key={id}
                href={`/admin#${id}`}
                aria-current={active ? "page" : undefined}
                onClick={(event) => navigate(event, id)}
                data-testid={`sidebar-admin-${id}`}
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
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </section>
  );
}
