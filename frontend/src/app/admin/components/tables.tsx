"use client";

import { CheckCircle2, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui";
import { DataTable, type DataTableColumn } from "./DataTable";
import { StatusPill } from "./HealthPanel";
import {
  fmtBytes,
  fmtCompact,
  fmtMoney,
  fmtMs,
  fmtNumber,
  fmtPercent,
  fmtRate,
  fmtRelative,
} from "./format";
import type {
  AdminCacheRow,
  AdminErrorRow,
  AdminMediaRow,
  AdminModelRow,
  AdminProviderRow,
  AdminUserRow,
} from "@/types/admin";

const nameCell = (primary: string, secondary?: string | null) => (
  <div className="min-w-0 max-w-64">
    <p className="truncate font-medium text-zinc-800 dark:text-zinc-200">{primary}</p>
    {secondary && <p className="truncate text-[10px] text-zinc-400">{secondary}</p>}
  </div>
);

const errorRateCell = (rate: number) =>
  rate > 0 ? (
    <span className="text-red-600 dark:text-red-400">{fmtPercent(rate)}</span>
  ) : (
    <span className="text-zinc-400">—</span>
  );

const MODEL_COLUMNS: Array<DataTableColumn<AdminModelRow>> = [
  {
    key: "model",
    header: "Model",
    render: (row) => nameCell(row.model_name, row.provider_name),
  },
  { key: "requests", header: "Requests", align: "right", render: (row) => fmtNumber(row.requests) },
  { key: "tokens", header: "Tokens", align: "right", render: (row) => fmtCompact(row.total_tokens) },
  { key: "cache", header: "Cache read", align: "right", render: (row) => fmtCompact(row.cache_read_tokens) },
  { key: "cost", header: "Cost", align: "right", render: (row) => fmtMoney(row.total_cost) },
  { key: "error_rate", header: "Errors", align: "right", render: (row) => errorRateCell(row.error_rate) },
  { key: "latency", header: "Avg latency", align: "right", render: (row) => fmtMs(row.avg_latency_ms) },
];

const PROVIDER_COLUMNS: Array<DataTableColumn<AdminProviderRow>> = [
  {
    key: "provider",
    header: "Provider",
    render: (row) => (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{row.provider_name}</span>
        {row.provider_type && (
          <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase">
            {row.provider_type}
          </Badge>
        )}
      </div>
    ),
  },
  { key: "requests", header: "Requests", align: "right", render: (row) => fmtNumber(row.requests) },
  { key: "tokens", header: "Tokens", align: "right", render: (row) => fmtCompact(row.total_tokens) },
  { key: "cost", header: "Cost", align: "right", render: (row) => fmtMoney(row.total_cost) },
  { key: "error_rate", header: "Errors", align: "right", render: (row) => errorRateCell(row.error_rate) },
  { key: "latency", header: "Avg latency", align: "right", render: (row) => fmtMs(row.avg_latency_ms) },
];

const USER_COLUMNS: Array<DataTableColumn<AdminUserRow>> = [
  {
    key: "user",
    header: "User",
    render: (row) => nameCell(row.email ?? "Deleted user", row.user_id ? undefined : "anonymous"),
  },
  { key: "requests", header: "Requests", align: "right", render: (row) => fmtNumber(row.requests) },
  { key: "conversations", header: "Chats", align: "right", render: (row) => fmtNumber(row.conversations) },
  { key: "tokens", header: "Tokens", align: "right", render: (row) => fmtCompact(row.total_tokens) },
  { key: "cache", header: "Cache read", align: "right", render: (row) => fmtCompact(row.cache_read_tokens) },
  { key: "cost", header: "Cost", align: "right", render: (row) => fmtMoney(row.total_cost) },
  { key: "last_active", header: "Last active", align: "right", render: (row) => fmtRelative(row.last_active_at) },
];

const CACHE_COLUMNS: Array<DataTableColumn<AdminCacheRow>> = [
  { key: "name", header: "Model", render: (row) => nameCell(row.name) },
  { key: "requests", header: "Requests", align: "right", render: (row) => fmtNumber(row.requests) },
  { key: "cached", header: "Cached tokens", align: "right", render: (row) => fmtCompact(row.cached_tokens) },
  { key: "writes", header: "Cache writes", align: "right", render: (row) => fmtCompact(row.cache_write_tokens) },
  { key: "savings", header: "Savings", align: "right", render: (row) => fmtMoney(row.savings) },
  { key: "hit_rate", header: "Hit rate", align: "right", render: (row) => fmtRate(row.hit_rate) },
  {
    key: "supports_caching",
    header: "Caching",
    render: (row) =>
      row.supports_caching ? (
        <CheckCircle2 className="size-3.5 text-tollma-500" aria-label="Caching supported" />
      ) : (
        <MinusCircle className="size-3.5 text-zinc-300 dark:text-zinc-600" aria-label="Caching not supported" />
      ),
  },
];

const MEDIA_COLUMNS: Array<DataTableColumn<AdminMediaRow>> = [
  { key: "model", header: "Model", render: (row) => nameCell(row.model_name) },
  {
    key: "kind",
    header: "Kind",
    render: (row) => (
      <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase">
        {row.kind}
      </Badge>
    ),
  },
  { key: "count", header: "Count", align: "right", render: (row) => fmtNumber(row.count) },
  { key: "bytes", header: "Size", align: "right", render: (row) => fmtBytes(row.media_bytes) },
  { key: "cost", header: "Cost", align: "right", render: (row) => fmtMoney(row.cost) },
];

const ERROR_COLUMNS: Array<DataTableColumn<AdminErrorRow>> = [
  { key: "code", header: "Error", render: (row) => nameCell(row.error_code) },
  { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
  { key: "provider", header: "Provider", render: (row) => row.provider_name ?? "—" },
  { key: "model", header: "Model", render: (row) => row.model_name ?? "—" },
  { key: "count", header: "Count", align: "right", render: (row) => fmtNumber(row.count) },
  { key: "last_seen", header: "Last seen", align: "right", render: (row) => fmtRelative(row.last_seen_at) },
];

export function ModelsTable({ rows, testId = "admin-models-table" }: { rows: AdminModelRow[]; testId?: string }) {
  return (
    <DataTable
      columns={MODEL_COLUMNS}
      rows={rows}
      rowKey={(row) => row.model_id ?? `${row.model_name}-${row.provider_name ?? ""}`}
      testId={testId}
    />
  );
}

export function ProvidersTable({
  rows,
  testId = "admin-providers-table",
}: {
  rows: AdminProviderRow[];
  testId?: string;
}) {
  return (
    <DataTable
      columns={PROVIDER_COLUMNS}
      rows={rows}
      rowKey={(row) => row.provider_id ?? row.provider_name}
      testId={testId}
    />
  );
}

export function UsersTable({ rows, testId = "admin-users-table" }: { rows: AdminUserRow[]; testId?: string }) {
  return (
    <DataTable
      columns={USER_COLUMNS}
      rows={rows}
      rowKey={(row) => row.user_id ?? row.email ?? "unknown"}
      testId={testId}
    />
  );
}

export function CacheTable({ rows, testId = "admin-cache-table" }: { rows: AdminCacheRow[]; testId?: string }) {
  return (
    <DataTable
      columns={CACHE_COLUMNS}
      rows={rows}
      rowKey={(row) => row.key ?? row.name}
      testId={testId}
    />
  );
}

export function MediaTable({ rows, testId = "admin-media-table" }: { rows: AdminMediaRow[]; testId?: string }) {
  return (
    <DataTable
      columns={MEDIA_COLUMNS}
      rows={rows}
      rowKey={(row) => `${row.model_id ?? row.model_name}-${row.kind}`}
      testId={testId}
    />
  );
}

export function ErrorsTable({ rows, testId = "admin-errors-table" }: { rows: AdminErrorRow[]; testId?: string }) {
  return (
    <DataTable
      columns={ERROR_COLUMNS}
      rows={rows}
      rowKey={(row) =>
        `${row.error_code}-${row.status}-${row.provider_name ?? ""}-${row.model_name ?? ""}`
      }
      emptyMessage="No errors in this range"
      testId={testId}
    />
  );
}
