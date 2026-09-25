"use client";

import { fmtCompactTokens, fmtCost, fmtTokens } from "@/lib/utils";
import { DataTable, fmtMs, num, pct, rate, type TableColumn } from "./shared";
import type { AnalyticsModelRow, ApiKeyAnalyticsSummary } from "@/types/apiKeys";

const columns: Array<TableColumn<AnalyticsModelRow>> = [
  {
    key: "model",
    header: "Model",
    sortValue: (row) => row.model ?? "",
    render: (row) => (
      <div className="min-w-0 max-w-56">
        <p className="truncate font-medium text-zinc-800 dark:text-zinc-200" title={row.model}>
          {row.model || "unknown model"}
        </p>
        {row.provider && <p className="truncate text-[10px] text-zinc-400">{row.provider}</p>}
      </div>
    ),
  },
  {
    key: "requests",
    header: "Requests",
    align: "right",
    sortValue: (row) => num(row.requests),
    render: (row) => <span className="font-mono">{fmtTokens(row.requests)}</span>,
  },
  {
    key: "spend",
    header: "Spend",
    align: "right",
    sortValue: (row) => num(row.spend),
    render: (row) => <span className="font-mono">{fmtCost(row.spend)}</span>,
  },
  {
    key: "tokens",
    header: "Tokens",
    align: "right",
    sortValue: (row) => num(row.tokens),
    render: (row) => <span className="font-mono">{fmtCompactTokens(row.tokens)}</span>,
  },
  {
    key: "latency",
    header: "Avg latency",
    align: "right",
    sortValue: (row) => num(row.avg_latency_ms),
    render: (row) => <span className="font-mono">{fmtMs(row.avg_latency_ms)}</span>,
  },
  {
    key: "success_rate",
    header: "Success",
    align: "right",
    sortValue: (row) => rate(row.success_rate),
    render: (row) => (
      <span
        className={
          rate(row.success_rate) >= 0.99
            ? "font-mono text-emerald-600 dark:text-emerald-400"
            : "font-mono text-zinc-600 dark:text-zinc-300"
        }
      >
        {row.success_rate === null || row.success_rate === undefined ? "—" : pct(row.success_rate)}
      </span>
    ),
  },
];

/** Per-model traffic, spend, tokens, latency and success rate. */
export function ModelTable({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  return (
    <DataTable
      columns={columns}
      rows={summary.models ?? []}
      rowKey={(row) => `${row.provider ?? ""}:${row.model ?? ""}`}
      testId="key-model-table"
      initialSortKey="requests"
      defaultSortDir="desc"
    />
  );
}
