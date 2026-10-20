"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Boxes,
  Gauge,
  Hash,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Server,
  Wallet,
} from "lucide-react";

const REPORTS = [
  { hash: "summary", label: "Overview", icon: LayoutDashboard },
  { hash: "cost", label: "Cost", icon: Wallet },
  { hash: "usage", label: "Usage", icon: BarChart3 },
  { hash: "tokens", label: "Tokens", icon: Hash },
  { hash: "performance", label: "Performance", icon: Gauge },
  { hash: "models", label: "Models", icon: Boxes },
  { hash: "providers", label: "Providers", icon: Server },
  { hash: "conversations", label: "Conversations", icon: MessageSquare },
];

export const ANALYTICS_REPORT_IDS = REPORTS.map((r) => r.hash);

export type AnalyticsReportId = (typeof REPORTS)[number]["hash"];

/** Analytics context: report shortcuts anchor into the Analytics page sections. */
export function SidebarAnalytics({ activeId }: { activeId: AnalyticsReportId }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Analytics">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <BarChart3 className="size-3.5 text-zinc-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Analytics
        </span>
      </div>
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Available Reports
      </p>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            const active = r.hash === activeId;
            return (
              <Link
                key={r.hash}
                href={`/analytics#${r.hash}`}
                aria-current={active ? "page" : undefined}
                data-testid={`sidebar-report-${r.hash}`}
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
                <span>{r.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-400">
          <Layers className="size-3.5 shrink-0 opacity-60" />
          <span>Aggregated server-side</span>
        </div>
      </div>
    </section>
  );
}
