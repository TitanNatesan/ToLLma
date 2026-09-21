"use client";

import { Download, GitBranch, History, Pencil, Share2 } from "lucide-react";
import { SectionCard } from "./KpiCard";
import { fmtNumber } from "../format";
import type { AnalyticsWidgets } from "@/types";

export interface AnalyticsWidgetsPanelProps {
  widgets?: AnalyticsWidgets;
}

const COUNTERS = [
  { key: "regeneration_count", label: "Regenerations", icon: History, testId: "widget-regenerations" },
  { key: "edit_count", label: "Message edits", icon: Pencil, testId: "widget-edits" },
  { key: "branch_count", label: "Branches", icon: GitBranch, testId: "widget-branches" },
  { key: "shared_conversations", label: "Shared conversations", icon: Share2, testId: "widget-shares" },
  { key: "export_count", label: "Exports", icon: Download, testId: "widget-exports" },
] as const;

/** Conversation-intelligence counters: history, branching, sharing, exports. */
export function AnalyticsWidgetsPanel({ widgets }: AnalyticsWidgetsPanelProps) {
  if (!widgets) return null;

  return (
    <SectionCard
      id="intelligence"
      title="Conversation intelligence"
      description="Editing, regeneration, branching, sharing and export activity in this range."
      testId="analytics-widgets"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {COUNTERS.map((counter) => {
          const Icon = counter.icon;
          return (
            <div
              className="rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
              data-testid={counter.testId}
              key={counter.key}
            >
              <span className="inline-flex items-center gap-1.5 text-[10px] tracking-wide text-zinc-400 uppercase">
                <Icon className="size-3" />
                {counter.label}
              </span>
              <p className="mt-1 text-lg font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {fmtNumber(widgets[counter.key])}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            Most regenerated conversations
          </p>
          {widgets.most_regenerated.length === 0 ? (
            <p className="text-xs text-zinc-400">No regenerations in this range.</p>
          ) : (
            <ul className="space-y-1" data-testid="widget-most-regenerated">
              {widgets.most_regenerated.map((row) => (
                <li
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800"
                  key={row.conversation_id}
                >
                  <span className="min-w-0 truncate">{row.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                    {row.regeneration_count}×
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            Most edited messages
          </p>
          {widgets.most_edited.length === 0 ? (
            <p className="text-xs text-zinc-400">No edits in this range.</p>
          ) : (
            <ul className="space-y-1" data-testid="widget-most-edited">
              {widgets.most_edited.map((row) => (
                <li
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800"
                  key={row.message_id}
                >
                  <span className="min-w-0 truncate">{row.conversation_title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                    v{row.version_count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
