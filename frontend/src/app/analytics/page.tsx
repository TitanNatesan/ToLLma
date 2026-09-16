"use client";

import { BarChart3, Boxes, Server, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";

const REPORTS = [
  {
    id: "usage",
    title: "Usage",
    icon: BarChart3,
    description: "Token consumption across conversations, models, and providers.",
  },
  {
    id: "cost",
    title: "Cost",
    icon: Wallet,
    description: "Spend breakdown per model, provider, and time range.",
  },
  {
    id: "models",
    title: "Models",
    icon: Boxes,
    description: "Per-model traffic, cost, and performance overview.",
  },
  {
    id: "providers",
    title: "Providers",
    icon: Server,
    description: "Per-provider health, latency, and usage comparison.",
  },
];

/** Analytics landing page. Report sections are anchored for sidebar shortcuts. */
export default function AnalyticsPage() {
  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
      data-testid="analytics-page"
    >
      <PageHeader
        title="Analytics"
        subtitle="Usage and cost intelligence for your models and providers."
      />
      <div className="mt-4 flex flex-col gap-4 pb-8">
        {REPORTS.map((r) => (
          <section key={r.id} id={r.id} className="scroll-mt-4">
            <EmptyState
              icon={r.icon}
              title={`${r.title} report`}
              description={`${r.description} Coming soon.`}
              testId={`analytics-section-${r.id}`}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
