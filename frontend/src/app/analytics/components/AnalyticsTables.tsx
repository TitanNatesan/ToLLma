"use client";

import { Badge } from "@/components/ui";
import { fmtCompactTokens } from "@/lib/utils";
import { fmtMoney, fmtMs, fmtNumber } from "../format";
import type { AnalyticsBreakdownRow, ConversationAnalyticsRow } from "@/types";

export function ModelsTable({ rows }: { rows: AnalyticsBreakdownRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs" data-testid="models-table">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            <th className="py-2 pr-3 font-medium">Model</th>
            <th className="py-2 pr-3 text-right font-medium">Requests</th>
            <th className="py-2 pr-3 text-right font-medium">Spend</th>
            <th className="py-2 pr-3 text-right font-medium">Tokens</th>
            <th className="py-2 pr-3 text-right font-medium">Avg cost</th>
            <th className="py-2 pr-3 text-right font-medium">Avg latency</th>
            <th className="py-2 text-right font-medium">Error rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
              data-testid={`model-row-${row.key}`}
            >
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{row.name}</span>
                  {row.kind && (
                    <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] font-normal">
                      {row.kind}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">{fmtNumber(row.requests)}</td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-800 dark:text-zinc-200">{fmtMoney(row.spend)}</td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">
                {fmtCompactTokens(row.total_tokens)}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">{fmtMoney(row.avg_cost)}</td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">{fmtMs(row.avg_latency_ms)}</td>
              <td className="py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                {(row.error_rate * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-zinc-400">
                No model activity in this range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ProvidersTable({ rows }: { rows: AnalyticsBreakdownRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-xs" data-testid="providers-table">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            <th className="py-2 pr-3 font-medium">Provider</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 text-right font-medium">Requests</th>
            <th className="py-2 pr-3 text-right font-medium">Spend</th>
            <th className="py-2 pr-3 text-right font-medium">Tokens</th>
            <th className="py-2 pr-3 text-right font-medium">Avg latency</th>
            <th className="py-2 pr-3 text-right font-medium">TTFB</th>
            <th className="py-2 text-right font-medium">Error rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
              data-testid={`provider-row-${row.key}`}
            >
              <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-200">{row.name}</td>
              <td className="py-2 pr-3">
                <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal">
                  {row.kind || "—"}
                </Badge>
              </td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">{fmtNumber(row.requests)}</td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-800 dark:text-zinc-200">
                {fmtMoney(row.spend)}
                <span className="ml-1.5 text-zinc-400">{row.share_pct.toFixed(0)}%</span>
              </td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">
                {fmtCompactTokens(row.total_tokens)}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">{fmtMs(row.avg_latency_ms)}</td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-600 dark:text-zinc-400">{fmtMs(row.avg_ttfb_ms)}</td>
              <td className="py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                {(row.error_rate * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-center text-zinc-400">
                No provider activity in this range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface ConversationRankListProps {
  title: string;
  rows: ConversationAnalyticsRow[];
  metric: (row: ConversationAnalyticsRow) => string;
  onOpen: (row: ConversationAnalyticsRow) => void;
  testId?: string;
}

export function ConversationRankList({ title, rows, metric, onOpen, testId }: ConversationRankListProps) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid={testId}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</p>
      <ul className="space-y-1">
        {rows.slice(0, 5).map((row, index) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
              title={row.title}
              data-testid={testId ? `${testId}-${index}` : undefined}
            >
              <span className="w-4 shrink-0 font-mono text-[10px] text-zinc-400">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-zinc-700 dark:text-zinc-300">{row.title}</span>
                <span className="block truncate text-[10px] text-zinc-400">
                  {[row.provider_name, row.model_name].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{metric(row)}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-center text-[11px] text-zinc-400">No conversations in range</li>}
      </ul>
    </div>
  );
}
