"use client";

import { fmtCompactTokens, fmtCost, fmtTokens } from "@/lib/utils";
import { DataTable, fmtMs, num, pct, rate, type TableColumn } from "./shared";
import type { ApiKeyAnalyticsSummary, AnalyticsProviderRow } from "@/types/apiKeys";

const columns: Array<TableColumn<AnalyticsProviderRow>> = [
  {
    key: "provider",
    header: "Provider",
    sortValue: (row) => row.provider ?? "",
    render: (row) => (
      <span className="block max-w-56 truncate font-medium text-zinc-800 dark:text-zinc-200" title={row.provider}>
        {row.provider || "unknown provider"}
      </span>
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
    key: "error_rate",
    header: "Errors",
    align: "right",
    sortValue: (row) => rate(row.error_rate),
    render: (row) => (
      <span className={rate(row.error_rate) > 0 ? "font-mono text-red-600 dark:text-red-400" : "font-mono text-zinc-400"}>
        {rate(row.error_rate) > 0 ? pct(rate(row.error_rate)) : "—"}
      </span>
    ),
  },
];

/** Per-provider traffic, spend, latency and error rate. */
export function ProviderTable({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  return (
    <DataTable
      columns={columns}
      rows={summary.providers ?? []}
      rowKey={(row) => row.provider ?? "unknown"}
      testId="key-provider-table"
      initialSortKey="requests"
      defaultSortDir="desc"
    />
  );
}
