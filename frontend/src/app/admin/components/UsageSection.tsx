"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle, Hash, MessageSquare, UserPlus, Users, Wallet } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { TrendChart } from "./TrendChart";
import { ModelsTable, ProvidersTable } from "./tables";
import { fmtBucket, fmtBucketFull, fmtCompact, fmtMoney, fmtNumber, toNumber } from "./format";
import type { AdminUsage } from "@/types/admin";

/** Usage tab: request volume, failures and per model/provider splits. */
export function UsageSection({ data }: { data: AdminUsage }) {
  const series = useMemo(
    () =>
      data.series.map((point) => ({
        bucket: point.bucket,
        requests: point.requests,
        errors: point.errors,
      })),
    [data.series],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-usage-kpis">
        <KpiCard
          label="Requests"
          value={fmtNumber(data.requests)}
          icon={<Activity className="size-4" />}
          testId="admin-usage-requests"
        />
        <KpiCard
          label="Failed requests"
          value={fmtNumber(data.failed_requests)}
          sub={`${fmtNumber(data.requests)} total`}
          goodDirection="down"
          icon={<AlertTriangle className="size-4" />}
          testId="admin-usage-failed"
        />
        <KpiCard
          label="Active users"
          value={fmtNumber(data.active_users)}
          icon={<Users className="size-4" />}
          testId="admin-usage-active-users"
        />
        <KpiCard
          label="New users"
          value={fmtNumber(data.new_users)}
          icon={<UserPlus className="size-4" />}
          testId="admin-usage-new-users"
        />
        <KpiCard
          label="Conversations"
          value={fmtNumber(data.conversations)}
          icon={<MessageSquare className="size-4" />}
          testId="admin-usage-conversations"
        />
        <KpiCard
          label="Tokens"
          value={fmtCompact(data.total_tokens)}
          icon={<Hash className="size-4" />}
          testId="admin-usage-tokens"
        />
        <KpiCard
          label="Spend"
          value={fmtMoney(data.total_cost)}
          icon={<Wallet className="size-4" />}
          testId="admin-usage-cost"
        />
      </div>

      <SectionCard
        title="Requests over time"
        description="Traffic and failures per day."
        testId="admin-usage-series"
      >
        <TrendChart
          data={series}
          series={[
            { key: "requests", name: "Requests" },
            { key: "errors", name: "Errors" },
          ]}
          valueFormat={fmtNumber}
          labelFormat={(label) => fmtBucket(String(label))}
          tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
          axisFormat={fmtCompact}
          ariaLabel="Area chart of requests and errors over the selected period"
          testId="admin-usage-chart"
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="By provider"
          description="Requests, tokens, spend and reliability per provider."
          testId="admin-usage-providers"
        >
          <ProvidersTable rows={data.by_provider} testId="admin-usage-providers-table" />
        </SectionCard>
        <SectionCard
          title="By model"
          description="Requests, tokens, spend and reliability per model."
          testId="admin-usage-models"
        >
          <ModelsTable rows={data.by_model} testId="admin-usage-models-table" />
        </SectionCard>
      </div>

      <p className="text-right text-[10px] text-zinc-400">
        {data.range.timezone} · {fmtBucket(data.range.start)} – {fmtBucket(data.range.end)}
        {toNumber(data.total_cost) === 0 && data.requests === 0 ? " · No activity in this range" : ""}
      </p>
    </div>
  );
}
