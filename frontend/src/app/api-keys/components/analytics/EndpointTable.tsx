"use client";

import { fmtCost, fmtTokens } from "@/lib/utils";
import { DataTable, ShareBar, num, type TableColumn } from "./shared";
import type { AnalyticsEndpointRow, ApiKeyAnalyticsSummary } from "@/types/apiKeys";

/** Per-endpoint traffic, spend and share of requests. */
export function EndpointTable({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const rows = summary.endpoints ?? [];
  const totalRequests = rows.reduce((sum, row) => sum + num(row.requests), 0);

  const columns: Array<TableColumn<AnalyticsEndpointRow>> = [
    {
      key: "endpoint",
      header: "Endpoint",
      sortValue: (row) => row.endpoint ?? "",
      render: (row) => (
        <span
          className="block max-w-64 truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300"
          title={row.endpoint}
        >
          {row.endpoint || "unknown endpoint"}
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
      key: "share",
      header: "Share",
      align: "right",
      sortValue: (row) => num(row.share),
      render: (row) => {
        const share = endpointShare(row, totalRequests);
        return (
          <span className="flex items-center justify-end gap-2">
            <ShareBar fraction={share} className="w-16" />
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-500">
              {(share * 100).toFixed(0)}%
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.endpoint ?? "unknown"}
      testId="key-endpoint-table"
      initialSortKey="requests"
      defaultSortDir="desc"
    />
  );
}

/** Prefer the backend share; fall back to requests / total when absent. */
function endpointShare(row: AnalyticsEndpointRow, totalRequests: number): number {
  if (row.share !== null && row.share !== undefined) {
    const raw = num(row.share);
    if (raw > 0) return raw > 1 ? raw / 100 : raw;
  }
  return totalRequests > 0 ? num(row.requests) / totalRequests : 0;
}
