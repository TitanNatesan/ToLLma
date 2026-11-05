"use client";

import { useMemo } from "react";
import {
  CircleCheck,
  Clock,
  KeyRound,
  PowerOff,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { ApiError } from "@/services/api";
import { DataTable, type DataTableColumn } from "./DataTable";
import { DonutBreakdown } from "./DonutBreakdown";
import {
  fmtBucket,
  fmtCompact,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  fmtRate,
  toNumber,
  truncateLabel,
} from "./format";
import { KpiCard } from "./KpiCard";
import { SectionCard } from "./SectionCard";
import { StatGrid } from "@/components/ui/Grids";
import { TrendChart } from "./TrendChart";
import type {
  AdminApiKeyCacheRow,
  AdminApiKeyErrorRow,
  AdminApiKeyTopRow,
  AdminApiKeys,
} from "@/types/admin";

function keyCell(primary: string, secondary?: string | null) {
  return (
    <div className="min-w-0 max-w-56">
      <p className="truncate font-medium text-zinc-800 dark:text-zinc-200">{primary}</p>
      {secondary && <p className="truncate font-mono text-[10px] text-zinc-400">{secondary}</p>}
    </div>
  );
}

const TOP_KEY_COLUMNS: Array<DataTableColumn<AdminApiKeyTopRow>> = [
  { key: "key", header: "Key", render: (row) => keyCell(row.name, row.key_id) },
  { key: "requests", header: "Requests", align: "right", render: (row) => fmtNumber(row.requests) },
  { key: "tokens", header: "Tokens", align: "right", render: (row) => fmtCompact(row.tokens) },
  { key: "spend", header: "Spend", align: "right", render: (row) => fmtMoney(row.spend) },
];

const ERROR_COLUMNS: Array<DataTableColumn<AdminApiKeyErrorRow>> = [
  { key: "key", header: "Key", render: (row) => keyCell(row.name, row.key_id) },
  {
    key: "errors",
    header: "Errors",
    align: "right",
    render: (row) =>
      row.errors > 0 ? (
        <span className="text-red-600 dark:text-red-400">{fmtNumber(row.errors)}</span>
      ) : (
        <span className="text-zinc-400">—</span>
      ),
  },
  { key: "error_rate", header: "Error rate", align: "right", render: (row) => fmtPercent(row.error_rate) },
];

const CACHE_COLUMNS: Array<DataTableColumn<AdminApiKeyCacheRow>> = [
  { key: "key", header: "Key", render: (row) => keyCell(row.name, row.key_id) },
  {
    key: "savings",
    header: "Cache savings",
    align: "right",
    render: (row) => (
      <span className="text-tollma-600 dark:text-tollma-400">{fmtMoney(row.savings)}</span>
    ),
  },
];

function unavailableCopy(error: unknown): { title: string; description: string } {
  if (error instanceof ApiError && error.status === 404) {
    return {
      title: "API-key analytics are not enabled",
      description:
        "This deployment does not expose the platform API-keys endpoint yet. The section populates automatically once it is available.",
    };
  }
  if (error instanceof ApiError && error.status === 403) {
    return {
      title: "API-key analytics are restricted",
      description: "Your platform role cannot read API-key analytics for this workspace.",
    };
  }
  return {
    title: "Could not load API-key analytics",
    description: "The endpoint responded with an error. Try again after refreshing the range.",
  };
}

/** Platform-admin API keys: inventory KPIs, usage ranking, spend, errors, cache and growth. */
export function ApiKeysSection({ data, error }: { data: AdminApiKeys | null; error?: unknown }) {
  const spendDonut = useMemo(
    () =>
      (data?.spend_by_key ?? []).slice(0, 8).map((row) => ({
        name: truncateLabel(row.name, 22),
        value: toNumber(row.spend),
        hint: fmtRate(row.share),
      })),
    [data?.spend_by_key],
  );

  const growth = useMemo(
    () => (data?.growth ?? []).map((point) => ({ bucket: point.bucket, created: point.created })),
    [data?.growth],
  );

  if (!data) {
    const copy = unavailableCopy(error);
    return (
      <SectionCard title="API keys" description="Platform-wide key inventory and usage." testId="admin-api-keys">
        <div
          className="flex flex-col items-center justify-center py-12 text-center"
          data-testid="admin-api-keys-unavailable"
        >
          <span className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
            <ShieldAlert className="size-5" />
          </span>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{copy.title}</h3>
          <p className="mt-1 max-w-sm text-xs text-zinc-400">{copy.description}</p>
        </div>
      </SectionCard>
    );
  }

  const activeShare = data.total > 0 ? data.active / data.total : 0;
  const spendKeys = data.spend_by_key.filter((row) => toNumber(row.spend) > 0).length;
  const totalSpend = data.spend_by_key.reduce((sum, row) => sum + toNumber(row.spend), 0);
  const saved = data.cache_savings_by_key.reduce((sum, row) => sum + toNumber(row.savings), 0);

  return (
    <div className="space-y-4" data-testid="admin-api-keys">
      <StatGrid xl="xl:grid-cols-5">
        <KpiCard
          label="Total keys"
          value={fmtNumber(data.total)}
          sub={`${data.total - data.active} not active`}
          icon={<KeyRound className="size-4" />}
          testId="admin-api-keys-kpi-total"
        />
        <KpiCard
          label="Active"
          value={fmtNumber(data.active)}
          sub={`${fmtRate(activeShare)} of all keys`}
          icon={<CircleCheck className="size-4" />}
          testId="admin-api-keys-kpi-active"
        />
        <KpiCard
          label="Disabled"
          value={fmtNumber(data.disabled)}
          sub="Manually turned off"
          icon={<PowerOff className="size-4" />}
          testId="admin-api-keys-kpi-disabled"
        />
        <KpiCard
          label="Expired"
          value={fmtNumber(data.expired)}
          sub="Past expiration date"
          icon={<Clock className="size-4" />}
          testId="admin-api-keys-kpi-expired"
        />
        <KpiCard
          label="Rotated"
          value={fmtNumber(data.rotated)}
          sub="Secret rotated at least once"
          icon={<RefreshCw className="size-4" />}
          testId="admin-api-keys-kpi-rotated"
        />
      </StatGrid>

      <SectionCard
        title="Top keys by traffic"
        description={`Most used keys in range · ${fmtMoney(totalSpend)} tracked spend.`}
        testId="admin-api-keys-top-card"
      >
        <DataTable
          columns={TOP_KEY_COLUMNS}
          rows={data.top_keys}
          rowKey={(row) => row.key_id}
          emptyMessage="No key traffic in this range"
          testId="admin-api-keys-top-table"
        />
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Spend distribution"
          description={
            spendKeys > 0
              ? `${spendKeys} keys with spend · ${fmtMoney(totalSpend)} total.`
              : "No spend recorded in this range."
          }
          testId="admin-api-keys-spend-card"
        >
          <DonutBreakdown
            data={spendDonut}
            valueFormat={fmtMoney}
            ariaLabel="Donut of spend share by API key"
            testId="admin-api-keys-spend"
          />
        </SectionCard>

        <SectionCard
          title="Cache savings"
          description={saved > 0 ? `${fmtMoney(saved)} saved by prompt caching.` : "No cache savings in range."}
          testId="admin-api-keys-cache-card"
        >
          <DataTable
            columns={CACHE_COLUMNS}
            rows={data.cache_savings_by_key}
            rowKey={(row) => row.key_id}
            emptyMessage="No cache savings in this range"
            testId="admin-api-keys-cache-table"
          />
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Errors by key"
          description="Failed requests per key and their error rate."
          testId="admin-api-keys-errors-card"
        >
          <DataTable
            columns={ERROR_COLUMNS}
            rows={data.errors_by_key}
            rowKey={(row) => row.key_id}
            emptyMessage="No key errors in this range"
            testId="admin-api-keys-errors-table"
          />
        </SectionCard>

        <SectionCard
          title="Keys created over time"
          description="New API keys minted per day in the selected range."
          testId="admin-api-keys-growth-card"
        >
          {growth.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-400" data-testid="admin-api-keys-growth">
              No keys created in this range
            </p>
          ) : (
            <TrendChart
              data={growth}
              series={[{ key: "created", name: "Keys created" }]}
              labelFormat={(label) => fmtBucket(label)}
              valueFormat={fmtNumber}
              ariaLabel="Area chart of API keys created over time"
              testId="admin-api-keys-growth"
            />
          )}
        </SectionCard>
      </div>

      <p className="text-center text-[10px] text-zinc-400">
        Key analytics expose names, counts and spend only — secrets and prefixes are never included.
      </p>
    </div>
  );
}
