"use client";

import { useMemo } from "react";
import { AlertTriangle, Ban, Percent } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { TrendChart } from "./TrendChart";
import { ErrorsTable } from "./tables";
import { fmtBucket, fmtBucketFull, fmtCompact, fmtNumber, fmtPercent } from "./format";
import type { AdminErrors } from "@/types/admin";

/** Errors tab: failure volume, error rate and grouped causes. */
export function ErrorsSection({ data }: { data: AdminErrors }) {
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="admin-errors-kpis">
        <KpiCard
          label="Failed requests"
          value={fmtNumber(data.failed_requests)}
          icon={<AlertTriangle className="size-4" />}
          testId="admin-errors-failed"
        />
        <KpiCard
          label="Cancelled requests"
          value={fmtNumber(data.cancelled_requests)}
          icon={<Ban className="size-4" />}
          testId="admin-errors-cancelled"
        />
        <KpiCard
          label="Error rate"
          value={fmtPercent(data.error_rate)}
          goodDirection="down"
          icon={<Percent className="size-4" />}
          testId="admin-errors-rate"
        />
      </div>

      <SectionCard
        title="Errors over time"
        description="Total requests against failures per day."
        testId="admin-errors-series"
      >
        <TrendChart
          data={series}
          series={[
            { key: "requests", name: "Requests" },
            { key: "errors", name: "Errors", color: "#dc2626" },
          ]}
          valueFormat={fmtNumber}
          labelFormat={(label) => fmtBucket(String(label))}
          tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
          axisFormat={fmtCompact}
          ariaLabel="Area chart of requests and errors over the selected period"
          testId="admin-errors-chart"
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="By code" description="Failures grouped by error code." testId="admin-errors-codes">
          <ErrorsTable rows={data.by_code} testId="admin-errors-codes-table" />
        </SectionCard>
        <SectionCard
          title="By provider"
          description="Failures grouped by provider."
          testId="admin-errors-providers"
        >
          <ErrorsTable rows={data.by_provider} testId="admin-errors-providers-table" />
        </SectionCard>
      </div>

      <SectionCard title="By model" description="Failures grouped by model." testId="admin-errors-models">
        <ErrorsTable rows={data.by_model} testId="admin-errors-models-table" />
      </SectionCard>
    </div>
  );
}
