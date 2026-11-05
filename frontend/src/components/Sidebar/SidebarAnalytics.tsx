"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Boxes,
  Gauge,
  Hash,
  Layers,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Server,
  Users,
  Wallet,
} from "lucide-react";
import { useOrgStore } from "@/store/org";

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

/**
 * Same-document anchors, driven natively: Next.js <Link> same-page hash
 * navigation does not fire `hashchange`, which would leave the active
 * highlight stale. Assigning window.location.hash fires it.
 */
function navigate(event: MouseEvent<HTMLAnchorElement>, hash: AnalyticsReportId) {
  event.preventDefault();
  if (window.location.hash === `#${hash}`) {
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.location.hash = hash;
  }
}

/** Analytics context: report shortcuts anchor into the Analytics page sections. */
export function SidebarAnalytics({ activeId }: { activeId: AnalyticsReportId }) {
  const context = useOrgStore((s) => s.context);
  if (context.type === "org") {
    return <OrgAnalyticsNav orgName={context.orgName} />;
  }
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
                onClick={(event) => navigate(event, r.hash)}
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

/**
 * Org scope: every item scrolls to a real dashboard section
 * (`OrgAnalyticsDashboard` oas-* anchors). Personal `#hash` reports do not
 * exist on the org page, so they are not shown here.
 */
const ORG_SECTIONS = [
  { id: "oas-overview", label: "Overview", icon: LayoutDashboard },
  { id: "oas-timeline", label: "Usage over time", icon: BarChart3 },
  { id: "oas-breakdown", label: "Breakdown", icon: Layers },
  { id: "oas-members", label: "Members", icon: Users },
  { id: "oas-insights", label: "Insights", icon: Lightbulb },
  { id: "oas-budget", label: "Budget", icon: Wallet },
] as const;

function OrgAnalyticsNav({ orgName }: { orgName: string }) {
  const [activeId, setActiveId] = useState<string>("oas-overview");

  function scrollTo(id: string) {
    setActiveId(id);
    // Buttons, not hash links: no URL pollution and no interference with
    // the personal sidebar's hash-driven highlight.
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Organization analytics">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <BarChart3 className="size-3.5 text-zinc-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Analytics
        </span>
      </div>
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Organization reports
      </p>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          {ORG_SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                aria-current={active ? "true" : undefined}
                data-testid={`sidebar-org-report-${s.id}`}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors",
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
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-400" title={orgName}>
          <Layers className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">Scoped to {orgName}</span>
        </div>
      </div>
    </section>
  );
}
